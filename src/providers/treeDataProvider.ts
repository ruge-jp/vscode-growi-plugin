import * as vscode from 'vscode';
import { GrowiTreeItem, GrowiPage, GrowiConnection, PageType } from '../api/types';
import { GrowiApiClient } from '../api/client';
import { ConfigManager } from '../utils/config';
import { Logger } from '../utils/logger';
import { CacheManager } from '../utils/cache';

/**
 * @class GrowiTreeDataProvider
 * @implements {vscode.TreeDataProvider<GrowiTreeItem>}
 * @description 「ページ」ビューに表示されるGROWIのページ階層を提供するTreeDataProvider。
 */
export class GrowiTreeDataProvider implements vscode.TreeDataProvider<GrowiTreeItem> {
    // ツリーデータの変更をVSCodeに通知するためのEventEmitter
    private _onDidChangeTreeData = new vscode.EventEmitter<GrowiTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    // 接続状態の変更を通知するためのEventEmitter
    private _onConnectionChanged = new vscode.EventEmitter<boolean>();
    readonly onConnectionChanged = this._onConnectionChanged.event;

    private logger = Logger.getInstance();
    private context: vscode.ExtensionContext;
    private configManager: ConfigManager;
    private apiClient: GrowiApiClient;
    private cacheManager: CacheManager;
    private isConnected = false;

    // 取得した全ページ情報を保持するローカルキャッシュ
    private allPages: GrowiPage[] = [];

    /**
     * @constructor
     * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト。
     * @param {ConfigManager} configManager - 設定マネージャー。
     * @param {GrowiApiClient} apiClient - GROWI APIクライアント。
     * @param {CacheManager} cacheManager - キャッシュマネージャー。
     */
    constructor(
        context: vscode.ExtensionContext,
        configManager: ConfigManager,
        apiClient: GrowiApiClient,
        cacheManager: CacheManager
    ) {
        this.context = context;
        this.configManager = configManager;
        this.apiClient = apiClient;
        this.cacheManager = cacheManager;
        vscode.workspace.onDidChangeConfiguration(e => this.onConfigurationChanged(e));
    }

    /**
     * @method connect
     * @param {GrowiConnection} connection - 接続するGROWIサーバーの情報。
     * @description 指定されたGROWIサーバーに接続し、ツリーを初期化します。
     */
    public async connect(connection: GrowiConnection): Promise<void> {
        this.logger.info(`GROWIに接続中: ${connection.name}`);
        try {
            this.apiClient.setActiveConnection(connection);
            this.isConnected = true;
            this._onConnectionChanged.fire(true); // 接続状態の変更を通知
            await this.configManager.setActiveConnectionId(connection.id);
            this.refresh(); // ツリーを更新
            this.logger.info(`${connection.name} への接続に成功しました。`);
        } catch (error) {
            this.isConnected = false;
            this._onConnectionChanged.fire(false);
            this.logger.error(`${connection.name} への接続に失敗しました:`, error);
            throw error;
        }
    }

    /**
     * @method disconnect
     * @description 現在のGROWIサーバーから切断します。
     */
    public disconnect(): void {
        this.logger.info('GROWIから切断します。');
        this.apiClient.disconnect();
        this.isConnected = false;
        this.allPages = []; // ページキャッシュをクリア
        this._onConnectionChanged.fire(false);
        this.refresh();
    }

    /**
     * @method getConnectionStatus
     * @returns {boolean} 現在の接続状態。
     */
    public getConnectionStatus(): boolean {
        return this.isConnected;
    }

    /**
     * @method getTreeItem
     * @param {GrowiTreeItem} element - ツリーアイテム。
     * @returns {vscode.TreeItem} TreeItem表現。
     */
    getTreeItem(element: GrowiTreeItem): vscode.TreeItem {
        const treeItem = new vscode.TreeItem(
            element.title,
            element.hasChildren ? vscode.TreeItemCollapsibleState.Collapsed : vscode.TreeItemCollapsibleState.None
        );
        treeItem.iconPath = this.getIconForPageType(element.pageType);
        treeItem.tooltip = this.buildTooltip(element);
        treeItem.contextValue = 'growiPage'; // コンテキストメニュー用
        treeItem.command = {
            command: 'growi.openPage',
            title: 'ページを開く',
            arguments: [element]
        };
        return treeItem;
    }

