import axios, { AxiosInstance } from 'axios';
import * as https from 'https';
import { EventEmitter } from 'events';
import { 
    GrowiPage, 
    CreatePageRequest, 
    UpdatePageRequest, 
    SearchOptions, 
    SearchResult, 
    ApiResponse,
    GrowiConnection,
    PageConflictError
} from './types';
import { AuthManager } from './auth';
import { CacheManager } from '../utils/cache';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';
import { SecurityValidator } from '../security/validator';
import { GrowiWebSocketClient } from '../websocket/client';

/**
 * @interface GrowiApiClient
 * @description GROWI APIと通信するためのクライアントインターフェース。
 */
export interface GrowiApiClient {
    /**
     * @param {string} [path] - 取得するページの親パス。
     * @param {number} [limit] - 取得するページの最大数。
     * @returns {Promise<GrowiPage[]>} ページ情報の配列。
     * @description 指定されたパス配下のページ一覧を取得します。
     */
    getPages(path?: string, limit?: number): Promise<GrowiPage[]>;

    /**
     * @param {string} pageId - 取得するページのID。
     * @param {boolean} [force] - キャッシュを無視して強制的にサーバーから取得するかどうか。
     * @returns {Promise<GrowiPage>} ページ情報。
     * @description 指定されたIDのページ情報を取得します。
     */
    getPage(pageId: string, force?: boolean): Promise<GrowiPage>;

    /**
     * @param {CreatePageRequest} page - 作成するページの情報。
     * @returns {Promise<GrowiPage>} 作成されたページ情報。
     * @description 新しいページを作成します。
     */
    createPage(page: CreatePageRequest): Promise<GrowiPage>;

    /**
     * @param {string} pageId - 更新するページのID。
     * @param {UpdatePageRequest} updates - 更新内容。
     * @returns {Promise<GrowiPage>} 更新されたページ情報。
     * @description 既存のページを更新します。
     */
    updatePage(pageId: string, updates: UpdatePageRequest): Promise<GrowiPage>;

    /**
     * @param {string} pageId - 削除するページのID。
     * @returns {Promise<void>}
     * @description ページを削除します。
     */
    deletePage(pageId: string): Promise<void>;

    /**
     * @param {(page: GrowiPage) => void} callback - ページ更新時に実行されるコールバック。
     * @description ページのリアルタイム更新を購読します。
     */
    onPageUpdate(callback: (page: GrowiPage) => void): void;

    /**
     * @param {GrowiConnection} connection - アクティブにする接続情報。
     * @description APIクライアントが使用する接続を設定します。
     */
    setActiveConnection(connection: GrowiConnection): void;

    /**
     * @description 現在の接続を切断します。
     */
    disconnect(): void;

    /**
     * @returns {any} WebSocketの接続ステータス。
     * @description WebSocketの現在の接続状態を取得します。
     */
    getWebSocketStatus(): any;

    /**
     * @returns {boolean} 接続されている場合はtrue、そうでない場合はfalse。
     * @description APIクライアントが現在接続されているかを確認します。
     */
    isConnected(): boolean;
}

/**
 * @class GrowiApiClientImpl
 * @extends {EventEmitter}
 * @implements {GrowiApiClient}
 * @description GrowiApiClientインターフェースの実装クラス。
 */
export class GrowiApiClientImpl extends EventEmitter implements GrowiApiClient {
    private httpClient: AxiosInstance;
    private authManager: AuthManager;
    private cache: CacheManager;
    private configManager: ConfigManager;
    private logger = Logger.getInstance();
    private securityValidator = new SecurityValidator();
    private activeConnection?: GrowiConnection;
    private growiWebSocketClient?: GrowiWebSocketClient;

