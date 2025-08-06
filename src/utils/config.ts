import * as vscode from 'vscode';
import { GrowiConfig, GrowiConnection, SyncSettings, DisplaySettings } from '../api/types';
import { Logger } from './logger';

/**
 * @class ConfigManager
 * @description VSCodeの設定API(`settings.json`)とSecretStorage APIを介して、
 *              拡張機能の全設定を管理するクラス。
 */
export class ConfigManager {
    private logger = Logger.getInstance();
    private context: vscode.ExtensionContext;
    private config: vscode.WorkspaceConfiguration;

    /**
     * @constructor
     * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト。SecretStorageへのアクセスに必要。
     */
    constructor(context: vscode.ExtensionContext) {
        this.context = context;
        this.config = vscode.workspace.getConfiguration('growi');
        
        // 設定ファイル(`settings.json`)の変更を監視し、変更があった場合に`config`オブジェクトを最新の状態に保つ
        vscode.workspace.onDidChangeConfiguration(e => this.onConfigurationChanged(e), this);
    }

    /**
     * @method getConfig
     * @returns {GrowiConfig} 現在の拡張機能の全設定。
     */
    public getConfig(): GrowiConfig {
        return {
            connections: this.getConnections(),
            activeConnectionId: this.getActiveConnectionId(),
            syncSettings: this.getSyncSettings(),
            displaySettings: this.getDisplaySettings(),
            logLevel: this.getLogLevel()
        };
    }

    /**
     * @method getConnections
     * @returns {GrowiConnection[]} 保存されているすべての接続設定のリスト。
     */
    public getConnections(): GrowiConnection[] {
        const connections = this.config.get<GrowiConnection[]>('connections', []);
        // 実行時の状態（`connected`）は設定に保存しないため、デフォルト値を付与する
        return connections.map(conn => ({
            ...conn,
            connected: false,
            lastConnected: conn.lastConnected ? new Date(conn.lastConnected) : undefined
        }));
    }

    /**
     * @method addConnection
     * @param {Omit<GrowiConnection, 'id' | 'connected'>} connection - 追加する接続情報。
     * @description 新しい接続設定を追加します。IDは自動的に生成されます。
     */
    public async addConnection(connection: Omit<GrowiConnection, 'id' | 'connected'>): Promise<void> {
        const connections = this.getConnections();
        const newConnection: GrowiConnection = {
            ...connection,
            id: this.generateConnectionId(),
            connected: false
        };
        
        await this.config.update('connections', [...connections, newConnection], vscode.ConfigurationTarget.Global);
        this.logger.info(`新しい接続設定を追加しました: ${newConnection.name}`);
    }

    /**
     * @method updateConnection
     * @param {string} connectionId - 更新する接続のID。
     * @param {Partial<GrowiConnection>} updates - 更新する内容。
     */
    public async updateConnection(connectionId: string, updates: Partial<GrowiConnection>): Promise<void> {
        const connections = this.getConnections();
        const index = connections.findIndex(conn => conn.id === connectionId);
        if (index === -1) throw new Error(`接続設定が見つかりません: ${connectionId}`);
        
        connections[index] = { ...connections[index], ...updates };
        await this.config.update('connections', connections, vscode.ConfigurationTarget.Global);
        this.logger.info(`接続設定を更新しました: ${connectionId}`);
    }

    /**
     * @method removeConnection
     * @param {string} connectionId - 削除する接続のID。
     */
    public async removeConnection(connectionId: string): Promise<void> {
        const connections = this.getConnections();
        const filteredConnections = connections.filter(conn => conn.id !== connectionId);
        if (filteredConnections.length === connections.length) {
            throw new Error(`接続設定が見つかりません: ${connectionId}`);
        }
        
        await this.config.update('connections', filteredConnections, vscode.ConfigurationTarget.Global);
        
        // 削除された接続がアクティブだった場合、アクティブ接続IDをクリア
        if (this.getActiveConnectionId() === connectionId) {
            await this.setActiveConnectionId(undefined);
        }
        // 関連する認証トークンも削除
        await this.removeAuthToken(connectionId);
        
        this.logger.info(`接続設定を削除しました: ${connectionId}`);
    }

    /**
     * @method getActiveConnectionId
     * @returns {string | undefined} 現在アクティブな接続のID。
     */
    public getActiveConnectionId(): string | undefined {
        return this.config.get<string>('activeConnectionId');
    }

    /**
     * @method setActiveConnectionId
     * @param {string | undefined} connectionId - アクティブにする接続のID。
     */
    public async setActiveConnectionId(connectionId: string | undefined): Promise<void> {
        await this.config.update('activeConnectionId', connectionId, vscode.ConfigurationTarget.Global);
        this.logger.info(`アクティブな接続を設定しました: ${connectionId || 'なし'}`);
    }

