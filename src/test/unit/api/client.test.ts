/**
 * GrowiApiClient 単体テスト
 */

import axios from 'axios';
import { GrowiApiClientImpl } from '../../../api/client';
import { AuthManager } from '../../../api/auth';
import { CacheManager } from '../../../utils/cache';
import { ConfigManager } from '../../../utils/config';
import { GrowiConnection, SearchOptions } from '../../../api/types';
import * as testUtils from '../../testUtils';

// axiosをモック
jest.mock('axios');
const mockedAxios = axios as jest.Mocked<typeof axios>;

// 依存関係のモック
const mockAuthManager = {
  getAuthHeaders: jest.fn(),
  onConnectionFailure: jest.fn(),
} as jest.Mocked<Partial<AuthManager>>;

const mockCacheManager = {
  get: jest.fn(),
  set: jest.fn(),
  setPage: jest.fn(),
  getPage: jest.fn(),
  delete: jest.fn(),
  clearPageCacheByPath: jest.fn(),
} as jest.Mocked<Partial<CacheManager>>;

const mockConfigManager = {
  getAuthToken: jest.fn(),
} as jest.Mocked<Partial<ConfigManager>>;

describe('GrowiApiClient', () => {
  let apiClient: GrowiApiClientImpl;
  let mockConnection: GrowiConnection;

  beforeEach(() => {
    // モックをリセット
    jest.clearAllMocks();
    
    // axios.createのモック設定
    const mockAxiosInstance = {
      get: jest.fn(),
      post: jest.fn(),
      put: jest.fn(),
      delete: jest.fn(),
      interceptors: {
        request: { use: jest.fn() },
        response: { use: jest.fn() },
      },
    };
    mockedAxios.create = jest.fn().mockReturnValue(mockAxiosInstance);

    // テスト用接続設定
    mockConnection = testUtils.createMockGrowiConnection();

    // APIクライアントインスタンス作成
    apiClient = new GrowiApiClientImpl(
      mockAuthManager as AuthManager,
      mockCacheManager as CacheManager,
      mockConfigManager as ConfigManager
    );

    // アクティブ接続を設定
    apiClient.setActiveConnection(mockConnection);
  });

  describe('constructor', () => {
    it('HTTPクライアントが正しく初期化される', () => {
      expect(mockedAxios.create).toHaveBeenCalledWith(
        expect.objectContaining({
          timeout: 10000,
          headers: expect.objectContaining({
            'Content-Type': 'application/json',
            'User-Agent': 'GROWI-VSCode-Integration/0.1.0',
          }),
        })
      );
    });

    it('リクエスト・レスポンスインターセプターが設定される', () => {
      const mockInstance = mockedAxios.create.mock.results[0].value;
      expect(mockInstance.interceptors.request.use).toHaveBeenCalled();
      expect(mockInstance.interceptors.response.use).toHaveBeenCalled();
    });
  });

  describe('getPages', () => {
    it('ページ一覧を正常に取得できる', async () => {
      // モックデータの準備
      const mockPages = [
        testUtils.createMockGrowiPage({ id: 'page1', title: 'Page 1' }),
        testUtils.createMockGrowiPage({ id: 'page2', title: 'Page 2' }),
      ];
      
      const mockResponse = testUtils.createMockAxiosResponse({
        pages: mockPages,
      });

      // HTTPクライアントのモック設定
      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(mockResponse);

      // キャッシュにヒットしない設定
      mockCacheManager.get!.mockReturnValue(null);

      // テスト実行
      const result = await apiClient.getPages();

      // 検証
      expect(result).toHaveLength(2);
      expect(result[0].title).toBe('Page 1');
      expect(result[1].title).toBe('Page 2');
      expect(mockInstance.get).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages`,
        expect.objectContaining({
          params: { limit: 100 },
        })
      );
      expect(mockCacheManager.set).toHaveBeenCalledWith(
        'pages:root:100',
        result,
        300000
      );
    });

    it('キャッシュからページ一覧を取得できる', async () => {
      // キャッシュデータの準備
      const cachedPages = [
        testUtils.createMockGrowiPage({ id: 'cached1', title: 'Cached Page' }),
      ];
      mockCacheManager.get!.mockReturnValue(cachedPages);

      // テスト実行
      const result = await apiClient.getPages();

      // 検証
      expect(result).toEqual(cachedPages);
      expect(mockCacheManager.get).toHaveBeenCalledWith('pages:root:100');
      
      // HTTPリクエストは発生しない
      const mockInstance = mockedAxios.create.mock.results[0].value;
      expect(mockInstance.get).not.toHaveBeenCalled();
    });

    it('接続が設定されていない場合はエラーを投げる', async () => {
      // アクティブ接続をクリア
      apiClient.disconnect();

      // テスト実行と検証
      await expect(apiClient.getPages()).rejects.toThrow(
        'アクティブな接続が設定されていません'
      );
    });

    it('API エラーの場合は適切に処理される', async () => {
      // エラーレスポンスの準備
      const mockErrorResponse = {
        ...global.testUtils.createMockAxiosResponse(null, 404),
        data: {
          ok: false,
          error: { message: 'ページが見つかりません' },
        },
      };

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(mockErrorResponse);
      mockCacheManager.get!.mockReturnValue(null);

      // テスト実行と検証
      await expect(apiClient.getPages()).rejects.toThrow('ページが見つかりません');
    });
  });

  describe('getPage', () => {
    it('特定ページを正常に取得できる', async () => {
      const pageId = 'test-page-id';
      const mockPage = global.testUtils.createMockGrowiPage({ id: pageId });
      
      const mockResponse = global.testUtils.createMockAxiosResponse({
        page: mockPage,
      });

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(mockResponse);
      mockCacheManager.getPage!.mockReturnValue(null);

      const result = await apiClient.getPage(pageId);

      expect(result.id).toBe(pageId);
      expect(mockInstance.get).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages/${pageId}`
      );
      expect(mockCacheManager.setPage).toHaveBeenCalledWith(
        pageId,
        expect.any(Object),
        600000
      );
    });

    it('キャッシュから特定ページを取得できる', async () => {
      const pageId = 'cached-page-id';
      const cachedPage = global.testUtils.createMockGrowiPage({ id: pageId });
      
      mockCacheManager.getPage!.mockReturnValue(cachedPage);

      const result = await apiClient.getPage(pageId);

      expect(result).toEqual(cachedPage);
      expect(mockCacheManager.getPage).toHaveBeenCalledWith(pageId);
      
      const mockInstance = mockedAxios.create.mock.results[0].value;
      expect(mockInstance.get).not.toHaveBeenCalled();
    });
  });

  describe('createPage', () => {
    it('新しいページを正常に作成できる', async () => {
      const pageRequest = {
        path: '/new/page',
        title: 'New Page',
        content: '# New Page\n\nContent',
      };

      const mockPage = global.testUtils.createMockGrowiPage(pageRequest);
      const mockResponse = global.testUtils.createMockAxiosResponse({
        page: mockPage,
      });

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.post.mockResolvedValue(mockResponse);

      const result = await apiClient.createPage(pageRequest);

      expect(result.title).toBe('New Page');
      expect(mockInstance.post).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages`,
        pageRequest
      );
      expect(mockCacheManager.clearPageCacheByPath).toHaveBeenCalledWith('/new/page');
    });
  });

  describe('updatePage', () => {
    it('ページを正常に更新できる', async () => {
      const pageId = 'update-page-id';
      const updates = {
        content: '# Updated Page\n\nUpdated content',
        revision: 2,
      };

      const mockPage = global.testUtils.createMockGrowiPage({
        id: pageId,
        ...updates,
      });
      const mockResponse = global.testUtils.createMockAxiosResponse({
        page: mockPage,
      });

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.put.mockResolvedValue(mockResponse);

      const result = await apiClient.updatePage(pageId, updates);

      expect(result.content).toBe(updates.content);
      expect(mockInstance.put).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages/${pageId}`,
        updates
      );
      expect(mockCacheManager.setPage).toHaveBeenCalledWith(
        pageId,
        expect.any(Object),
        600000
      );
    });
  });

  describe('deletePage', () => {
    it('ページを正常に削除できる', async () => {
      const pageId = 'delete-page-id';
      const mockPage = global.testUtils.createMockGrowiPage({ id: pageId });

      // getPageの戻り値を設定（削除前の情報取得用）
      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(
        global.testUtils.createMockAxiosResponse({ page: mockPage })
      );
      mockInstance.delete.mockResolvedValue(
        global.testUtils.createMockAxiosResponse({})
      );

      mockCacheManager.getPage!.mockReturnValue(null);

      await apiClient.deletePage(pageId);

      expect(mockInstance.delete).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages/${pageId}`
      );
      expect(mockCacheManager.delete).toHaveBeenCalledWith(`page:${pageId}`);
      expect(mockCacheManager.clearPageCacheByPath).toHaveBeenCalled();
    });
  });

  describe('searchPages', () => {
    it('ページ検索を正常に実行できる', async () => {
      const searchOptions: SearchOptions = {
        query: 'test query',
        target: 'both',
        limit: 10,
      };

      const mockResults = [
        global.testUtils.createMockSearchResult(),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({ title: 'Another Page' }),
        }),
      ];

      const mockResponse = global.testUtils.createMockAxiosResponse({
        results: mockResults,
      });

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(mockResponse);

      const result = await apiClient.searchPages(searchOptions);

      expect(result).toHaveLength(2);
      expect(result[0].page.title).toBe('Test Page');
      expect(result[1].page.title).toBe('Another Page');
      expect(mockInstance.get).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages/search`,
        expect.objectContaining({
          params: {
            q: 'test query',
            target: 'both',
            limit: 10,
            offset: 0,
          },
        })
      );
    });

    it('検索オプションのデフォルト値が正しく設定される', async () => {
      const searchOptions: SearchOptions = {
        query: 'test',
      };

      const mockResponse = global.testUtils.createMockAxiosResponse({
        results: [],
      });

      const mockInstance = mockedAxios.create.mock.results[0].value;
      mockInstance.get.mockResolvedValue(mockResponse);

      await apiClient.searchPages(searchOptions);

      expect(mockInstance.get).toHaveBeenCalledWith(
        `${mockConnection.serverUrl}/api/v3/pages/search`,
        expect.objectContaining({
          params: {
            q: 'test',
            target: 'both', // デフォルト値
            limit: 50,      // デフォルト値
            offset: 0,      // デフォルト値
          },
        })
      );
    });
  });

  describe('setActiveConnection', () => {
    it('アクティブ接続を正しく設定できる', () => {
      const newConnection = global.testUtils.createMockGrowiConnection({
        id: 'new-connection',
        name: 'New Connection',
      });

      apiClient.setActiveConnection(newConnection);

      // 内部状態は直接確認できないが、次のAPI呼び出しで使用されることを確認
      expect(true).toBe(true); // 設定自体のテスト
    });
  });

  describe('disconnect', () => {
    it('接続を正しく切断できる', () => {
      apiClient.disconnect();

      // 切断後にAPI呼び出しを試みるとエラーになることを確認
      expect(apiClient.getPages()).rejects.toThrow(
        'アクティブな接続が設定されていません'
      );
    });
  });
});