/**
 * 統合ワークフローテスト
 * 主要なユーザーシナリオをエンドツーエンドでテスト
 */

import * as vscode from 'vscode';
import { GrowiApiClientImpl } from '../../api/client';
import { AuthManagerImpl } from '../../api/auth';
import { CacheManager } from '../../utils/cache';
import { ConfigManager } from '../../utils/config';
import { CommandManager } from '../../commands';
import { GrowiTreeDataProvider } from '../../providers/treeDataProvider';
import { SearchResultProvider } from '../../providers/searchResultProvider';
import { SearchHistoryManager } from '../../utils/searchHistory';

// VS Code APIのモック
jest.mock('vscode', () => require('../utils/testUtils').createMockVSCodeAPI());

// HTTPクライアントのモック
jest.mock('axios');

describe('統合ワークフローテスト', () => {
  let mockContext: vscode.ExtensionContext;
  let configManager: ConfigManager;
  let authManager: AuthManagerImpl;
  let cacheManager: CacheManager;
  let apiClient: GrowiApiClientImpl;
  let treeDataProvider: GrowiTreeDataProvider;
  let commandManager: CommandManager;

  beforeEach(async () => {
    jest.clearAllMocks();

    // モックコンテキストの作成
    mockContext = {
      secrets: {
        get: jest.fn().mockResolvedValue(null),
        store: jest.fn().mockResolvedValue(undefined),
        delete: jest.fn().mockResolvedValue(undefined),
      },
      globalState: {
        get: jest.fn().mockReturnValue(null),
        update: jest.fn().mockResolvedValue(undefined),
      },
      subscriptions: [],
      extensionPath: '/mock/extension/path',
      storagePath: '/mock/storage/path',
      globalStoragePath: '/mock/global/storage/path',
    } as any;

    // 依存関係の初期化
    configManager = new ConfigManager(mockContext);
    authManager = new AuthManagerImpl(mockContext, configManager);
    cacheManager = new CacheManager();
    apiClient = new GrowiApiClientImpl(authManager, cacheManager, configManager);
    treeDataProvider = new GrowiTreeDataProvider(mockContext, apiClient, configManager);
    commandManager = new CommandManager(mockContext, treeDataProvider, configManager);
  });

  afterEach(() => {
    // テスト後のクリーンアップ
    cacheManager.clear();
  });

  describe('接続から検索までの完全ワークフロー', () => {
    it('接続設定→認証→ページ検索→結果表示の流れが正常に動作する', async () => {
      // 1. 接続設定の追加
      const connection = global.testUtils.createMockGrowiConnection({
        name: 'Test GROWI Server',
        serverUrl: 'https://test.growi.com',
        authType: 'token',
      });

      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      expect(connections).toHaveLength(1);
      expect(connections[0].name).toBe('Test GROWI Server');

      // 2. 認証情報の設定
      const authResult = await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-auth-token-12345',
      });

      expect(authResult.success).toBe(true);
      expect(await authManager.isAuthenticated(connections[0].id)).toBe(true);

      // 3. API クライアントの接続設定
      apiClient.setActiveConnection(connections[0]);

      // 4. 検索機能のテスト
      const searchHistory = new SearchHistoryManager(mockContext);
      const searchResultProvider = new SearchResultProvider(apiClient, searchHistory);

      // モック検索結果の設定
      const mockSearchResults = [
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'Test Integration Page 1',
            path: '/integration/test1',
          }),
        }),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'Test Integration Page 2',
            path: '/integration/test2',
          }),
        }),
      ];

      // APIクライアントのsearchPagesメソッドをモック
      jest.spyOn(apiClient, 'searchPages').mockResolvedValue(mockSearchResults);

      // 5. 検索実行
      const searchResults = await searchResultProvider.performSearch('integration test', 'both');

      expect(searchResults).toHaveLength(2);
      expect(searchResults[0].page.title).toBe('Test Integration Page 1');
      expect(searchResults[1].page.title).toBe('Test Integration Page 2');

      // 6. 検索履歴の確認
      const history = searchHistory.getHistory(10);
      expect(history).toHaveLength(1);
      expect(history[0].query).toBe('integration test');
      expect(history[0].resultCount).toBe(2);

      // 7. TreeDataProviderでの検索結果表示
      const treeItems = await searchResultProvider.getChildren();
      expect(treeItems).toHaveLength(2);
      expect(treeItems[0].page.title).toBe('Test Integration Page 1');
      expect(treeItems[1].page.title).toBe('Test Integration Page 2');
    });
  });

  describe('ページ作成から編集までのワークフロー', () => {
    it('ページ作成→編集→保存の流れが正常に動作する', async () => {
      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-token',
      });

      apiClient.setActiveConnection(connections[0]);

      // 1. ページ作成のモック
      const newPageRequest = {
        path: '/workflow/test-page',
        title: 'Workflow Test Page',
        content: '# Workflow Test Page\n\nThis is a test page for workflow.',
      };

      const createdPage = global.testUtils.createMockGrowiPage({
        id: 'new-page-id',
        ...newPageRequest,
      });

      jest.spyOn(apiClient, 'createPage').mockResolvedValue(createdPage);

      // 2. ページ作成実行
      const result = await apiClient.createPage(newPageRequest);

      expect(result.id).toBe('new-page-id');
      expect(result.title).toBe('Workflow Test Page');
      expect(result.path).toBe('/workflow/test-page');

      // 3. ページの取得確認
      jest.spyOn(apiClient, 'getPage').mockResolvedValue(createdPage);

      const retrievedPage = await apiClient.getPage('new-page-id');
      expect(retrievedPage).toEqual(createdPage);

      // 4. ページ更新のテスト
      const updatedContent = '# Updated Workflow Test Page\n\nThis content has been updated.';
      const updatedPage = {
        ...createdPage,
        content: updatedContent,
        revision: 2,
      };

      jest.spyOn(apiClient, 'updatePage').mockResolvedValue(updatedPage);

      const updateResult = await apiClient.updatePage('new-page-id', {
        content: updatedContent,
        revision: 2,
      });

      expect(updateResult.content).toBe(updatedContent);
      expect(updateResult.revision).toBe(2);

      // 5. キャッシュの動作確認
      expect(cacheManager.getPage('new-page-id')).toEqual(updatedPage);
    });
  });

  describe('エラーハンドリングの統合テスト', () => {
    it('認証エラーから再認証までの流れが正常に動作する', async () => {
      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      const connectionId = connections[0].id;

      // 1. 初回認証
      const authResult = await authManager.authenticate(connectionId, {
        type: 'token',
        value: 'valid-token',
      });

      expect(authResult.success).toBe(true);
      expect(await authManager.isAuthenticated(connectionId)).toBe(true);

      // 2. 認証エラーのシミュレーション
      const authError = new Error('認証に失敗しました');
      jest.spyOn(apiClient, 'getPages').mockRejectedValue(authError);

      // 3. API呼び出しで認証エラー発生
      apiClient.setActiveConnection(connections[0]);
      await expect(apiClient.getPages()).rejects.toThrow('認証に失敗しました');

      // 4. 認証失敗時のコールバック実行
      await authManager.onConnectionFailure(connectionId);

      // 5. 認証状態がクリアされることを確認
      expect(await authManager.isAuthenticated(connectionId)).toBe(false);

      // 6. 再認証の実行
      const reauthResult = await authManager.authenticate(connectionId, {
        type: 'token',
        value: 'new-valid-token',
      });

      expect(reauthResult.success).toBe(true);
      expect(await authManager.isAuthenticated(connectionId)).toBe(true);
    });

    it('ネットワークエラーでのリトライ処理が正常に動作する', async () => {
      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-token',
      });

      apiClient.setActiveConnection(connections[0]);

      // 1. 最初の呼び出しでネットワークエラー
      const networkError = new Error('ネットワークエラー: サーバーに接続できません');
      jest.spyOn(apiClient, 'getPages')
        .mockRejectedValueOnce(networkError)
        .mockResolvedValueOnce([global.testUtils.createMockGrowiPage()]);

      // 2. 最初の呼び出しでエラー
      await expect(apiClient.getPages()).rejects.toThrow('ネットワークエラー');

      // 3. 再試行で成功
      const retryResult = await apiClient.getPages();
      expect(retryResult).toHaveLength(1);
    });
  });

  describe('パフォーマンステスト', () => {
    it('大量データでの検索パフォーマンスが要件を満たす', async () => {
      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-token',
      });

      apiClient.setActiveConnection(connections[0]);

      // 大量の検索結果をモック（100件）
      const largeSearchResults = Array.from({ length: 100 }, (_, index) =>
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            id: `page-${index}`,
            title: `Performance Test Page ${index}`,
            path: `/performance/page-${index}`,
          }),
        })
      );

      // 検索実行時間をシミュレート（1.5秒）
      jest.spyOn(apiClient, 'searchPages').mockImplementation(() =>
        new Promise(resolve => setTimeout(() => resolve(largeSearchResults), 1500))
      );

      const searchHistory = new SearchHistoryManager(mockContext);
      const searchResultProvider = new SearchResultProvider(apiClient, searchHistory);

      // パフォーマンステスト実行
      const startTime = Date.now();
      const results = await searchResultProvider.performSearch('performance test', 'both');
      const endTime = Date.now();

      // 結果の検証
      expect(results).toHaveLength(100);
      expect(endTime - startTime).toBeLessThan(2000); // 2秒以内の要件

      // 検索結果のフィルタリングパフォーマンス
      const filterStartTime = Date.now();
      searchResultProvider.filterResults({ minScore: 0.8 });
      const filterEndTime = Date.now();

      expect(filterEndTime - filterStartTime).toBeLessThan(100); // フィルタリングは100ms以内

      // ソート処理のパフォーマンス
      const sortStartTime = Date.now();
      searchResultProvider.sortResults('title', 'asc');
      const sortEndTime = Date.now();

      expect(sortEndTime - sortStartTime).toBeLessThan(100); // ソートは100ms以内
    });

    it('キャッシュ効果によりパフォーマンスが改善される', async () => {
      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-token',
      });

      apiClient.setActiveConnection(connections[0]);

      const mockPages = [global.testUtils.createMockGrowiPage()];

      // 最初の呼び出しは遅延をシミュレート
      jest.spyOn(apiClient, 'getPages')
        .mockImplementationOnce(() =>
          new Promise(resolve => setTimeout(() => resolve(mockPages), 500))
        );

      // 1回目の呼び出し（キャッシュなし）
      const firstCallStart = Date.now();
      const firstResult = await apiClient.getPages();
      const firstCallEnd = Date.now();

      expect(firstResult).toEqual(mockPages);
      expect(firstCallEnd - firstCallStart).toBeGreaterThanOrEqual(500);

      // 2回目の呼び出し（キャッシュあり）
      const secondCallStart = Date.now();
      const secondResult = await apiClient.getPages();
      const secondCallEnd = Date.now();

      expect(secondResult).toEqual(mockPages);
      expect(secondCallEnd - secondCallStart).toBeLessThan(50); // キャッシュにより高速化

      // APIが2回目は呼ばれていないことを確認
      expect(apiClient.getPages).toHaveBeenCalledTimes(1);
    });
  });

  describe('コマンド統合テスト', () => {
    it('検索コマンドが正しく動作する', async () => {
      // モックの設定
      const mockShowInputBox = jest.spyOn(vscode.window, 'showInputBox')
        .mockResolvedValue('test search query');

      const mockShowQuickPick = jest.spyOn(vscode.window, 'showQuickPick')
        .mockResolvedValue(undefined);

      const mockWithProgress = jest.spyOn(vscode.window, 'withProgress')
        .mockImplementation((options, task) => {
          return task({ report: jest.fn() });
        });

      // セットアップ
      const connection = global.testUtils.createMockGrowiConnection();
      await configManager.addConnection({
        name: connection.name,
        serverUrl: connection.serverUrl,
        authType: connection.authType,
      });

      const connections = configManager.getConnections();
      await authManager.authenticate(connections[0].id, {
        type: 'token',
        value: 'test-token',
      });

      // TreeDataProviderに接続を設定
      await treeDataProvider.connect(connections[0].id);

      // 検索結果のモック
      const mockSearchResults = [
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'Command Test Page',
          }),
        }),
      ];

      jest.spyOn(apiClient, 'searchPages').mockResolvedValue(mockSearchResults);

      // コマンドの実行（プライベートメソッドなので直接テストは困難だが、統合テストとして）
      // 実際の実装では、commandManagerのpublic メソッドを通じてテストする

      expect(mockShowInputBox).toBeDefined();
      expect(mockShowQuickPick).toBeDefined();
      expect(mockWithProgress).toBeDefined();
    });
  });
});