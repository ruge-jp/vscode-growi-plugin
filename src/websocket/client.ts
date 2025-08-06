import { EventEmitter } from 'events';
import * as vscode from 'vscode';
import { Logger } from '../utils/logger';
import { GrowiConnection } from '../api/types';
import { WebSocketClient } from './webSocketClient';

// WebSocketメッセージの内部表現
interface WebSocketMessage {
    type: string;
    data: any;
    timestamp: number;
}

// ページ更新イベントのデータ構造
interface PageUpdateEvent {
    pageId: string;
    path: string;
    title: string;
    revision: number;
    updatedBy: { id: string; username: string; name: string; };
    updatedAt: Date;
}

/**
 * @enum {string} ConnectionStatus
 * @description WebSocketの接続状態を示します。
 */
export enum ConnectionStatus {
    DISCONNECTED = 'disconnected',
    CONNECTING = 'connecting',
    CONNECTED = 'connected',
    RECONNECTING = 'reconnecting',
    ERROR = 'error'
}

/**
 * @class GrowiWebSocketClient
 * @extends {EventEmitter}
 * @description GROWIサーバーとのWebSocket(Socket.IO)通信を管理し、リアルタイムイベントを処理します。
 *              接続状態はステータスバーに表示されます。
 */
export class GrowiWebSocketClient extends EventEmitter {
    private webSocketClient?: WebSocketClient;
    private connection?: GrowiConnection;
    private status: ConnectionStatus = ConnectionStatus.DISCONNECTED;
    private logger = Logger.getInstance();
    private statusBarItem: vscode.StatusBarItem;

