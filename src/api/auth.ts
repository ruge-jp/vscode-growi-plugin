import * as vscode from 'vscode';
import axios, { AxiosInstance } from 'axios';
import { AuthCredentials, AuthResult, GrowiUser, GrowiConnection } from './types';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';

/**
 * @interface AuthManager
 * @description 認証を管理するためのインターフェース。
 */
export interface AuthManager {
    /**
     * @param {string} serverUrl - 接続先GROWIサーバーのURL。
     * @param {AuthCredentials} credentials - 認証情報。
     * @returns {Promise<AuthResult>} 認証結果。
     * @description 指定されたGROWIサーバーでユーザーを認証します。
     */
    authenticate(serverUrl: string, credentials: AuthCredentials): Promise<AuthResult>;

    /**
     * @param {string} [connectionId] - 接続ID。指定しない場合はアクティブな接続が使用されます。
     * @returns {Promise<Record<string, string>>} 認証ヘッダー。
     * @description APIリクエスト用の認証ヘッダーを取得します。
     */
    getAuthHeaders(connectionId?: string): Promise<Record<string, string>>;

    /**
     * @param {string} [connectionId] - 接続ID。指定しない場合はアクティブな接続が使用されます。
     * @returns {boolean} 認証されている場合はtrue、そうでない場合はfalse。
     * @description 指定された接続が現在認証されているかどうかを確認します。
     */
    isAuthenticated(connectionId?: string): boolean;

    /**
     * @param {string} [connectionId] - 接続ID。指定しない場合はアクティブな接続が使用されます。
     * @returns {Promise<void>}
     * @description 指定された接続の認証情報をクリアします。
     */
    clearAuth(connectionId?: string): Promise<void>;

    /**
     * @param {string} connectionId - 接続ID。
     * @returns {Promise<void>}
     * @description 接続が成功した際のコールバック。
     */
    onConnectionSuccess(connectionId: string): Promise<void>;

    /**
     * @param {string} connectionId - 接続ID。
     * @returns {Promise<void>}
     * @description 接続が失敗した際のコールバック。
     */
    onConnectionFailure(connectionId: string): Promise<void>;
}

/**
 * @class AuthManagerImpl
 * @implements {AuthManager}
 * @description AuthManagerインターフェースの実装クラス。GROWI REST API v3のAccess Token認証をサポートします。
 */
export class AuthManagerImpl implements AuthManager {
    private logger = Logger.getInstance();
    private configManager: ConfigManager;
    private httpClient: AxiosInstance;
    private authenticatedConnections = new Set<string>();

    /**
     * @constructor
     * @param {ConfigManager} configManager - 設定管理クラスのインスタンス。
     */
    constructor(configManager: ConfigManager) {
        this.configManager = configManager;
        
        // HTTPクライアントの初期化
        this.httpClient = axios.create({
            timeout: 10000, // タイムアウトを10秒に設定
            headers: {
                'Content-Type': 'application/json',
                'User-Agent': 'GROWI-VSCode-Integration/0.1.0' // ユーザーエージェントを設定
            }
        });
        
        // グローバルなレスポンスインターセプターでエラーハンドリングを一元化
        this.httpClient.interceptors.response.use(
            response => response,
            error => this.handleHttpError(error)
        );
    }

    /**
     * @method authenticate
     * @param {string} serverUrl - 接続先GROWIサーバーのURL。
     * @param {AuthCredentials} credentials - 認証情報。
     * @returns {Promise<AuthResult>} 認証結果。
     * @description GROWIサーバーへの認証を試みます。
     */
    public async authenticate(serverUrl: string, credentials: AuthCredentials): Promise<AuthResult> {
        this.logger.info(`認証を開始: ${serverUrl}`);
        
        try {
            // サーバーURLを正規化（末尾のスラッシュ削除、プロトコル付与など）
            const normalizedUrl = this.normalizeServerUrl(serverUrl);
            
            // 現在はAPI Tokenによる認証のみをサポート
            if (credentials.type !== 'token') {
                throw new Error(`サポートされていない認証タイプ: ${credentials.type}。API Tokenのみサポートされています。`);
            }
            
            // API Tokenが有効か検証するためのヘッダー
            const headers = { 'Authorization': `Bearer ${credentials.value}` };
            // /meエンドポイントの代わりに、通知ステータス取得APIを認証テストに使用
            const url = this.buildApiUrl(normalizedUrl, '/in-app-notification/status');
            
            const response = await this.httpClient.get(url, { headers });
            
            // ステータスコード200が返ってきた場合、認証成功とみなす
            if (response.status === 200) {
                this.logger.info('Token認証成功');
                return {
                    success: true,
                    token: credentials.value
                };
            }
            
            // その他のステータスコードの場合は認証失敗
            throw new Error('認証の検証に失敗しました');
            
        } catch (error) {
            this.logger.error('認証に失敗しました', error);
            return {
                success: false,
                error: error instanceof Error ? error.message : '認証エラーが発生しました'
            };
        }
    }

    /**
     * @method getAuthHeaders
     * @param {string} [connectionId] - 接続ID。
     * @returns {Promise<Record<string, string>>} 認証ヘッダー。
     * @description APIリクエストに必要な認証ヘッダーを生成します。
     */
    public async getAuthHeaders(connectionId?: string): Promise<Record<string, string>> {
        // connectionIdが指定されていればその接続を、なければアクティブな接続を取得
        const connection = connectionId 
            ? this.configManager.getConnections().find(c => c.id === connectionId)
            : this.configManager.getActiveConnection();
            
        if (!connection) {
            throw new Error('アクティブな接続が見つかりません');
        }
        
        // 設定から認証トークンを取得
        const token = await this.configManager.getAuthToken(connection.id);
        if (!token) {
            throw new Error('認証トークンが見つかりません');
        }
        
        const headers: Record<string, string> = {};
        
        // API Token認証の場合、Authorizationヘッダーを設定
        if (connection.authType === 'token') {
            headers['Authorization'] = `Bearer ${token}`;
        } else {
            throw new Error(`サポートされていない認証タイプ: ${connection.authType}。API Tokenのみサポートされています。`);
        }
        
        return headers;
    }