    /**
     * @method getChildren
     * @param {GrowiTreeItem} [element] - 親要素。
     * @returns {Promise<GrowiTreeItem[]>} 子要素の配列。
     */
    async getChildren(element?: GrowiTreeItem): Promise<GrowiTreeItem[]> {
        if (!this.isConnected) {
            return [];
        }

        // ルート要素の場合 (element is undefined)
        if (!element) {
            try {
                this.logger.info('ルート階層のページを取得中...');
                // APIから全ページリストを取得（現在は1000件に制限）
                this.allPages = await this.apiClient.getPages('/', 1000); 
                this.logger.debug(`合計 ${this.allPages.length} ページを取得しました。`);
                
                // 親がいない、またはパスがルート階層のページを抽出
                const rootPages = this.allPages.filter(page => !page.parentId || this.isRoot(page.path));
                this.logger.debug(`${rootPages.length} 件のルートページが見つかりました。`);
                
                return this.convertPagesToTreeItems(rootPages, 0);
            } catch (error) {
                this.logger.error('ルートページの取得に失敗しました', error);
                vscode.window.showErrorMessage(`ページの読み込みに失敗しました: ${error instanceof Error ? error.message : error}`);
                return [];
            }
        }

        // 子要素の場合
        this.logger.debug(`子要素を取得中: ${element.title} (ID: ${element.id})`);
        // 全ページリストから、親IDが一致するものを子としてフィルタリング
        const children = this.allPages.filter(page => page.parentId === element.id);
        this.logger.debug(`${element.title} の子ページが ${children.length} 件見つかりました。`);
        return this.convertPagesToTreeItems(children, element.level + 1);
    }

    /**
     * @method isRoot
     * @private
     * @param {string} path - ページパス。
     * @returns {boolean} パスがルート階層かどうか。
     */
    private isRoot(path: string): boolean {
        // パスを'/'で分割し、空でないセグメントが1つだけの場合をルートとみなす
        return path.split('/').filter(Boolean).length === 1;
    }

    /**
     * @method convertPagesToTreeItems
     * @private
     * @param {GrowiPage[]} pages - 変換するページの配列。
     * @param {number} level - ツリーの階層レベル。
     * @returns {GrowiTreeItem[]} 変換されたTreeItemの配列。
     */
    private convertPagesToTreeItems(pages: GrowiPage[], level: number): GrowiTreeItem[] {
        return pages.map(page => ({
            id: page.id,
            title: page.title,
            path: page.path,
            pageType: page.pageType,
            hasChildren: page.hasChildren,
            updatedAt: page.updatedAt,
            level
        }));
    }

    /**
     * @method getIconForPageType
     * @private
     * @param {PageType} pageType - ページ種別。
     * @returns {vscode.ThemeIcon} 対応するアイコン。
     */
    private getIconForPageType(pageType: PageType): vscode.ThemeIcon {
        switch (pageType) {
            case 'template': return new vscode.ThemeIcon('file-code');
            case 'deleted': return new vscode.ThemeIcon('trash');
            case 'private': return new vscode.ThemeIcon('lock');
            default: return new vscode.ThemeIcon('file-text');
        }
    }

    /**
     * @method buildTooltip
     * @private
     * @param {GrowiTreeItem} element - ツリーアイテム。
     * @returns {string} ツールチップの文字列。
     */
    private buildTooltip(element: GrowiTreeItem): string {
        return `パス: ${element.path}\n更新日時: ${element.updatedAt.toLocaleString()}`;
    }

    /**
     * @method refresh
     * @param {GrowiTreeItem} [element] - 更新の起点となる要素。
     * @description ツリービュー全体を強制的に更新します。
     */
    public refresh(element?: GrowiTreeItem): void {
        this.logger.info('ページツリーを更新します...');
        // APIから最新の情報を再取得するため、ローカルのページキャッシュをクリア
        this.allPages = [];
        // APIクライアントレベルのキャッシュもクリア
        this.cacheManager.clearPageCache();
        // ルートからツリーを再構築するようVSCodeに通知
        this._onDidChangeTreeData.fire();
    }

    /**
     * @method onConfigurationChanged
     * @private
     * @param {vscode.ConfigurationChangeEvent} event - 設定変更イベント。
     * @description 設定変更を検知し、表示設定に関連する場合はツリーを更新します。
     */
    private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration('growi.displaySettings')) {
            this.logger.info('表示設定が変更されたため、ツリーを更新します。');
            this.refresh();
        }
    }

    /**
     * @method dispose
     * @description 拡張機能の終了時にリソースを解放します。
     */
    public dispose(): void {
        this.disconnect();
        this._onDidChangeTreeData.dispose();
        this._onConnectionChanged.dispose();
    }
}