    /**
     * @constructor
     * @param {AuthManager} authManager - 認証マネージャー。
     * @param {CacheManager} cache - キャッシュマネージャー。
     * @param {ConfigManager} configManager - 設定マネージャー。
     * @param {GrowiWebSocketClient} [growiWebSocketClient] - WebSocketクライアント。
     */
    constructor(
        authManager: AuthManager, 
        cache: CacheManager, 
        configManager: ConfigManager,
        growiWebSocketClient?: GrowiWebSocketClient
    ) {
        super();
        this.authManager = authManager;
        this.cache = cache;
        this.configManager = configManager;
        this.growiWebSocketClient = growiWebSocketClient;
        
        // HTTPクライアントのセットアップ
        this.httpClient = axios.create({
            timeout: 10000,
            httpsAgent: new https.Agent({ rejectUnauthorized: true }), // 自己署名証明書を許可しない
            headers: { 'Content-Type': 'application/json', 'User-Agent': 'GROWI-VSCode-Integration/0.1.0' }
        });
        
        // リクエストインターセプター: 全てのリクエストに認証ヘッダーを付与
        this.httpClient.interceptors.request.use(
            async (config) => {
                if (this.activeConnection) {
                    try {
                        const authHeaders = await this.authManager.getAuthHeaders(this.activeConnection.id);
                        Object.assign(config.headers, authHeaders);
                    } catch (error) {
                        this.logger.error('認証ヘッダーの設定に失敗しました', error);
                    }
                }
                return config;
            },
            (error) => Promise.reject(error)
        );
        
        // レスポンスインターセプター: エラーレスポンスをグローバルにハンドリング
        this.httpClient.interceptors.response.use(
            (response) => response,
            (error) => {
                if (error.response) {
                    const { status, data } = error.response;
                    const message = data?.error?.message || data?.message || error.message;
                    this.logger.error(`APIエラー (${status}): ${message}`);
                    
                    // 認証エラー(401)の場合、接続失敗として処理
                    if (status === 401 && this.activeConnection) {
                        this.authManager.onConnectionFailure(this.activeConnection.id);
                    }
                } else if (error.request) {
                    this.logger.error('ネットワークエラー: サーバーに接続できません。');
                } else {
                    this.logger.error(`リクエストエラー: ${error.message}`);
                }
                return Promise.reject(error);
            }
        );
    }

    /**
     * @method getPages
     * @param {string} [path='/'] - 取得するページの親パス。
     * @param {number} [limit=100] - 取得するページの最大数。
     * @returns {Promise<GrowiPage[]>} ページ情報の配列。
     */
    public async getPages(path?: string, limit: number = 100): Promise<GrowiPage[]> {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        const cacheKey = `pages:${path || 'root'}:${limit}`;
        const cached = this.cache.get<GrowiPage[]>(cacheKey);
        if (cached) return cached;
        
        try {
            const url = this.buildApiUrl('/pages/list');
            const params: any = { 
                limit,
                path: path || '/', // デフォルトはルートパス
                page: 1 // ページネーション（現在は1ページ目のみ）
            };
            
            this.logger.debug(`ページ一覧取得: ${url}`, { params });
            const response = await this.httpClient.get<{ pages: any[] } | string>(url, { params });
            
            // ログインページが返された場合（セッション切れなど）のハンドリング
            if (typeof response.data === 'string' && response.data.trim().startsWith('<!DOCTYPE html>')) {
                this.logger.warn('APIがログインページを返しました。認証エラーの可能性があります。');
                this.emit('reauthenticationRequired'); // 再認証を要求するイベントを発行
                throw new Error('認証が必要です。再度ログインしてください。');
            }

            if (typeof response.data === 'string' || !response.data.pages) {
                this.logger.error('ページの取得に失敗しました: 無効なレスポンス形式です。', JSON.stringify(response.data, null, 2));
                throw new Error('ページの取得に失敗しました: 無効なレスポンス形式です。');
            }
            
            const pages = response.data.pages.map(this.parsePage.bind(this)) || [];
            this.cache.set(cacheKey, pages, 300000); // 5分間キャッシュ
            return pages;
        } catch (error: any) {
            const errorMessage = error.response?.data?.error?.message || error.response?.data?.message || error.message || 'ページの取得に失敗しました。';
            this.logger.error(`ページの取得に失敗しました。`, { message: errorMessage, url: error.config?.url, status: error.response?.status });
            throw new Error(`ページの取得に失敗しました: ${errorMessage}`);
        }
    }

    /**
     * @method getPage
     * @param {string} pageId - 取得するページのID。
     * @param {boolean} [force=false] - キャッシュを無視するかどうか。
     * @returns {Promise<GrowiPage>} ページ情報。
     */
    public async getPage(pageId: string, force: boolean = false): Promise<GrowiPage> {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        if (force) {
            this.cache.delete(`page:${pageId}`);
        }
        const cached = this.cache.getPage(pageId);
        if (cached) return cached;
        
        const url = this.buildApiUrl('/page');
        this.logger.debug('ページ取得リクエスト送信:', { url, params: { pageId } });

        try {
            const response = await this.httpClient.get<{ page: any }>(url, { params: { pageId } });
            this.logger.debug('ページ取得レスポンス受信:', { status: response.status, data: response.data });

            if (!response.data.page) {
                throw new Error('ページの取得に失敗しました: レスポンスにページデータが含まれていません。');
            }
            
            const page = this.parsePage(response.data.page);
            this.cache.setPage(pageId, page, 600000); // 10分間キャッシュ
            return page;
        } catch (error) {
            this.logger.error('getPageで予期せぬエラー:', error);
            throw error;
        }
    }

