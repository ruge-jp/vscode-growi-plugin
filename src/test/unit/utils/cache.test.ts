/**
 * CacheManager 単体テスト
 */

import { CacheManager } from '../../../utils/cache';

describe('CacheManager', () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = new CacheManager();
    jest.clearAllMocks();
  });

  afterEach(() => {
    // 各テスト後にキャッシュをクリア
    cacheManager.clear();
  });

  describe('基本操作', () => {
    it('値を設定・取得できる', () => {
      const key = 'test-key';
      const value = { data: 'test-value' };
      const ttl = 1000;

      cacheManager.set(key, value, ttl);
      const retrieved = cacheManager.get(key);

      expect(retrieved).toEqual(value);
    });

    it('存在しないキーでnullを返す', () => {
      const result = cacheManager.get('non-existent-key');
      expect(result).toBeNull();
    });

    it('値を削除できる', () => {
      const key = 'delete-test';
      const value = { data: 'to-delete' };

      cacheManager.set(key, value, 1000);
      expect(cacheManager.get(key)).toEqual(value);

      cacheManager.delete(key);
      expect(cacheManager.get(key)).toBeNull();
    });

    it('すべてのキャッシュをクリアできる', () => {
      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);

      expect(cacheManager.get('key1')).toBe('value1');
      expect(cacheManager.get('key2')).toBe('value2');

      cacheManager.clear();

      expect(cacheManager.get('key1')).toBeNull();
      expect(cacheManager.get('key2')).toBeNull();
    });
  });

  describe('TTL (Time To Live)', () => {
    it('TTL切れのエントリは自動的に削除される', async () => {
      const key = 'ttl-test';
      const value = 'will-expire';
      const shortTtl = 10; // 10ms

      cacheManager.set(key, value, shortTtl);
      expect(cacheManager.get(key)).toBe(value);

      // TTL期限まで待機
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(cacheManager.get(key)).toBeNull();
    });

    it('TTLが設定されていない場合は永続的に保存される', () => {
      const key = 'permanent-key';
      const value = 'permanent-value';

      cacheManager.set(key, value); // TTLなし

      // 時間を進める（実際には短時間だが、テストとして）
      expect(cacheManager.get(key)).toBe(value);
    });

    it('異なるTTLの値が正しく管理される', async () => {
      const shortKey = 'short-ttl';
      const longKey = 'long-ttl';
      const shortValue = 'expires-soon';
      const longValue = 'expires-later';

      cacheManager.set(shortKey, shortValue, 10); // 10ms
      cacheManager.set(longKey, longValue, 1000); // 1000ms

      // 最初は両方とも有効
      expect(cacheManager.get(shortKey)).toBe(shortValue);
      expect(cacheManager.get(longKey)).toBe(longValue);

      // 短いTTLのみ期限切れになるまで待機
      await new Promise(resolve => setTimeout(resolve, 20));

      expect(cacheManager.get(shortKey)).toBeNull();
      expect(cacheManager.get(longKey)).toBe(longValue);
    });
  });

  describe('LRU (Least Recently Used) 機能', () => {
    it('最大サイズを超えた場合、最も古いエントリが削除される', () => {
      // キャッシュサイズを小さく設定してテスト
      cacheManager = new CacheManager(3); // 最大3エントリ

      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);
      cacheManager.set('key3', 'value3', 1000);

      // すべて存在することを確認
      expect(cacheManager.get('key1')).toBe('value1');
      expect(cacheManager.get('key2')).toBe('value2');
      expect(cacheManager.get('key3')).toBe('value3');

      // 4番目を追加 - key1が削除されるはず
      cacheManager.set('key4', 'value4', 1000);

      expect(cacheManager.get('key1')).toBeNull();
      expect(cacheManager.get('key2')).toBe('value2');
      expect(cacheManager.get('key3')).toBe('value3');
      expect(cacheManager.get('key4')).toBe('value4');
    });

    it('アクセスされたエントリは最新として扱われる', () => {
      cacheManager = new CacheManager(3);

      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);
      cacheManager.set('key3', 'value3', 1000);

      // key1にアクセスして最新にする
      cacheManager.get('key1');

      // 4番目を追加 - key2が最も古いので削除されるはず
      cacheManager.set('key4', 'value4', 1000);

      expect(cacheManager.get('key1')).toBe('value1'); // アクセスで新しくなった
      expect(cacheManager.get('key2')).toBeNull();    // 削除された
      expect(cacheManager.get('key3')).toBe('value3');
      expect(cacheManager.get('key4')).toBe('value4');
    });
  });

  describe('ページ専用メソッド', () => {
    it('ページを設定・取得できる', () => {
      const pageId = 'page-123';
      const page = global.testUtils.createMockGrowiPage({ id: pageId });
      const ttl = 1000;

      cacheManager.setPage(pageId, page, ttl);
      const retrieved = cacheManager.getPage(pageId);

      expect(retrieved).toEqual(page);
      expect(retrieved?.id).toBe(pageId);
    });

    it('存在しないページIDでnullを返す', () => {
      const result = cacheManager.getPage('non-existent-page');
      expect(result).toBeNull();
    });

    it('パスによるページキャッシュクリアが動作する', () => {
      const page1 = global.testUtils.createMockGrowiPage({
        id: 'page1',
        path: '/test/page1',
      });
      const page2 = global.testUtils.createMockGrowiPage({
        id: 'page2',
        path: '/test/page2',
      });
      const page3 = global.testUtils.createMockGrowiPage({
        id: 'page3',
        path: '/other/page3',
      });

      // 複数のページをキャッシュ
      cacheManager.setPage('page1', page1, 1000);
      cacheManager.setPage('page2', page2, 1000);
      cacheManager.setPage('page3', page3, 1000);

      // ページ一覧キャッシュも設定
      cacheManager.set('pages:/test:100', [page1, page2], 1000);
      cacheManager.set('pages:/other:100', [page3], 1000);

      // /testパスのキャッシュをクリア
      cacheManager.clearPageCacheByPath('/test/page1');

      // /testに関連するキャッシュが削除されることを確認
      expect(cacheManager.get('pages:/test:100')).toBeNull();
      
      // 他のパスのキャッシュは残っている
      expect(cacheManager.get('pages:/other:100')).toEqual([page3]);
    });
  });

  describe('統計情報', () => {
    it('キャッシュ統計を正しく取得できる', () => {
      // いくつかのキャッシュエントリを作成
      cacheManager.set('key1', 'value1', 1000);
      cacheManager.set('key2', 'value2', 1000);
      cacheManager.set('key3', 'value3', 1000);

      // アクセスしてヒット/ミス統計を作る
      cacheManager.get('key1'); // ヒット
      cacheManager.get('key2'); // ヒット
      cacheManager.get('missing'); // ミス

      const stats = cacheManager.getStats();

      expect(stats.size).toBe(3);
      expect(stats.hits).toBe(2);
      expect(stats.misses).toBe(1);
      expect(stats.hitRate).toBeCloseTo(0.67, 2); // 2/3 ≈ 0.67
    });

    it('空のキャッシュでは適切な統計が返される', () => {
      const stats = cacheManager.getStats();

      expect(stats.size).toBe(0);
      expect(stats.hits).toBe(0);
      expect(stats.misses).toBe(0);
      expect(stats.hitRate).toBe(0);
    });
  });

  describe('型安全性', () => {
    it('ジェネリック型が正しく機能する', () => {
      interface TestData {
        id: number;
        name: string;
      }

      const testData: TestData = { id: 1, name: 'test' };
      cacheManager.set<TestData>('typed-key', testData, 1000);

      const retrieved = cacheManager.get<TestData>('typed-key');
      
      expect(retrieved).toEqual(testData);
      expect(retrieved?.id).toBe(1);
      expect(retrieved?.name).toBe('test');
    });
  });

  describe('エラーハンドリング', () => {
    it('無効なTTLでも正常に動作する', () => {
      const key = 'invalid-ttl-test';
      const value = 'test-value';

      // 負のTTL
      cacheManager.set(key, value, -1000);
      expect(cacheManager.get(key)).toBeNull();

      // 0のTTL
      cacheManager.set(key, value, 0);
      expect(cacheManager.get(key)).toBeNull();
    });

    it('undefinedやnullの値も正しく処理される', () => {
      cacheManager.set('undefined-key', undefined, 1000);
      cacheManager.set('null-key', null, 1000);

      expect(cacheManager.get('undefined-key')).toBeUndefined();
      expect(cacheManager.get('null-key')).toBeNull();
    });

    it('大きなオブジェクトでも正常に動作する', () => {
      const largeObject = {
        data: new Array(1000).fill(0).map((_, i) => ({ id: i, value: `item-${i}` })),
        metadata: {
          size: 1000,
          created: new Date(),
          type: 'large-test',
        },
      };

      cacheManager.set('large-object', largeObject, 1000);
      const retrieved = cacheManager.get('large-object');

      expect(retrieved).toEqual(largeObject);
      expect(retrieved.data).toHaveLength(1000);
      expect(retrieved.metadata.size).toBe(1000);
    });
  });
});