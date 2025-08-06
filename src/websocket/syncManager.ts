import * as vscode from 'vscode';
import { GrowiWebSocketClient } from './client';
import { GrowiTreeDataProvider } from '../providers/treeDataProvider';
import { CacheManager } from '../utils/cache';
import { Logger } from '../utils/logger';

/**
 * @interface SyncSettings
 * @description リアルタイム同期に関する設定項目。
 */
interface SyncSettings {
    /** リアルタイム更新を有効にするか */
    enableRealTimeUpdates: boolean;
    /** プッシュ通知を有効にするか */
    enablePushNotifications: boolean;
    /** ツリービューの自動更新を有効にするか */
    enableAutoRefresh: boolean;
    /** 通知レベル ('all', 'important', 'none') */
    notificationLevel: 'all' | 'important' | 'none';
}

/**
 * @class RealtimeSyncManager
 * @description WebSocketクライアントからのイベントを元に、キャッシュの更新、UIの再描画、
 *              ユーザーへの通知など、高レベルのリアルタイム同期処理を管理します。
 */
export class RealtimeSyncManager {
    private webSocketClient: GrowiWebSocketClient;
    private treeDataProvider?: GrowiTreeDataProvider;
    private cacheManager?: CacheManager;
    private logger = Logger.getInstance();
    private settings: SyncSettings;

    /**
     * @constructor
     * @param {GrowiWebSocketClient} webSocketClient - WebSocketクライアントのインスタンス。
     */
    constructor(webSocketClient: GrowiWebSocketClient) {
        this.webSocketClient = webSocketClient;
        this.settings = this.loadSettings();
        this.setupWebSocketListeners();
        this.startConfigurationWatcher();
    }

    /**
     * @method setDependencies
     * @description 循環参照を避けるため、依存する他のコンポーネントを後から設定します。
     * @param {GrowiTreeDataProvider} treeDataProvider - ページツリーのデータプロバイダー。
     * @param {CacheManager} cacheManager - キャッシュマネージャー。
     */
    public setDependencies(treeDataProvider: GrowiTreeDataProvider, cacheManager: CacheManager): void {
        this.treeDataProvider = treeDataProvider;
        this.cacheManager = cacheManager;
    }

    /**
     * @method setupWebSocketListeners
     * @private
     * @description WebSocketクライアントからのイベントをリッスンし、対応するハンドラに接続します。
     */
    private setupWebSocketListeners(): void {
        this.webSocketClient.on('pageUpdated', (data) => this.handlePageUpdated(data));
        this.webSocketClient.on('pageCreated', (data) => this.handlePageCreated(data));
        this.webSocketClient.on('pageDeleted', (data) => this.handlePageDeleted(data));
    }

    /**
     * @method handlePageUpdated
     * @private
     * @description ページ更新イベントを処理します。
     */
    private handlePageUpdated(data: any): void {
        if (!this.settings.enableRealTimeUpdates) return;
        this.logger.info(`ページ更新イベント受信: ${data.title}`);
        
        // 関連するキャッシュを無効化
        this.cacheManager?.delete(`page:${data.pageId}`);
        this.cacheManager?.clearPageCacheByPath(data.path);
        
        // 設定に応じてツリービューを自動更新
        if (this.treeDataProvider && this.settings.enableAutoRefresh) {
            this.treeDataProvider.refresh();
        }
        
        // 設定に応じてユーザーに通知
        if (this.shouldShowNotification('update')) {
            this.showUpdateNotification(data);
        }
        
        // 他のコンポーネントが利用できるよう、内部コマンドを発行
        vscode.commands.executeCommand('growi.onPageUpdated', data);
    }

    /**
     * @method handlePageCreated
     * @private
     * @description ページ作成イベントを処理します。
     */
    private handlePageCreated(data: any): void {
        if (!this.settings.enableRealTimeUpdates) return;
        this.logger.info(`ページ作成イベント受信: ${data.title}`);
        if (this.treeDataProvider && this.settings.enableAutoRefresh) {
            this.treeDataProvider.refresh();
        }
        if (this.shouldShowNotification('create')) {
            this.showCreateNotification(data);
        }
        vscode.commands.executeCommand('growi.onPageCreated', data);
    }

