import { CacheEntry, CacheStats, GrowiPage } from '../api/types';
import { Logger } from './logger';

/**
 * @class CacheManager
 * @description APIレスポンスなどをメモリ上に保持するための汎用キャッシュ管理クラス。
 *              LRU (Least Recently Used) アルゴリズムに基づいたキャッシュ削除戦略を採用し、
 *              定期的に期限切れのエントリをクリーンアップします。
 */
export class CacheManager {
    private cache = new Map<string, CacheEntry<any>>();
    private readonly maxSize: number;
    private readonly defaultTTL: number; // Time To Live
    private logger = Logger.getInstance();
    private hitCount = 0;
    private missCount = 0;

    /**
     * @constructor
     * @param {number} [maxSize=1000] - キャッシュできる最大エントリ数。
     * @param {number} [defaultTTL=300000] - デフォルトのキャッシュ有効期間（ミリ秒）。デフォルトは5分。
     */
    constructor(maxSize: number = 1000, defaultTTL: number = 300000) {
        this.maxSize = maxSize;
        this.defaultTTL = defaultTTL;
        
        // メモリリークを防ぐため、1分ごとに期限切れのキャッシュエントリを自動的に削除するタイマーを設定
        setInterval(() => this.cleanup(), 60000);
    }

    /**
     * @method set
     * @param {string} key - キャッシュキー。
     * @param {T} value - キャッシュする値。
     * @param {number} [ttl] - このエントリの有効期間（ミリ秒）。指定しない場合はデフォルト値を使用。
     * @description 指定されたキーで値をキャッシュに保存します。
     */
    public set<T>(key: string, value: T, ttl?: number): void {
        const expiry = Date.now() + (ttl || this.defaultTTL);
        
        // キャッシュサイズが上限を超えている場合、最も最近使われていないエントリを削除
        if (this.cache.size >= this.maxSize && !this.cache.has(key)) {
            this.evictOldest();
        }
        
        const entry: CacheEntry<T> = { value, expiry, accessCount: 0, lastAccessed: Date.now() };
        this.cache.set(key, entry);
        this.logger.debug(`キャッシュに保存: ${key} (TTL: ${ttl || this.defaultTTL}ms)`);
    }

    /**
     * @method get
     * @param {string} key - 取得するキャッシュのキー。
     * @returns {T | undefined} キャッシュされた値。存在しない、または期限切れの場合はundefined。
     * @description キーに対応する値をキャッシュから取得します。
     */
    public get<T>(key: string): T | undefined {
        const entry = this.cache.get(key);
        
        if (!entry) {
            this.missCount++;
            this.logger.debug(`キャッシュミス: ${key}`);
            return undefined;
        }
        
        // 期限切れのチェック
        if (entry.expiry < Date.now()) {
            this.cache.delete(key);
            this.missCount++;
            this.logger.debug(`キャッシュ期限切れ: ${key}`);
            return undefined;
        }
        
        // アクセス情報を更新 (LRUのため)
        entry.accessCount++;
        entry.lastAccessed = Date.now();
        
        this.hitCount++;
        this.logger.debug(`キャッシュヒット: ${key}`);
        return entry.value as T;
    }

    /**
     * @method has
     * @param {string} key - 存在を確認するキー。
     * @returns {boolean} 有効なキャッシュが存在する場合はtrue。
     */
    public has(key: string): boolean {
        const entry = this.cache.get(key);
        if (!entry || entry.expiry < Date.now()) {
            if (entry) this.cache.delete(key);
            return false;
        }
        return true;
    }

    /**
     * @method delete
     * @param {string} key - 削除するキャッシュのキー。
     * @returns {boolean} 削除が成功した場合はtrue。
     */
    public delete(key: string): boolean {
        const result = this.cache.delete(key);
        if (result) this.logger.debug(`キャッシュから削除: ${key}`);
        return result;
    }

    /**
     * @method clear
     * @description すべてのキャッシュエントリを削除します。
     */
    public clear(): void {
        this.cache.clear();
        this.hitCount = 0;
        this.missCount = 0;
        this.logger.info('キャッシュがクリアされました。');
    }