    /**
     * @constructor
     */
    constructor() {
        super();
        // ステータスバーに表示するアイテムを作成
        this.statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 100);
        this.statusBarItem.command = 'growi.showWebSocketStatus'; // クリック時のコマンド
        this.updateStatusBar();
    }

    /**
     * @method connect
     * @param {GrowiConnection} connection - 接続情報。
     * @description WebSocketサーバーへの接続を開始します。
     */
    public async connect(connection: GrowiConnection): Promise<void> {
        this.logger.info('WebSocket接続を開始します...');
        if (this.status === ConnectionStatus.CONNECTED) {
            this.logger.warn('WebSocketは既に接続されています。');
            return;
        }

        this.connection = connection;
        this.status = ConnectionStatus.CONNECTING;
        this.updateStatusBar();

        try {
            const wsUrl = this.buildWebSocketUrl(connection);
            this.webSocketClient = new WebSocketClient(wsUrl, { maxReconnectAttempts: 5, reconnectInterval: 5000 });
            this.setupWebSocketHandlers();
            this.webSocketClient.connect();
        } catch (error) {
            this.handleConnectionError(error as Error);
        }
    }

    /**
     * @method disconnect
     * @description WebSocket接続を切断します。
     */
    public disconnect(): void {
        this.webSocketClient?.close();
    }

    /**
     * @method isConnected
     * @returns {boolean} 接続が確立しているかどうか。
     */
    public isConnected(): boolean {
        return this.status === ConnectionStatus.CONNECTED;
    }

    /**
     * @method getStatus
     * @returns {ConnectionStatus} 現在の接続状態。
     */
    public getStatus(): ConnectionStatus {
        return this.status;
    }

    /**
     * @method buildWebSocketUrl
     * @private
     * @description HTTP/HTTPSのURLからSocket.IO接続用のWSS/WS URLを構築します。
     */
    private buildWebSocketUrl(connection: GrowiConnection): string {
        const baseUrl = connection.serverUrl
            .replace(/^https?/, (match) => match === 'https' ? 'wss' : 'ws')
            .replace(/\/$/, '');
        // Socket.IO v4の接続文字列
        return `${baseUrl}/socket.io/?EIO=4&transport=websocket`;
    }

    /**
     * @method setupWebSocketHandlers
     * @private
     * @description WebSocketクライアントの各種イベントリスナーを設定します。
     */
    private setupWebSocketHandlers(): void {
        if (!this.webSocketClient) return;
        this.webSocketClient.on('open', this.handleOpen.bind(this));
        this.webSocketClient.on('message', this.handleMessage.bind(this));
        this.webSocketClient.on('close', this.handleClose.bind(this));
        this.webSocketClient.on('error', this.handleError.bind(this));
        this.webSocketClient.on('reconnecting', this.handleReconnecting.bind(this));
        this.webSocketClient.on('heartbeat', this.sendPing.bind(this));
        this.webSocketClient.on('reconnect_failed', this.handleReconnectFailed.bind(this));
    }

    /**
     * @method handleOpen
     * @private
     * @description 接続成功時のハンドラ。
     */
    private handleOpen(): void {
        this.status = ConnectionStatus.CONNECTED;
        this.updateStatusBar();
        this.logger.info('WebSocket接続が確立しました。');
        this.sendAuthMessage(); // 認証メッセージを送信
        this.emit('connected');
        vscode.window.showInformationMessage('GROWIサーバーにリアルタイム接続しました。');
    }

    /**
     * @method handleMessage
     * @private
     * @description メッセージ受信時のハンドラ。Socket.IOのメッセージ形式をパースし、イベントを発行します。
     */
    private handleMessage(data: any): void {
        try {
            const message = this.parseSocketIOMessage(data.toString());
            if (!message) return;

            this.logger.debug('WebSocketメッセージ受信:', message);
            switch (message.type) {
                case 'page:updated': this.handlePageUpdateEvent(message.data); break;
                // 他のイベントタイプもここに追加
                default: this.logger.debug('未処理のメッセージタイプ:', message.type);
            }
        } catch (error) {
            this.logger.error('WebSocketメッセージの処理に失敗しました:', error);
        }
    }

    /**
     * @method handleClose
     * @private
     * @description 接続切断時のハンドラ。
     */
    private handleClose(code: number): void {
        this.status = ConnectionStatus.DISCONNECTED;
        this.updateStatusBar();
        this.logger.info(`WebSocket接続が切断されました (コード: ${code})`);
        this.emit('disconnected', code);
    }

    /**
     * @method handleError
     * @private
     * @description エラー発生時のハンドラ。
     */
    private handleError(error: Error): void {
        this.logger.error('WebSocketエラー:', error);
        this.handleConnectionError(error);
    }

    /**
     * @method handleReconnectFailed
     * @private
     * @description 再接続失敗時のハンドラ。
     */
    private handleReconnectFailed(): void {
        this.status = ConnectionStatus.ERROR;
        this.updateStatusBar();
        this.logger.error('複数回の試行後、GROWIサーバーへの再接続に失敗しました。');
        this.emit('error', new Error('再接続に失敗しました。'));
        vscode.window.showErrorMessage('GROWIサーバーに再接続できませんでした。接続設定を確認してください。');
    }
    
    /**
     * @method handleReconnecting
     * @private
     * @description 再接続試行中のハンドラ。
     */
    private handleReconnecting(attempt: number): void {
        this.status = ConnectionStatus.RECONNECTING;
        this.updateStatusBar(attempt);
        this.logger.info(`再接続中... (試行回数: ${attempt})`);
    }

    /**
     * @method handleConnectionError
     * @private
     * @description 接続エラーを一元的に処理します。
     */
    private handleConnectionError(error: Error): void {
        this.status = ConnectionStatus.ERROR;
        this.updateStatusBar();
        this.logger.error('WebSocket接続エラー:', error);
        this.emit('error', error);
        vscode.window.showErrorMessage(`GROWIサーバーへの接続に失敗しました: ${error.message}`);
    }

    /**
     * @method sendAuthMessage
     * @private
     * @description 認証メッセージを送信します（現在はダミー）。
     */
    private sendAuthMessage(): void {
        // TODO: 実際の認証トークンを使用する
        const authMessage = { type: 'auth', data: { token: 'dummy-token' }, timestamp: Date.now() };
        this.sendMessage(authMessage);
    }
    
    /**
     * @method sendPing
     * @private
     * @description 接続維持のためのPingメッセージを送信します。
     */
    private sendPing(): void {
        this.sendMessage({ type: 'ping', data: {}, timestamp: Date.now() });
    }

    /**
     * @method sendMessage
     * @private
     * @description Socket.IO形式のメッセージを送信します。
     */
    private sendMessage(message: WebSocketMessage): void {
        if (!this.webSocketClient) return;
        // Socket.IOのメッセージ形式 '42["event", {data}]' にエンコード
        const socketIOMessage = `42${JSON.stringify([message.type, message.data])}`;
        this.webSocketClient.send(socketIOMessage);
    }

    /**
     * @method parseSocketIOMessage
     * @private
     * @description Socket.IO形式のメッセージをパースして内部形式に変換します。
     */
    private parseSocketIOMessage(data: string): WebSocketMessage | null {
        // '42'はSocket.IO v3/v4のメッセージプレフィックス
        if (data.startsWith('42')) {
            try {
                const parsed = JSON.parse(data.substring(2));
                if (Array.isArray(parsed) && parsed.length >= 2) {
                    return { type: parsed[0], data: parsed[1], timestamp: Date.now() };
                }
            } catch (error) {
                this.logger.warn('Socket.IOメッセージのパースに失敗しました:', error);
            }
        }
        return null;
    }

    /**
     * @method handlePageUpdateEvent
     * @private
     * @description ページ更新イベントを処理し、ユーザーに通知します。
     */
    private handlePageUpdateEvent(data: PageUpdateEvent): void {
        this.logger.info(`ページが更新されました: ${data.title} (${data.path})`);
        vscode.window.showInformationMessage(
            `📝 "${data.title}" が ${data.updatedBy.name} によって更新されました。`,
            '開く'
        ).then(selection => {
            if (selection === '開く') {
                vscode.commands.executeCommand('growi.openPage', { path: data.path, id: data.pageId, title: data.title });
            }
        });
        this.emit('pageUpdated', data);
    }
    
    // 他のイベントハンドラも同様に実装...

    /**
     * @method updateStatusBar
     * @private
     * @description 現在の接続状態に応じてステータスバーの表示を更新します。
     */
    private updateStatusBar(reconnectAttempt?: number): void {
        switch (this.status) {
            case ConnectionStatus.CONNECTED:
                this.statusBarItem.text = '$(radio-tower) GROWI Connected';
                this.statusBarItem.tooltip = 'GROWIサーバーに接続済みです。';
                this.statusBarItem.color = undefined;
                break;
            case ConnectionStatus.CONNECTING:
                this.statusBarItem.text = '$(sync~spin) GROWI Connecting...';
                this.statusBarItem.tooltip = 'GROWIサーバーに接続中です...';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
                break;
            case ConnectionStatus.RECONNECTING:
                this.statusBarItem.text = `$(sync~spin) GROWI Reconnecting... (${reconnectAttempt})`;
                this.statusBarItem.tooltip = 'GROWIサーバーに再接続中です...';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.warningForeground');
                break;
            case ConnectionStatus.ERROR:
                this.statusBarItem.text = '$(error) GROWI Connection Error';
                this.statusBarItem.tooltip = '接続エラーが発生しました。';
                this.statusBarItem.color = new vscode.ThemeColor('statusBarItem.errorForeground');
                break;
            case ConnectionStatus.DISCONNECTED:
            default:
                this.statusBarItem.text = '$(circle-slash) GROWI Disconnected';
                this.statusBarItem.tooltip = 'GROWIサーバーから切断されています。';
                this.statusBarItem.color = undefined;
                break;
        }
        this.statusBarItem.show();
    }

    /**
     * @method dispose
     * @description リソースを解放します。
     */
    public dispose(): void {
        this.disconnect();
        this.statusBarItem.dispose();
    }
}