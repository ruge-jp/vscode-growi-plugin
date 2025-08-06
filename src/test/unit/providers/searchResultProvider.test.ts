/**
 * SearchResultProvider 単体テスト
 */

import * as vscode from 'vscode';
import { SearchResultProvider } from '../../../providers/searchResultProvider';
import { GrowiApiClient } from '../../../api/client';
import { SearchHistoryManager } from '../../../utils/searchHistory';

// VS Code APIのモック
jest.mock('vscode', () => require("../utils/testUtils").createMockVSCodeAPI());

// 依存関係のモック
const mockApiClient = {
  searchPages: jest.fn(),
} as jest.Mocked<Partial<GrowiApiClient>>;

const mockSearchHistory = {
  addSearch: jest.fn(),
} as jest.Mocked<Partial<SearchHistoryManager>>;

describe('SearchResultProvider', () => {
  let searchResultProvider: SearchResultProvider;

  beforeEach(() => {
    jest.clearAllMocks();

    searchResultProvider = new SearchResultProvider(
      mockApiClient as GrowiApiClient,
      mockSearchHistory as SearchHistoryManager
    );
  });

  describe('constructor', () => {
    it('正しく初期化される', () => {
      expect(searchResultProvider).toBeInstanceOf(SearchResultProvider);
      expect(searchResultProvider.getResultCount()).toBe(0);
      expect(searchResultProvider.getCurrentQuery()).toBe('');
      expect(searchResultProvider.isSearching()).toBe(false);
    });
  });

  describe('getTreeItem', () => {
    it('検索結果アイテムのTreeItemを正しく生成する', () => {
      const mockPage = global.testUtils.createMockGrowiPage({
        title: 'Test Search Result',
        path: '/search/result',
        pageType: 'normal',
      });

      const searchResultItem = {
        id: 'search-1',
        page: mockPage,
        snippet: 'This is a test snippet with highlighted content',
        score: 0.95,
      };

      const treeItem = searchResultProvider.getTreeItem(searchResultItem);

      expect(treeItem.label).toBe('Test Search Result');
      expect(treeItem.description).toBe('/search/result');
      expect(treeItem.contextValue).toBe('searchResult');
      expect(treeItem.command).toEqual({
        command: 'growi.openSearchResult',
        title: 'ページを開く',
        arguments: [searchResultItem],
      });
    });

    it('ページタイプに応じた適切なアイコンを設定する', () => {
      const testCases = [
        { pageType: 'normal', expectedIcon: 'file' },
        { pageType: 'template', expectedIcon: 'file-code' },
        { pageType: 'deleted', expectedIcon: 'trash' },
        { pageType: 'private', expectedIcon: 'lock' },
      ];

      testCases.forEach(({ pageType, expectedIcon }) => {
        const mockPage = global.testUtils.createMockGrowiPage({ pageType });
        const searchResultItem = {
          id: `search-${pageType}`,
          page: mockPage,
          snippet: 'test snippet',
          score: 0.8,
        };

        const treeItem = searchResultProvider.getTreeItem(searchResultItem);
        expect((treeItem.iconPath as vscode.ThemeIcon).id).toBe(expectedIcon);
      });
    });
  });

  describe('getChildren', () => {
    it('ルートレベルで検索結果一覧を返す', async () => {
      // 検索結果を設定
      const mockResults = [
        global.testUtils.createMockSearchResult(),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({ title: 'Second Result' }),
        }),
      ];

      mockApiClient.searchPages!.mockResolvedValue(mockResults);
      await searchResultProvider.performSearch('test query');

      const children = await searchResultProvider.getChildren();

      expect(children).toHaveLength(2);
      expect(children[0].page.title).toBe('Test Page');
      expect(children[1].page.title).toBe('Second Result');
    });

    it('子要素がある場合は空配列を返す', async () => {
      const mockResultItem = {
        id: 'search-1',
        page: global.testUtils.createMockGrowiPage(),
        snippet: 'test',
        score: 0.8,
      };

      const children = await searchResultProvider.getChildren(mockResultItem);
      expect(children).toEqual([]);
    });
  });

  describe('performSearch', () => {
    it('基本的な検索を正常に実行できる', async () => {
      const query = 'test search query';
      const target = 'both';
      const mockResults = [
        global.testUtils.createMockSearchResult(),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({ title: 'Another Page' }),
        }),
      ];

      mockApiClient.searchPages!.mockResolvedValue(mockResults);

      const results = await searchResultProvider.performSearch(query, target);

      expect(results).toHaveLength(2);
      expect(mockApiClient.searchPages).toHaveBeenCalledWith({
        query,
        target,
        limit: 50,
        offset: 0,
      });
      expect(mockSearchHistory.addSearch).toHaveBeenCalledWith(query, target, 2);
      expect(searchResultProvider.getCurrentQuery()).toBe(query);
      expect(searchResultProvider.getResultCount()).toBe(2);
    });

    it('検索オプションが正しく適用される', async () => {
      const query = 'advanced search';
      const target = 'title';
      const options = {
        limit: 25,
        includeSnippets: true,
        enableHighlight: true,
      };

      mockApiClient.searchPages!.mockResolvedValue([]);

      await searchResultProvider.performSearch(query, target, options);

      expect(mockApiClient.searchPages).toHaveBeenCalledWith({
        query,
        target,
        limit: 25,
        offset: 0,
      });
    });

    it('パフォーマンス警告が適切に表示される', async () => {
      const query = 'slow search';
      
      // 遅い検索をシミュレート（2秒以上）
      mockApiClient.searchPages!.mockImplementation(() => 
        new Promise(resolve => setTimeout(() => resolve([]), 2100))
      );

      const mockShowWarning = jest.spyOn(vscode.window, 'showWarningMessage');

      await searchResultProvider.performSearch(query);

      expect(mockShowWarning).toHaveBeenCalledWith(
        expect.stringContaining('検索に時間がかかっています')
      );
    });

    it('検索エラーが適切に処理される', async () => {
      const query = 'error search';
      const searchError = new Error('API Error');

      mockApiClient.searchPages!.mockRejectedValue(searchError);

      await expect(searchResultProvider.performSearch(query)).rejects.toThrow('API Error');
      expect(searchResultProvider.getResultCount()).toBe(0);
    });

    it('検索中フラグが正しく管理される', async () => {
      const query = 'loading test';

      // 検索が遅延するようにモック
      let resolveSearch: (value: any) => void;
      const searchPromise = new Promise(resolve => {
        resolveSearch = resolve;
      });
      mockApiClient.searchPages!.mockReturnValue(searchPromise);

      // 検索開始
      const resultPromise = searchResultProvider.performSearch(query);

      // 検索中であることを確認
      expect(searchResultProvider.isSearching()).toBe(true);

      // 検索完了
      resolveSearch!([]);
      await resultPromise;

      // 検索完了後はフラグがfalseに
      expect(searchResultProvider.isSearching()).toBe(false);
    });
  });

  describe('filterResults', () => {
    beforeEach(async () => {
      // テスト用検索結果を設定
      const mockResults = [
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            pageType: 'normal',
            creator: { id: '1', username: 'alice', name: 'Alice', email: 'alice@example.com', status: 'active' },
            updatedAt: new Date('2025-01-20'),
          }),
          score: 0.9,
        }),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            pageType: 'template',
            creator: { id: '2', username: 'bob', name: 'Bob', email: 'bob@example.com', status: 'active' },
            updatedAt: new Date('2025-01-15'),
          }),
          score: 0.7,
        }),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            pageType: 'normal',
            creator: { id: '3', username: 'alice', name: 'Alice', email: 'alice@example.com', status: 'active' },
            updatedAt: new Date('2025-01-10'),
          }),
          score: 0.8,
        }),
      ];

      mockApiClient.searchPages!.mockResolvedValue(mockResults);
      await searchResultProvider.performSearch('test');
    });

    it('ページタイプでフィルターできる', () => {
      expect(searchResultProvider.getResultCount()).toBe(3);

      searchResultProvider.filterResults({ pageType: 'template' });

      expect(searchResultProvider.getResultCount()).toBe(1);
    });

    it('作成者でフィルターできる', () => {
      searchResultProvider.filterResults({ author: 'alice' });

      expect(searchResultProvider.getResultCount()).toBe(2);
    });

    it('日付範囲でフィルターできる', () => {
      const filter = {
        dateRange: {
          start: new Date('2025-01-18'),
          end: new Date('2025-01-25'),
        },
      };

      searchResultProvider.filterResults(filter);

      expect(searchResultProvider.getResultCount()).toBe(1);
    });

    it('最小スコアでフィルターできる', () => {
      searchResultProvider.filterResults({ minScore: 0.85 });

      expect(searchResultProvider.getResultCount()).toBe(1);
    });

    it('複数条件でフィルターできる', () => {
      searchResultProvider.filterResults({
        pageType: 'normal',
        author: 'alice',
        minScore: 0.85,
      });

      expect(searchResultProvider.getResultCount()).toBe(1);
    });
  });

  describe('sortResults', () => {
    beforeEach(async () => {
      // テスト用検索結果を設定
      const mockResults = [
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'B Page',
            creator: { id: '2', username: 'bob', name: 'Bob', email: 'bob@example.com', status: 'active' },
            updatedAt: new Date('2025-01-15'),
          }),
          score: 0.7,
        }),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'A Page',
            creator: { id: '1', username: 'alice', name: 'Alice', email: 'alice@example.com', status: 'active' },
            updatedAt: new Date('2025-01-20'),
          }),
          score: 0.9,
        }),
        global.testUtils.createMockSearchResult({
          page: global.testUtils.createMockGrowiPage({
            title: 'C Page',
            creator: { id: '3', username: 'charlie', name: 'Charlie', email: 'charlie@example.com', status: 'active' },
            updatedAt: new Date('2025-01-10'),
          }),
          score: 0.8,
        }),
      ];

      mockApiClient.searchPages!.mockResolvedValue(mockResults);
      await searchResultProvider.performSearch('test');
    });

    it('関連度順（降順）でソートできる', async () => {
      searchResultProvider.sortResults('relevance', 'desc');

      const children = await searchResultProvider.getChildren();
      const scores = children.map(child => child.score);

      expect(scores).toEqual([0.9, 0.8, 0.7]);
    });

    it('タイトル順（昇順）でソートできる', async () => {
      searchResultProvider.sortResults('title', 'asc');

      const children = await searchResultProvider.getChildren();
      const titles = children.map(child => child.page.title);

      expect(titles).toEqual(['A Page', 'B Page', 'C Page']);
    });

    it('更新日順（降順）でソートできる', async () => {
      searchResultProvider.sortResults('date', 'desc');

      const children = await searchResultProvider.getChildren();
      const dates = children.map(child => child.page.updatedAt.getTime());

      expect(dates[0]).toBeGreaterThan(dates[1]);
      expect(dates[1]).toBeGreaterThan(dates[2]);
    });

    it('作成者順（昇順）でソートできる', async () => {
      searchResultProvider.sortResults('author', 'asc');

      const children = await searchResultProvider.getChildren();
      const authors = children.map(child => child.page.creator.name);

      expect(authors).toEqual(['Alice', 'Bob', 'Charlie']);
    });
  });

  describe('clearResults', () => {
    it('検索結果を正しくクリアする', async () => {
      // 検索結果を設定
      const mockResults = [global.testUtils.createMockSearchResult()];
      mockApiClient.searchPages!.mockResolvedValue(mockResults);
      await searchResultProvider.performSearch('test');

      expect(searchResultProvider.getResultCount()).toBe(1);
      expect(searchResultProvider.getCurrentQuery()).toBe('test');

      // クリア実行
      searchResultProvider.clearResults();

      expect(searchResultProvider.getResultCount()).toBe(0);
      expect(searchResultProvider.getCurrentQuery()).toBe('');
    });
  });

  describe('ヘルパーメソッド', () => {
    it('ハイライト範囲を正しく検索する', () => {
      // private メソッドのテストはリフレクションを使用
      const text = 'This is a test query in the content with query again';
      const query = 'query';

      // SearchResultProviderのプライベートメソッドにアクセス
      const ranges = (searchResultProvider as any).findHighlightRanges(text, query);

      expect(ranges).toHaveLength(2);
      expect(ranges[0]).toEqual({ start: 15, end: 20 });
      expect(ranges[1]).toEqual({ start: 47, end: 52 });
    });

    it('スニペットを正しく作成する', () => {
      const mockResult = global.testUtils.createMockSearchResult({
        snippet: 'This is a highlighted snippet',
      });

      const snippet = (searchResultProvider as any).createSnippet(mockResult, 'test', true);

      expect(snippet).toBe('This is a highlighted snippet');
    });

    it('スニペットが無い場合はコンテンツの先頭を使用する', () => {
      const longContent = 'A'.repeat(200) + 'B'.repeat(100);
      const mockResult = global.testUtils.createMockSearchResult({
        snippet: null,
        page: global.testUtils.createMockGrowiPage({ content: longContent }),
      });

      const snippet = (searchResultProvider as any).createSnippet(mockResult, 'test', true);

      expect(snippet).toHaveLength(153); // 150文字 + "..."
      expect(snippet.endsWith('...')).toBe(true);
    });
  });
});