    /**
     * @method createPage
     * @param {CreatePageRequest} pageRequest - 作成するページの情報。
     * @returns {Promise<GrowiPage>} 作成されたページ情報。
     */
    public async createPage(pageRequest: CreatePageRequest): Promise<GrowiPage> {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        
        // パスと内容のバリデーションとサニタイズ
        const { path, content } = pageRequest;
        const pathValidation = this.securityValidator.validatePagePath(path);
        if (!pathValidation.isValid) throw new Error(`無効なページパスです: ${pathValidation.errors.join(', ')}`);
        const contentValidation = this.securityValidator.validatePageContent(content);
        if (!contentValidation.isValid) throw new Error(`無効なページ内容です: ${contentValidation.errors.join(', ')}`);

        const sanitizedRequest = { ...pageRequest, path: pathValidation.sanitizedValue!, content: contentValidation.sanitizedValue! };
        
        try {
            const url = this.buildApiUrl('/page');
            const response = await this.httpClient.post<{ page: any }>(url, {
                body: sanitizedRequest.content,
                path: sanitizedRequest.path,
                grant: sanitizedRequest.grant || 1 // デフォルトは公開
            });
            if (!response.data.page) throw new Error('ページの作成に失敗しました。');
            
            const page = this.parsePage(response.data.page);
            this.clearRelatedCache(page.path); // 関連キャッシュをクリア
            return page;
        } catch (error) {
            this.logger.error('ページの作成に失敗しました', error);
            throw error;
        }
    }

    /**
     * @method updatePage
     * @param {string} pageId - 更新するページのID。
     * @param {UpdatePageRequest} updates - 更新内容。
     * @returns {Promise<GrowiPage>} 更新されたページ情報。
     * @throws {PageConflictError} ページの更新が競合した場合。
     */
    public async updatePage(pageId: string, updates: UpdatePageRequest): Promise<GrowiPage> {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        
        // 内容のバリデーションとサニタイズ
        if (updates.content) {
            const contentValidation = this.securityValidator.validatePageContent(updates.content);
            if (!contentValidation.isValid) throw new Error(`無効なページ内容です: ${contentValidation.errors.join(', ')}`);
            updates.content = contentValidation.sanitizedValue;
        }

        const url = this.buildApiUrl('/page');
        const requestData: any = {
            pageId: pageId,
            body: updates.content,
        };
        if (updates.revision) {
            requestData.revisionId = updates.revision;
        }

        this.logger.debug('ページ更新リクエスト送信:', { url, data: requestData });

        try {
            // 409 (Conflict) も正常なレスポンスとして扱う
            const response = await this.httpClient.put<{ page: any }>(url, requestData, {
                validateStatus: (status) => (status >= 200 && status < 300) || status === 409,
            });

            this.logger.debug('ページ更新レスポンス受信:', { status: response.status, data: response.data });

            // 更新競合のハンドリング
            if (response.status === 409) {
                this.logger.warn(`ページの更新中に競合が検出されました: ${pageId}`);
                const serverPage = (response.data && (response.data as any).page)
                    ? this.parsePage((response.data as any).page)
                    : await this.getPage(pageId, true); // キャッシュを無視して最新版を取得

                const message = updates.isOverwrite
                    ? '上書きに失敗しました。ページが再度変更された可能性があります。'
                    : 'ページの競合が検出されました。';
                throw new PageConflictError(message, serverPage);
            }

            if (!response.data.page) {
                throw new Error('ページの更新に失敗しました: サーバーから無効なレスポンスが返されました。');
            }
            
            const page = this.parsePage(response.data.page);
            this.cache.setPage(pageId, page, 600000);
            this.clearRelatedCache(page.path);
            return page;
        } catch (error) {
            if (error instanceof PageConflictError) {
                this.logger.warn('PageConflictErrorをスローします。');
                throw error;
            }
            this.logger.error('updatePageで予期せぬエラー:', error);
            throw error;
        }
    }

    /**
     * @method deletePage
     * @param {string} pageId - 削除するページのID。
     */
    public async deletePage(pageId: string): Promise<void> {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        try {
            const page = await this.getPage(pageId).catch(() => undefined);
            
            const url = this.buildApiUrl('/pages/delete');
            await this.httpClient.post<ApiResponse<{}>>(url, { 
                pageIdToRevisionIdMap: { [pageId]: 1 }, // リビジョンIDはダミー
                isCompletely: false, // ゴミ箱へ移動
                isRecursively: false // 子ページは対象外
            });
            
            this.cache.delete(`page:${pageId}`);
            if (page) this.clearRelatedCache(page.path);
        } catch (error) {
            this.logger.error('ページの削除に失敗しました', error);
            throw error;
        }
    }

    /**
     * @method onPageUpdate
     * @param {(page: GrowiPage) => void} callback - ページ更新時に実行されるコールバック。
     */
    public onPageUpdate(callback: (page: GrowiPage) => void): void {
        this.growiWebSocketClient?.on('pageUpdated', callback);
    }

