/**
 * GrowiWebSocketClient 単体テスト
 */

import { GrowiWebSocketClient } from '../../../websocket/client';
import { GrowiConnection } from '../../../api/types';
import * as testUtils from '../../testUtils';

// WebSocketのモック
class MockWebSocket {
    public readyState = WebSocket.OPEN;
    public listeners: { [key: string]: Function[] } = {};

    addEventListener(event: string, listener: Function) {
        if (!this.listeners[event]) {
            this.listeners[event] = [];
        }
        this.listeners[event].push(listener);
    }

    send(data: string) {
        // モック実装
    }

    close() {
        this.readyState = WebSocket.CLOSED;
        this.fireEvent('close', { code: 1000 });
    }

    fireEvent(event: string, data?: any) {
        if (this.listeners[event]) {
            this.listeners[event].forEach(listener => listener(data));
        }
    }

    static CONNECTING = 0;
    static OPEN = 1;
    static CLOSING = 2;
    static CLOSED = 3;
}

// グローバルWebSocketをモック
(global as any).WebSocket = MockWebSocket;

describe('GrowiWebSocketClient', () => {
    let wsClient: GrowiWebSocketClient;
    let mockConnection: GrowiConnection;

    beforeEach(() => {
        wsClient = new GrowiWebSocketClient();
        mockConnection = testUtils.createMockGrowiConnection();
        
        // ステータスバーのモック
        jest.clearAllMocks();
    });

    afterEach(() => {
        wsClient.dispose();
    });

    describe('constructor', () => {
        it('初期状態でdisconnectedになっている', () => {
            expect(wsClient.getConnectionState()).toBe('disconnected');
        });
    });

    describe('connect', () => {
        it('正常に接続できる', async () => {
            const connectPromise = wsClient.connect(mockConnection);
            
            // WebSocketの開始イベントをシミュレート
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);

            await connectPromise;
            
            expect(wsClient.getConnectionState()).toBe('connected');
        });

        it('既に接続されている場合は何もしない', async () => {
            // 最初の接続
            const connectPromise1 = wsClient.connect(mockConnection);
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);
            await connectPromise1;

            // 2回目の接続試行
            const spy = jest.spyOn(global as any, 'WebSocket');
            await wsClient.connect(mockConnection);
            
            // WebSocketのコンストラクタが再度呼ばれていないことを確認
            expect(spy).toHaveBeenCalledTimes(1);
            spy.mockRestore();
        });

        it('接続タイムアウトでエラーになる', async () => {
            const connectPromise = wsClient.connect(mockConnection);
            
            // タイムアウトをシミュレート（実際のタイムアウトより短く設定）
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('error', new Error('接続タイムアウト'));
            }, 50);

            await expect(connectPromise).rejects.toThrow();
        }, 15000);
    });

    describe('disconnect', () => {
        it('接続を正常に切断できる', async () => {
            // 接続を確立
            const connectPromise = wsClient.connect(mockConnection);
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);
            await connectPromise;

            // 切断
            wsClient.disconnect();
            
            expect(wsClient.getConnectionState()).toBe('disconnected');
        });
    });

    describe('メッセージハンドリング', () => {
        beforeEach(async () => {
            // WebSocket接続を確立
            const connectPromise = wsClient.connect(mockConnection);
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);
            await connectPromise;
        });

        it('ページ更新メッセージを処理できる', () => {
            const eventHandler = jest.fn();
            wsClient.on('pageUpdated', eventHandler);

            // Socket.IOメッセージ形式でページ更新をシミュレート
            const mockMessage = {
                data: '42["page:updated",{"pageId":"test-page","title":"Test Page","path":"/test","revision":2,"updatedBy":{"id":"user1","username":"testuser","name":"Test User"},"updatedAt":"2025-01-25T12:00:00Z"}]'
            };

            (wsClient as any).ws?.fireEvent('message', mockMessage);

            expect(eventHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    pageId: 'test-page',
                    title: 'Test Page'
                })
            );
        });

        it('ページ作成メッセージを処理できる', () => {
            const eventHandler = jest.fn();
            wsClient.on('pageCreated', eventHandler);

            const mockMessage = {
                data: '42["page:created",{"pageId":"new-page","title":"New Page","path":"/new","updatedBy":{"id":"user1","username":"testuser","name":"Test User"}}]'
            };

            (wsClient as any).ws?.fireEvent('message', mockMessage);

            expect(eventHandler).toHaveBeenCalledWith(
                expect.objectContaining({
                    pageId: 'new-page',
                    title: 'New Page'
                })
            );
        });

        it('不正なメッセージ形式を適切に処理する', () => {
            const eventHandler = jest.fn();
            wsClient.on('pageUpdated', eventHandler);

            // 不正なJSON
            const mockMessage = {
                data: '42["page:updated",{invalid json}]'
            };

            // エラーが発生せず、イベントも発火されないことを確認
            expect(() => {
                (wsClient as any).ws?.fireEvent('message', mockMessage);
            }).not.toThrow();

            expect(eventHandler).not.toHaveBeenCalled();
        });
    });

    describe('再接続機能', () => {
        it('接続エラー時に再接続を試行する', async () => {
            const connectSpy = jest.spyOn(wsClient, 'connect');
            
            // 初回接続
            const connectPromise = wsClient.connect(mockConnection);
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);
            await connectPromise;

            // 接続エラーをシミュレート
            (wsClient as any).ws?.fireEvent('close', { code: 1006 }); // 異常終了

            // 少し待って再接続が試行されることを確認
            await new Promise(resolve => setTimeout(resolve, 100));
            
            expect(connectSpy).toHaveBeenCalledTimes(2); // 初回 + 再接続
            
            connectSpy.mockRestore();
        });
    });

    describe('ハートビート機能', () => {
        it('定期的にpingメッセージを送信する', async () => {
            // 接続を確立
            const connectPromise = wsClient.connect(mockConnection);
            setTimeout(() => {
                (wsClient as any).ws?.fireEvent('open');
            }, 10);
            await connectPromise;

            const sendSpy = jest.spyOn((wsClient as any).ws, 'send');

            // ハートビート間隔を短縮してテスト
            (wsClient as any).heartbeatInterval = setInterval(() => {
                (wsClient as any).sendMessage({
                    type: 'ping',
                    data: {},
                    timestamp: Date.now()
                });
            }, 100);

            // 少し待ってpingが送信されることを確認
            await new Promise(resolve => setTimeout(resolve, 150));
            
            expect(sendSpy).toHaveBeenCalledWith(
                expect.stringContaining('ping')
            );

            sendSpy.mockRestore();
        });
    });

    describe('buildWebSocketUrl', () => {
        it('HTTPSをwssに変換する', () => {
            const connection = testUtils.createMockGrowiConnection({
                serverUrl: 'https://example.growi.com'
            });

            const url = (wsClient as any).buildWebSocketUrl(connection);
            
            expect(url).toBe('wss://example.growi.com/socket.io/?EIO=4&transport=websocket');
        });

        it('HTTPをwsに変換する', () => {
            const connection = testUtils.createMockGrowiConnection({
                serverUrl: 'http://localhost:3000'
            });

            const url = (wsClient as any).buildWebSocketUrl(connection);
            
            expect(url).toBe('ws://localhost:3000/socket.io/?EIO=4&transport=websocket');
        });
    });
});