    /**
     * @method deleteByPattern
     * @param {RegExp} pattern - 削除するキーにマッチする正規表現。
     * @returns {number} 削除されたエントリの数。
     */
    public deleteByPattern(pattern: RegExp): number {
        let deletedCount = 0;
        for (const key of this.cache.keys()) {
            if (pattern.test(key)) {
                this.cache.delete(key);
                deletedCount++;
            }
        }
        if (deletedCount > 0) {
            this.logger.debug(`パターン '${pattern}' に一致する ${deletedCount} 件のキャッシュを削除しました。`);
        }
        return deletedCount;
    }

    /**
     * @method getStats
     * @returns {CacheStats} 現在のキャッシュの統計情報。
     */
    public getStats(): CacheStats {
        const totalRequests = this.hitCount + this.missCount;
        const hitRate = totalRequests > 0 ? this.hitCount / totalRequests : 0;
        
        // メモリ使用量を概算
        let memoryUsage = 0;
        for (const [key, entry] of this.cache.entries()) {
            try {
                memoryUsage += Buffer.byteLength(key, 'utf8') + Buffer.byteLength(JSON.stringify(entry.value), 'utf8');
            } catch (e) { /* JSON化できない値は無視 */ }
        }
        
        return {
            totalEntries: this.cache.size,
            hitRate: Math.round(hitRate * 100) / 100,
            memoryUsage
        };
    }

    /**
     * @method cleanup
     * @description 期限切れのキャッシュエントリをすべて削除します。
     */
    public cleanup(): void {
        const now = Date.now();
        let cleanedCount = 0;
        for (const [key, entry] of this.cache.entries()) {
            if (entry.expiry < now) {
                this.cache.delete(key);
                cleanedCount++;
            }
        }
        if (cleanedCount > 0) {
            this.logger.debug(`${cleanedCount} 件の期限切れキャッシュをクリーンアップしました。`);
        }
    }

    /**
     * @method evictOldest
     * @private
     * @description LRU (Least Recently Used) アルゴリズムに基づき、最も長い間アクセスされていないエントリを1つ削除します。
     */
    private evictOldest(): void {
        let oldestKey: string | undefined;
        let oldestTime = Infinity;
        
        for (const [key, entry] of this.cache.entries()) {
            if (entry.lastAccessed < oldestTime) {
                oldestTime = entry.lastAccessed;
                oldestKey = key;
            }
        }
        
        if (oldestKey) {
            this.cache.delete(oldestKey);
            this.logger.debug(`LRUポリシーによりキャッシュを削除: ${oldestKey}`);
        }
    }

    // ============================================================================ 
    // ページデータ専用のヘルパーメソッド
    // これらは特定のキープレフィックスを使用することで、型安全性を高め、コードの可読性を向上させます。
    // ============================================================================ 

    /**
     * @method setPages
     * @description ページ一覧データをキャッシュします。
     */
    public setPages(path: string, pages: GrowiPage[], ttl?: number): void {
        this.set(`pages:${path}`, pages, ttl);
    }

    /**
     * @method getPages
     * @description キャッシュからページ一覧データを取得します。
     */
    public getPages(path: string): GrowiPage[] | undefined {
        return this.get<GrowiPage[]>(`pages:${path}`);
    }

    /**
     * @method setPage
     * @description 単一のページデータをキャッシュします。
     */
    public setPage(pageId: string, page: GrowiPage, ttl?: number): void {
        this.set(`page:${pageId}`, page, ttl);
    }

    /**
     * @method getPage
     * @description キャッシュから単一のページデータを取得します。
     */
    public getPage(pageId: string): GrowiPage | undefined {
        return this.get<GrowiPage>(`page:${pageId}`);
    }

    /**
     * @method clearPageCache
     * @description ページに関連するすべてのキャッシュ（一覧と個別）をクリアします。
     */
    public clearPageCache(): void {
        this.deleteByPattern(/^(pages:|page:)/);
        this.logger.info('すべてのページキャッシュがクリアされました。');
    }

    /**
     * @method clearPageCacheByPath
     * @description 特定のパスに関連するページ一覧キャッシュをクリアします。
     */
    public clearPageCacheByPath(path: string): void {
        const escapedPath = path.replace(/[.*+?^${}()|[\/]/g, '\$&');
        this.deleteByPattern(new RegExp(`^pages:${escapedPath}`));
        this.logger.debug(`パス '${path}' のページキャッシュをクリアしました。`);
    }
}