    /**
     * @method handlePageDeleted
     * @private
     * @description ページ削除イベントを処理します。
     */
    private handlePageDeleted(data: any): void {
        if (!this.settings.enableRealTimeUpdates) return;
        this.logger.info(`ページ削除イベント受信: ${data.title}`);
        this.cacheManager?.delete(`page:${data.pageId}`);
        this.cacheManager?.clearPageCacheByPath(data.path);
        if (this.treeDataProvider && this.settings.enableAutoRefresh) {
            this.treeDataProvider.refresh();
        }
        if (this.shouldShowNotification('delete')) {
            this.showDeleteNotification(data);
        }
        vscode.commands.executeCommand('growi.onPageDeleted', data);
    }

    /**
     * @method shouldShowNotification
     * @private
     * @param {'update' | 'create' | 'delete'} type - イベントの種別。
     * @returns {boolean} 通知を表示すべきかどうか。
     * @description ユーザーの設定に基づいて、通知を表示するかどうかを判断します。
     */
    private shouldShowNotification(type: 'update' | 'create' | 'delete'): boolean {
        if (!this.settings.enablePushNotifications) return false;
        switch (this.settings.notificationLevel) {
            case 'none': return false;
            case 'important': return type === 'create' || type === 'delete'; // 作成と削除のみ通知
            case 'all': default: return true;
        }
    }

    /**
     * @method showUpdateNotification
     * @private
     * @description ページ更新の通知をVSCodeに表示します。
     */
    private showUpdateNotification(data: any): void {
        const message = `📝 "${data.title}" が ${data.updatedBy.name} によって更新されました。`;
        vscode.window.showInformationMessage(message, '開く', 'プレビュー', '設定').then(selection => {
            if (selection === '開く') vscode.commands.executeCommand('growi.openPage', { id: data.pageId, title: data.title, path: data.path });
            if (selection === 'プレビュー') vscode.commands.executeCommand('growi.previewPage', { id: data.pageId, title: data.title });
            if (selection === '設定') vscode.commands.executeCommand('workbench.action.openSettings', 'growi.realtime');
        });
    }

    /**
     * @method showCreateNotification
     * @private
     * @description ページ作成の通知をVSCodeに表示します。
     */
    private showCreateNotification(data: any): void {
        const message = `📄 新規ページ "${data.title}" が ${data.updatedBy.name} によって作成されました。`;
        vscode.window.showInformationMessage(message, '開く', '設定').then(selection => {
            if (selection === '開く') vscode.commands.executeCommand('growi.openPage', { id: data.pageId, title: data.title, path: data.path });
            if (selection === '設定') vscode.commands.executeCommand('workbench.action.openSettings', 'growi.realtime');
        });
    }

    /**
     * @method showDeleteNotification
     * @private
     * @description ページ削除の通知をVSCodeに表示します。
     */
    private showDeleteNotification(data: any): void {
        const message = `🗑️ ページ "${data.title}" が削除されました。`;
        vscode.window.showWarningMessage(message, '設定').then(selection => {
            if (selection === '設定') vscode.commands.executeCommand('workbench.action.openSettings', 'growi.realtime');
        });
    }

    /**
     * @method startConfigurationWatcher
     * @private
     * @description `settings.json`の変更を監視し、リアルタイム同期設定が変更された場合に再読み込みします。
     */
    private startConfigurationWatcher(): void {
        vscode.workspace.onDidChangeConfiguration(event => {
            if (event.affectsConfiguration('growi.realtime')) {
                this.settings = this.loadSettings();
                this.logger.info('リアルタイム同期設定が更新されました。');
            }
        });
    }

    /**
     * @method loadSettings
     * @private
     * @returns {SyncSettings} 読み込まれた設定。
     * @description VSCodeの設定からリアルタイム同期に関する設定を読み込みます。
     */
    private loadSettings(): SyncSettings {
        const config = vscode.workspace.getConfiguration('growi.realtime');
        return {
            enableRealTimeUpdates: config.get('enableRealTimeUpdates', true),
            enablePushNotifications: config.get('enablePushNotifications', true),
            enableAutoRefresh: config.get('enableAutoRefresh', true),
            notificationLevel: config.get('notificationLevel', 'important')
        };
    }

    /**
     * @method isActive
     * @returns {boolean} WebSocketが接続中かどうか。
     */
    public isActive(): boolean {
        return this.webSocketClient.isConnected();
    }

    /**
     * @method getWebSocketClient
     * @returns {GrowiWebSocketClient} 内部で使用しているWebSocketクライアントインスタンス。
     */
    public getWebSocketClient(): GrowiWebSocketClient {
        return this.webSocketClient;
    }

    /**
     * @method dispose
     * @description このマネージャーが使用するリソースを解放します。
     */
    public dispose(): void {
        // WebSocketクライアントのライフサイクルは、このクラスの所有者（通常はextension.ts）が管理する
    }
}