    /**
     * @method setActiveConnection
     * @param {GrowiConnection} connection - アクティブにする接続情報。
     */
    public setActiveConnection(connection: GrowiConnection): void {
        const urlValidation = this.securityValidator.validateUrl(connection.serverUrl);
        if (!urlValidation.isValid) throw new Error(`無効な接続URLです: ${urlValidation.errors.join(', ')}`);
        
        this.activeConnection = { ...connection, serverUrl: urlValidation.sanitizedValue! };
        this.logger.info(`アクティブな接続が設定されました: ${connection.name}`);
        // WebSocketは必要に応じて手動で接続
    }

    /**
     * @method disconnect
     * @description 現在の接続を切断します。
     */
    public disconnect(): void {
        this.growiWebSocketClient?.disconnect();
        this.activeConnection = undefined;
        this.logger.info('切断しました。');
    }

    /**
     * @method getWebSocketStatus
     * @returns {any} WebSocketの接続ステータス。
     */
    public getWebSocketStatus(): any {
        return this.growiWebSocketClient?.getStatus();
    }

    /**
     * @method isConnected
     * @returns {boolean} 接続状態。
     */
    public isConnected(): boolean {
        return !!this.activeConnection;
    }

    /**
     * @method buildApiUrl
     * @private
     * @param {string} endpoint - APIエンドポイント。
     * @returns {string} 完全なAPI URL。
     */
    private buildApiUrl(endpoint: string): string {
        if (!this.activeConnection) throw new Error('アクティブな接続がありません。');
        const baseUrl = this.activeConnection.serverUrl.replace(/\/$/, '');
        const formattedEndpoint = endpoint.startsWith('/') ? endpoint : `/${endpoint}`;
        return `${baseUrl}/_api/v3${formattedEndpoint}`;
    }

    /**
     * @method parsePage
     * @private
     * @param {any} pageData - APIから取得した生のページデータ。
     * @returns {GrowiPage} 整形されたページオブジェクト。
     */
    private parsePage(pageData: any): GrowiPage {
        return {
            id: pageData.id || pageData._id,
            path: pageData.path,
            title: pageData.title || this.extractTitleFromPath(pageData.path),
            content: pageData.content || pageData.revision?.body || '',
            createdAt: new Date(pageData.createdAt),
            updatedAt: new Date(pageData.updatedAt),
            creator: {
                id: pageData.creator?.id || pageData.creator?._id,
                username: pageData.creator?.username,
                name: pageData.creator?.name || pageData.creator?.username,
                email: pageData.creator?.email,
                status: 'active'
            },
            lastUpdateUser: {
                id: pageData.lastUpdateUser?.id || pageData.lastUpdateUser?._id,
                username: pageData.lastUpdateUser?.username,
                name: pageData.lastUpdateUser?.name || pageData.lastUpdateUser?.username,
                email: pageData.lastUpdateUser?.email,
                status: 'active'
            },
            tags: pageData.tags || [],
            pageType: this.determinePageType(pageData),
            hasChildren: pageData.descendantCount > 0,
            parentId: pageData.parent?._id || pageData.parent,
            revision: pageData.revision?._id || pageData.revision,
            grant: pageData.grant || 1,
            status: pageData.status || 'published'
        };
    }

    /**
     * @method extractTitleFromPath
     * @private
     * @param {string} path - ページのパス。
     * @returns {string} パスから抽出したタイトル。
     */
    private extractTitleFromPath(path: string): string {
        const segments = path.split('/').filter(s => s.length > 0);
        return segments[segments.length - 1] || 'Untitled';
    }

    /**
     * @method determinePageType
     * @private
     * @param {any} pageData - 生のページデータ。
     * @returns {'normal' | 'template' | 'deleted' | 'private'} ページタイプ。
     */
    private determinePageType(pageData: any): 'normal' | 'template' | 'deleted' | 'private' {
        if (pageData.status === 'deleted') return 'deleted';
        if (pageData.grant === 0) return 'private';
        if (pageData.path?.includes('/_template/')) return 'template';
        return 'normal';
    }

    /**
     * @method clearRelatedCache
     * @private
     * @param {string} path - ページパス。
     * @description 指定されたパスと、その親パスに関連するキャッシュをクリアします。
     */
    private clearRelatedCache(path: string): void {
        this.cache.clearPageCacheByPath(path);
        const pathSegments = path.split('/');
        // 親パスのキャッシュも再帰的にクリア
        for (let i = pathSegments.length - 1; i > 0; i--) {
            const parentPath = pathSegments.slice(0, i).join('/');
            this.cache.clearPageCacheByPath(parentPath);
        }
    }
}