    /**
     * @method isAuthenticated
     * @param {string} [connectionId] - 接続ID。
     * @returns {boolean} 認証済みかどうか。
     * @description 指定された接続が現在認証済みであるかを確認します。
     */
    public isAuthenticated(connectionId?: string): boolean {
        const connection = connectionId 
            ? this.configManager.getConnections().find(c => c.id === connectionId)
            : this.configManager.getActiveConnection();
            
        if (!connection) {
            return false;
        }
        
        // メモリ上の認証済み接続セットにIDが存在するか確認
        return this.authenticatedConnections.has(connection.id);
    }

    /**
     * @method clearAuth
     * @param {string} [connectionId] - 接続ID。
     * @returns {Promise<void>}
     * @description 認証情報をクリアし、切断状態にします。
     */
    public async clearAuth(connectionId?: string): Promise<void> {
        const connection = connectionId 
            ? this.configManager.getConnections().find(c => c.id === connectionId)
            : this.configManager.getActiveConnection();
            
        if (connection) {
            // 保存されている認証トークンを削除
            await this.configManager.removeAuthToken(connection.id);
            // 認証済みセットからIDを削除
            this.authenticatedConnections.delete(connection.id);
            // 接続状態を未接続に更新
            await this.configManager.updateConnection(connection.id, { connected: false });
            this.logger.info(`認証情報をクリア: ${connection.id}`);
        }
    }

    /**
     * @method normalizeServerUrl
     * @private
     * @param {string} serverUrl - ユーザーが入力したサーバーURL。
     * @returns {string} 正規化されたURL。
     * @description URLのプロトコル付与や末尾のスラッシュ削除など、URLを正規化します。
     */
    private normalizeServerUrl(serverUrl: string): string {
        let normalized = serverUrl.trim();
        
        // プロトコルが指定されていない場合はhttpsをデフォルトとして追加
        if (!normalized.startsWith('http://') && !normalized.startsWith('https://')) {
            normalized = 'https://' + normalized;
        }
        
        // 末尾にスラッシュがあれば削除
        normalized = normalized.replace(/\/$/, '');
        
        return normalized;
    }

    /**
     * @method buildApiUrl
     * @private
     * @param {string} serverUrl - 正規化されたサーバーURL。
     * @param {string} path - APIエンドポイントのパス。
     * @returns {string} 完全なAPI URL。
     * @description ベースURLとAPIパスを結合して、完全なAPI URLを構築します。
     */
    private buildApiUrl(serverUrl: string, path: string): string {
        const apiBasePath = '/_api/v3'; // GROWI API v3のベースパス
        return `${serverUrl}${apiBasePath}${path}`;
    }

    /**
     * @method handleHttpError
     * @private
     * @param {any} error - axiosからスローされたエラーオブジェクト。
     * @returns {Promise<never>}
     * @description HTTPリクエストで発生したエラーを一元的に処理し、分かりやすいエラーメッセージをスローします。
     */
    private handleHttpError(error: any): Promise<never> {
        if (error.response) {
            // サーバーからのレスポンスがある場合
            const status = error.response.status;
            const message = error.response.data?.message || error.message;
            
            switch (status) {
                case 401: // Unauthorized
                    throw new Error(`認証に失敗しました: ${message}`);
                case 403: // Forbidden
                    throw new Error(`アクセス権限がありません: ${message}`);
                case 404: // Not Found
                    throw new Error(`APIエンドポイントが見つかりません: ${message}`);
                case 429: // Too Many Requests
                    const retryAfter = error.response.headers['retry-after'];
                    throw new Error(`レート制限に達しました。${retryAfter}秒後に再試行してください。`);
                case 500: // Internal Server Error
                case 502: // Bad Gateway
                case 503: // Service Unavailable
                case 504: // Gateway Timeout
                    throw new Error(`サーバーエラーが発生しました: ${message}`);
                default:
                    throw new Error(`HTTP エラー (${status}): ${message}`);
            }
        } else if (error.request) {
            // リクエストは送信されたが、レスポンスがない場合（ネットワークエラーなど）
            throw new Error('ネットワークエラー: サーバーに接続できません');
        } else {
            // リクエスト設定時のエラー
            throw new Error(`リクエストエラー: ${error.message}`);
        }
    }

    /**
     * @method onConnectionSuccess
     * @param {string} connectionId - 接続ID。
     * @returns {Promise<void>}
     * @description 接続が成功した際のステータス更新処理。
     */
    public async onConnectionSuccess(connectionId: string): Promise<void> {
        // 認証済みセットに追加
        this.authenticatedConnections.add(connectionId);
        // 接続状態と最終接続日時を更新
        await this.configManager.updateConnection(connectionId, { 
            connected: true, 
            lastConnected: new Date() 
        });
        this.logger.info(`接続成功: ${connectionId}`);
    }

    /**
     * @method onConnectionFailure
     * @param {string} connectionId - 接続ID。
     * @returns {Promise<void>}
     * @description 接続が失敗した際のステータス更新処理。
     */
    public async onConnectionFailure(connectionId: string): Promise<void> {
        // 認証済みセットから削除
        this.authenticatedConnections.delete(connectionId);
        // 接続状態を未接続に更新
        await this.configManager.updateConnection(connectionId, { connected: false });
        this.logger.warn(`接続失敗: ${connectionId}`);
    }
}
