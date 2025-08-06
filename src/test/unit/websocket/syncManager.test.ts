/**
 * RealtimeSyncManager 単体テスト
 */

import { RealtimeSyncManager } from '../../../websocket/syncManager';
import { GrowiTreeDataProvider } from '../../../providers/treeDataProvider';
import { CacheManager } from '../../../utils/cache';
import { GrowiConnection } from '../../../api/types';
import * as testUtils from '../../testUtils';

// GrowiWebSocketClientのモック
jest.mock('../../../websocket/client');
import { GrowiWebSocketClient } from '../../../websocket/client';

const MockGrowiWebSocketClient = GrowiWebSocketClient as jest.MockedClass<typeof GrowiWebSocketClient>;

// VS Code APIのモック
const mockVSCode = testUtils.createMockVSCodeAPI();
(global as any).vscode = mockVSCode;

describe('RealtimeSyncManager', () => {
    let syncManager: RealtimeSyncManager;
    let mockTreeDataProvider: jest.Mocked<GrowiTreeDataProvider>;
    let mockCacheManager: jest.Mocked<CacheManager>;
    let mockConnection: GrowiConnection;
    let mockWebSocketClient: jest.Mocked<GrowiWebSocketClient>;

    beforeEach(() => {
        // モックをクリア
        jest.clearAllMocks();
        MockGrowiWebSocketClient.mockClear();

        // モックオブジェクトを作成
        mockTreeDataProvider = {
            refresh: jest.fn(),
        } as any;

        mockCacheManager = {
            delete: jest.fn(),
            clearPageCacheByPath: jest.fn(),
        } as any;

        mockConnection = testUtils.createMockGrowiConnection();

        // WebSocketクライアントのモックインスタンス
        mockWebSocketClient = {
            connect: jest.fn().mockResolvedValue(undefined),
            disconnect: jest.fn(),
            getConnectionState: jest.fn().mockReturnValue('disconnected'),
            on: jest.fn(),
            dispose: jest.fn(),
        } as any;

        MockGrowiWebSocketClient.mockImplementation(() => mockWebSocketClient);

        syncManager = new RealtimeSyncManager();
    });

    afterEach(() => {
        syncManager.dispose();
    });

    describe('constructor', () => {
        it('WebSocketクライアントが初期化される', () => {
            expect(MockGrowiWebSocketClient).toHaveBeenCalledTimes(1);
        });

        it('WebSocketイベントリスナーが設定される', () => {
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('pageUpdated', expect.any(Function));
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('pageCreated', expect.any(Function));
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('pageDeleted', expect.any(Function));
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('connected', expect.any(Function));
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('disconnected', expect.any(Function));
            expect(mockWebSocketClient.on).toHaveBeenCalledWith('error', expect.any(Function));
        });
    });

    describe('start', () => {
        it('正常にリアルタイム同期を開始できる', async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);

            expect(mockWebSocketClient.connect).toHaveBeenCalledWith(mockConnection);
            expect(syncManager.isActive()).toBe(false); // 接続状態はconnectedではないため
        });

        it('既に開始されている場合は何もしない', async () => {
            // 最初の開始
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);

            // 2回目の開始試行
            const connectSpy = jest.spyOn(mockWebSocketClient, 'connect');
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);

            // connectが再度呼ばれていないことを確認
            expect(connectSpy).toHaveBeenCalledTimes(0);
        });

        it('WebSocket接続エラー時にエラーを投げる', async () => {
            mockWebSocketClient.connect.mockRejectedValue(new Error('Connection failed'));

            await expect(
                syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager)
            ).rejects.toThrow('Connection failed');
        });
    });

    describe('stop', () => {
        it('リアルタイム同期を停止できる', async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);
            
            syncManager.stop();

            expect(mockWebSocketClient.disconnect).toHaveBeenCalledTimes(1);
            expect(syncManager.isActive()).toBe(false);
        });

        it('開始されていない場合でも安全に停止できる', () => {
            expect(() => syncManager.stop()).not.toThrow();
        });
    });

    describe('isActive', () => {
        it('WebSocket接続状態に応じて正しい値を返す', async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);

            // disconnected状態
            mockWebSocketClient.getConnectionState.mockReturnValue('disconnected');
            expect(syncManager.isActive()).toBe(false);

            // connected状態
            mockWebSocketClient.getConnectionState.mockReturnValue('connected');
            expect(syncManager.isActive()).toBe(true);
        });
    });

    describe('ページ更新イベント処理', () => {
        beforeEach(async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);
        });

        it('ページ更新イベントを正しく処理する', () => {
            const mockData = {
                pageId: 'test-page-id',
                title: 'Test Page',
                path: '/test/page',
                revision: 2
            };

            // pageUpdatedイベントのハンドラーを取得して実行
            const pageUpdatedHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'pageUpdated')?.[1];

            expect(pageUpdatedHandler).toBeDefined();
            pageUpdatedHandler!(mockData);

            // キャッシュが削除されることを確認
            expect(mockCacheManager.delete).toHaveBeenCalledWith('page:test-page-id');
            expect(mockCacheManager.clearPageCacheByPath).toHaveBeenCalledWith('/test/page');

            // ツリービューが更新されることを確認
            expect(mockTreeDataProvider.refresh).toHaveBeenCalledTimes(1);
        });

        it('ページ作成イベントを正しく処理する', () => {
            const mockData = {
                pageId: 'new-page-id',
                title: 'New Page',
                path: '/new/page'
            };

            const pageCreatedHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'pageCreated')?.[1];

            expect(pageCreatedHandler).toBeDefined();
            pageCreatedHandler!(mockData);

            // ツリービューが更新されることを確認
            expect(mockTreeDataProvider.refresh).toHaveBeenCalledTimes(1);
        });

        it('ページ削除イベントを正しく処理する', () => {
            const mockData = {
                pageId: 'deleted-page-id',
                title: 'Deleted Page',
                path: '/deleted/page'
            };

            const pageDeletedHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'pageDeleted')?.[1];

            expect(pageDeletedHandler).toBeDefined();
            pageDeletedHandler!(mockData);

            // キャッシュが削除されることを確認
            expect(mockCacheManager.delete).toHaveBeenCalledWith('page:deleted-page-id');
            expect(mockCacheManager.clearPageCacheByPath).toHaveBeenCalledWith('/deleted/page');

            // ツリービューが更新されることを確認
            expect(mockTreeDataProvider.refresh).toHaveBeenCalledTimes(1);
        });
    });

    describe('接続状態イベント処理', () => {
        beforeEach(async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);
        });

        it('接続確立時にツリービューを更新する', async () => {
            const connectedHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'connected')?.[1];

            expect(connectedHandler).toBeDefined();
            connectedHandler!();

            // 少し待ってツリービューが更新されることを確認
            await new Promise(resolve => setTimeout(resolve, 1100));
            expect(mockTreeDataProvider.refresh).toHaveBeenCalledTimes(1);
        });

        it('接続切断時に警告メッセージを表示する', () => {
            const disconnectedHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'disconnected')?.[1];

            expect(disconnectedHandler).toBeDefined();
            disconnectedHandler!();

            expect(mockVSCode.window.showWarningMessage).toHaveBeenCalledWith(
                expect.stringContaining('接続が切断されました')
            );
        });

        it('接続エラー時にエラーメッセージを表示する', () => {
            const errorHandler = mockWebSocketClient.on.mock.calls
                .find(call => call[0] === 'error')?.[1];

            const mockError = new Error('Connection error');

            expect(errorHandler).toBeDefined();
            errorHandler!(mockError);

            expect(mockVSCode.window.showErrorMessage).toHaveBeenCalledWith(
                expect.stringContaining('Connection error')
            );
        });
    });

    describe('通知レベル設定', () => {
        beforeEach(async () => {
            await syncManager.start(mockConnection, mockTreeDataProvider, mockCacheManager);
        });

        it('notificationLevel: "none" の場合は通知を表示しない', () => {
            // 設定をモック
            mockVSCode.workspace.getConfiguration.mockReturnValue({
                get: jest.fn((key: string, defaultValue: any) => {
                    if (key === 'notificationLevel') return 'none';
                    if (key === 'enablePushNotifications') return true;
                    return defaultValue;
                })
            } as any);

            // syncManagerを再作成して設定を反映
            syncManager.dispose();
            syncManager = new RealtimeSyncManager();

            const mockData = { pageId: 'test', title: 'Test', path: '/test' };
            
            // shouldShowNotificationメソッドをテスト（プライベートメソッドなのでany経由）
            const shouldShow = (syncManager as any).shouldShowNotification('update');
            expect(shouldShow).toBe(false);
        });

        it('notificationLevel: "important" の場合は作成・削除のみ通知する', () => {
            mockVSCode.workspace.getConfiguration.mockReturnValue({
                get: jest.fn((key: string, defaultValue: any) => {
                    if (key === 'notificationLevel') return 'important';
                    if (key === 'enablePushNotifications') return true;
                    return defaultValue;
                })
            } as any);

            syncManager.dispose();
            syncManager = new RealtimeSyncManager();

            expect((syncManager as any).shouldShowNotification('update')).toBe(false);
            expect((syncManager as any).shouldShowNotification('create')).toBe(true);
            expect((syncManager as any).shouldShowNotification('delete')).toBe(true);
        });
    });

    describe('dispose', () => {
        it('リソースを正しく解放する', () => {
            syncManager.dispose();

            expect(mockWebSocketClient.dispose).toHaveBeenCalledTimes(1);
        });
    });
});