    /**
     * @method getActiveConnection
     * @returns {GrowiConnection | undefined} 現在アクティブな接続の設定オブジェクト。
     */
    public getActiveConnection(): GrowiConnection | undefined {
        const activeId = this.getActiveConnectionId();
        return activeId ? this.getConnections().find(conn => conn.id === activeId) : undefined;
    }

    /**
     * @method getSyncSettings
     * @returns {SyncSettings} 同期に関する設定。
     */
    public getSyncSettings(): SyncSettings {
        const defaultSettings: SyncSettings = { autoSync: true, syncInterval: 30000, conflictResolution: 'manual' };
        return { ...defaultSettings, ...this.config.get<Partial<SyncSettings>>('syncSettings', {}) };
    }

    /**
     * @method updateSyncSettings
     * @param {Partial<SyncSettings>} settings - 更新する同期設定。
     */
    public async updateSyncSettings(settings: Partial<SyncSettings>): Promise<void> {
        const newSettings = { ...this.getSyncSettings(), ...settings };
        await this.config.update('syncSettings', newSettings, vscode.ConfigurationTarget.Global);
        this.logger.info('同期設定を更新しました。');
    }

    /**
     * @method getDisplaySettings
     * @returns {DisplaySettings} 表示に関する設定。
     */
    public getDisplaySettings(): DisplaySettings {
        const defaultSettings: DisplaySettings = { showIcons: true, sortBy: 'name', sortOrder: 'asc', filterBy: [], defaultExpandLevel: 2 };
        return { ...defaultSettings, ...this.config.get<Partial<DisplaySettings>>('displaySettings', {}) };
    }

    /**
     * @method updateDisplaySettings
     * @param {Partial<DisplaySettings>} settings - 更新する表示設定。
     */
    public async updateDisplaySettings(settings: Partial<DisplaySettings>): Promise<void> {
        const newSettings = { ...this.getDisplaySettings(), ...settings };
        await this.config.update('displaySettings', newSettings, vscode.ConfigurationTarget.Global);
        this.logger.info('表示設定を更新しました。');
    }

    /**
     * @method getLogLevel
     * @returns {'debug' | 'info' | 'warn' | 'error'} 現在のログレベル。
     */
    public getLogLevel(): 'debug' | 'info' | 'warn' | 'error' {
        return this.config.get<'debug' | 'info' | 'warn' | 'error'>('logLevel', 'info');
    }

    /**
     * @method onConfigurationChanged
     * @private
     * @description 設定変更イベントをハンドルし、内部状態を更新します。
     */
    private onConfigurationChanged(event: vscode.ConfigurationChangeEvent): void {
        if (event.affectsConfiguration('growi')) {
            this.config = vscode.workspace.getConfiguration('growi');
            this.logger.info('設定が変更されたため、再読み込みしました。');
            
            // ログレベルが変更された場合、Loggerインスタンスに即時反映
            if (event.affectsConfiguration('growi.logLevel')) {
                this.logger.setLogLevel(this.getLogLevel());
            }
        }
    }

    /**
     * @method generateConnectionId
     * @private
     * @returns {string} 一意な接続ID。
     */
    private generateConnectionId(): string {
        return `growi-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
    }

    // ============================================================================
    // 機密情報（認証トークン）の管理 (SecretStorage API)
    // `settings.json`に平文で保存するのを避けるため、OSのキーチェーン機能を利用します。
    // ============================================================================

    /**
     * @method storeAuthToken
     * @param {string} connectionId - 接続ID。
     * @param {string} token - 保存する認証トークン。
     * @description 認証トークンを安全な場所に保存します。
     */
    public async storeAuthToken(connectionId: string, token: string): Promise<void> {
        const key = `growi.auth.${connectionId}`;
        await this.context.secrets.store(key, token);
        this.logger.info(`認証トークンを保存しました: ${connectionId}`);
    }

    /**
     * @method getAuthToken
     * @param {string} connectionId - 接続ID。
     * @returns {Promise<string | undefined>} 保存されている認証トークン。
     * @description 保存されている認証トークンを安全に取得します。
     */
    public async getAuthToken(connectionId: string): Promise<string | undefined> {
        const key = `growi.auth.${connectionId}`;
        return this.context.secrets.get(key);
    }

    /**
     * @method removeAuthToken
     * @param {string} connectionId - 接続ID。
     * @description 保存されている認証トークンを削除します。
     */
    public async removeAuthToken(connectionId: string): Promise<void> {
        const key = `growi.auth.${connectionId}`;
        await this.context.secrets.delete(key);
        this.logger.info(`認証トークンを削除しました: ${connectionId}`);
    }
}
