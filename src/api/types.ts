/**
 * @file GROWI API統合用の型定義ファイル
 * @description GROWI REST API v3に基づいた、拡張機能全体で使用される型定義とインターフェースを記述します。
 */

// ============================================================================
// 基本データ型
// ============================================================================

/**
 * @interface GrowiPage
 * @description GROWIのページ情報を表す基本インターフェース。
 */
export interface GrowiPage {
    /** ページの一意なID */
    id: string;
    /** ページの階層構造を表すパス */
    path: string;
    /** ページのタイトル */
    title: string;
    /** ページ本体のMarkdownコンテンツ */
    content: string;
    /** ページが作成された日時 */
    createdAt: Date;
    /** ページが最後に更新された日時 */
    updatedAt: Date;
    /** ページを作成したユーザー */
    creator: GrowiUser;
    /** ページを最後に更新したユーザー */
    lastUpdateUser: GrowiUser;
    /** ページに付与されたタグの配列 */
    tags: string[];
    /** ページの種別 */
    pageType: PageType;
    /** 子ページを持つかどうか */
    hasChildren: boolean;
    /** 親ページのID（ルート階層の場合はundefined） */
    parentId?: string;
    /** 現在のページリビジョンのID */
    revision: string;
    /** ページの公開範囲設定 */
    grant: number;
    /** ページの公開状態 */
    status: PageStatus;
}

/**
 * @type PageType
 * @description ページの種別を定義します。
 * - `normal`: 通常のページ
 * - `template`: テンプレートページ
 * - `deleted`: 削除されたページ
 * - `private`: プライベートページ
 */
export type PageType = 'normal' | 'template' | 'deleted' | 'private';

/**
 * @type PageStatus
 * @description ページの公開状態を定義します。
 * - `published`: 公開済み
 * - `draft`: 下書き
 * - `deleted`: 削除済み
 */
export type PageStatus = 'published' | 'draft' | 'deleted';

/**
 * @interface GrowiUser
 * @description GROWIのユーザー情報を表すインターフェース。
 */
export interface GrowiUser {
    /** ユーザーの一意なID */
    id: string;
    /** ログインに使用されるユーザー名 */
    username: string;
    /** 表示名 */
    name: string;
    /** メールアドレス */
    email: string;
    /** アバター画像のURL */
    avatar?: string;
    /** ユーザーアカウントの状態 */
    status: UserStatus;
}

/**
 * @type UserStatus
 * @description ユーザーアカウントの状態を定義します。
 * - `active`: 有効
 * - `inactive`: 無効
 * - `suspended`: 停止中
 */
export type UserStatus = 'active' | 'inactive' | 'suspended';

/**
 * @interface GrowiTreeItem
 * @description VSCodeのTreeViewでページ階層を表示するためのアイテム定義。
 */
export interface GrowiTreeItem {
    /** ページID */
    id: string;
    /** TreeViewに表示されるタイトル */
    title: string;
    /** ページパス */
    path: string;
    /** ページ種別 */
    pageType: PageType;
    /** 子ページを持つかどうかのフラグ */
    hasChildren: boolean;
    /** 最終更新日時 */
    updatedAt: Date;
    /** ツリービュー内での階層レベル */
    level: number;
    /** 子アイテムを読み込み中かどうかのフラグ */
    loading?: boolean;
}

// ============================================================================
// 認証関連
// ============================================================================

/**
 * @type AuthType
 * @description サポートする認証方式の種別。
 * - `token`: APIアクセストークン
 * - `cookie`: Cookie認証（将来的な拡張用）
 * - `queryParam`: クエリパラメータ認証（将来的な拡張用）
 */
export type AuthType = 'token' | 'cookie' | 'queryParam';

/**
 * @interface AuthCredentials
 * @description 認証リクエストに必要な情報。
 */
export interface AuthCredentials {
    /** 認証方式 */
    type: AuthType;
    /** 認証に使用する値（APIトークンなど） */
    value: string;
    /** 認証対象のサーバーURL */
    serverUrl: string;
}

/**
 * @interface AuthResult
 * @description 認証処理の結果。
 */
export interface AuthResult {
    /** 認証が成功したかどうか */
    success: boolean;
    /** 認証成功時に取得したトークン */
    token?: string;
    /** 認証成功時に取得したユーザー情報 */
    user?: GrowiUser;
    /** 認証失敗時のエラーメッセージ */
    error?: string;
}

// ============================================================================
// API リクエスト・レスポンス型
// ============================================================================

/**
 * @interface CreatePageRequest
 * @description ページを新規作成する際のAPIリクエストボディ。
 */
export interface CreatePageRequest {
    /** 作成するページのパス */
    path: string;
    /** ページのタイトル */
    title: string;
    /** ページ本体のMarkdownコンテンツ */
    content: string;
    /** 親ページのID */
    parentId?: string;
    /** 付与するタグ */
    tags?: string[];
    /** 公開範囲設定 */
    grant?: number;
}

/**
 * @interface UpdatePageRequest
 * @description ページを更新する際のAPIリクエストボディ。
 */
export interface UpdatePageRequest {
    /** 更新後のMarkdownコンテンツ */
    content: string;
    /** 更新後のタイトル（変更する場合） */
    title?: string;
    /** 更新後のタグ（変更する場合） */
    tags?: string[];
    /** 更新前のリビジョンID（更新競合の検出に使用） */
    revision: string;
    /** 競合時に強制的に上書きするかどうかのフラグ */
    isOverwrite?: boolean;
}

/**
 * @interface SearchOptions
 * @description ページ検索時のオプション。
 */
export interface SearchOptions {
    /** 検索キーワード */
    query: string;
    /** 検索対象フィールド */
    target?: 'title' | 'content' | 'both';
    /** 取得する最大件数 */
    limit?: number;
    /** 検索結果のオフセット */
    offset?: number;
    /** 作成者で絞り込む場合のユーザー名 */
    creator?: string;
    /** タグで絞り込む場合のタグ名配列 */
    tags?: string[];
    /** 検索対象の日付範囲 */
    dateRange?: {
        from?: Date;
        to?: Date;
    };
}

/**
 * @interface SearchResult
 * @description 検索結果の各アイテム。
 */
export interface SearchResult {
    /** ヒットしたページの情報 */
    page: GrowiPage;
    /** 検索キーワードに一致した部分の抜粋 */
    snippet?: string;
    /** 検索結果の関連度スコア */
    score: number;
}

/**
 * @interface ApiResponse
 * @description APIレスポンスの共通ラッパー。
 * @template T - レスポンスデータの型。
 */
export interface ApiResponse<T> {
    /** リクエストが成功したかどうか */
    ok: boolean;
    /** 成功時のレスポンスデータ */
    data?: T;
    /** 失敗時のエラー情報 */
    error?: ApiError;
    /** ページネーションなどのメタ情報 */
    meta?: {
        total?: number;
        page?: number;
        limit?: number;
    };
}

/**
 * @interface ApiError
 * @description APIエラーの詳細情報。
 */
export interface ApiError {
    /** エラー種別を示すコード */
    code: string;
    /** エラーメッセージ */
    message: string;
    /** エラーに関する追加情報 */
    details?: any;
}

// ============================================================================
// 設定関連
// ============================================================================

/**
 * @interface GrowiConnection
 * @description 拡張機能で管理するGROWIサーバーへの接続設定。
 */
export interface GrowiConnection {
    /** 接続設定の一意なID */
    id: string;
    /** ユーザーが設定する接続名 */
    name: string;
    /** 接続先GROWIサーバーのURL */
    serverUrl: string;
    /** 使用する認証方式 */
    authType: AuthType;
    /** 最後に接続した日時 */
    lastConnected?: Date;
    /** 現在接続中かどうかのフラグ */
    connected: boolean;
}

/**
 * @interface SyncSettings
 * @description 同期に関する設定。
 */
export interface SyncSettings {
    /** ファイル変更時の自動同期を有効にするか */
    autoSync: boolean;
    /** 自動同期の間隔（ミリ秒） */
    syncInterval: number;
    /** 更新競合が発生した場合の解決方針 */
    conflictResolution: 'manual' | 'server' | 'local';
}

/**
 * @interface DisplaySettings
 * @description 表示に関する設定。
 */
export interface DisplaySettings {
    /** TreeViewでのアイコン表示を有効にするか */
    showIcons: boolean;
    /** ページの並び順の基準 */
    sortBy: 'name' | 'updatedAt' | 'createdAt';
    /** 並び順（昇順/降順） */
    sortOrder: 'asc' | 'desc';
    /** ページをフィルタリングする際の条件 */
    filterBy: string[];
    /** TreeViewのデフォルト展開階層 */
    defaultExpandLevel: number;
}

/**
 * @interface GrowiConfig
 * @description 拡張機能全体のコンフィグレーション。
 */
export interface GrowiConfig {
    /** 登録されている全接続設定のリスト */
    connections: GrowiConnection[];
    /** 現在アクティブな接続のID */
    activeConnectionId?: string;
    /** 同期設定 */
    syncSettings: SyncSettings;
    /** 表示設定 */
    displaySettings: DisplaySettings;
    /** ログ出力レベル */
    logLevel: 'debug' | 'info' | 'warn' | 'error';
}

// ============================================================================
// エラー処理関連
// ============================================================================

/**
 * @enum {string} GrowiErrorType
 * @description 拡張機能内で発生するエラーの種別。
 */
export enum GrowiErrorType {
    NetworkError = 'NETWORK_ERROR',
    AuthenticationError = 'AUTH_ERROR',
    PermissionError = 'PERMISSION_ERROR',
    ValidationError = 'VALIDATION_ERROR',
    NotFoundError = 'NOT_FOUND_ERROR',
    ServerError = 'SERVER_ERROR',
    RateLimitError = 'RATE_LIMIT_ERROR',
    ConflictError = 'CONFLICT_ERROR',
    UnknownError = 'UNKNOWN_ERROR'
}

/**
 * @interface GrowiError
 * @extends {Error}
 * @description 拡張機能のカスタムエラークラスが実装するインターフェース。
 */
export interface GrowiError extends Error {
    /** エラー種別 */
    type: GrowiErrorType;
    /** HTTPステータスコード（該当する場合） */
    statusCode?: number;
    /** レート制限エラーの場合の再試行推奨時間（秒） */
    retryAfter?: number;
    /** エラーが発生した操作 */
    operation?: string;
    /** 元となったエラーオブジェクト */
    originalError?: Error;
}

// ============================================================================
// WebSocket関連
// ============================================================================

/**
 * @type WebSocketMessageType
 * @description WebSocketで送受信されるメッセージの種別。
 */
export type WebSocketMessageType = 
    | 'pageUpdated'
    | 'pageCreated' 
    | 'pageDeleted'
    | 'userConnected'
    | 'userDisconnected';

/**
 * @interface WebSocketMessage
 * @description WebSocketメッセージの基本構造。
 */
export interface WebSocketMessage {
    /** メッセージ種別 */
    type: WebSocketMessageType;
    /** メッセージデータ */
    data: any;
    /** メッセージのタイムスタンプ */
    timestamp: Date;
}

/**
 * @interface PageUpdateNotification
 * @description ページ更新通知メッセージのデータ部。
 */
export interface PageUpdateNotification {
    /** 更新されたページ情報 */
    page: GrowiPage;
    /** 更新を行ったユーザー */
    updatedBy: GrowiUser;
    /** 変更内容の種別 */
    changeType: 'content' | 'title' | 'tags' | 'moved' | 'deleted';
}

// ============================================================================
// キャッシュ関連
// ============================================================================

/**
 * @interface CacheEntry
 * @description キャッシュに保存される各エントリの構造。
 * @template T - キャッシュされるデータの型。
 */
export interface CacheEntry<T> {
    /** キャッシュされるデータ本体 */
    value: T;
    /** キャッシュの有効期限（タイムスタンプ） */
    expiry: number;
    /** このエントリへのアクセス回数 */
    accessCount: number;
    /** 最終アクセス日時（タイムスタンプ） */
    lastAccessed: number;
}

/**
 * @interface CacheStats
 * @description キャッシュの状態を示す統計情報。
 */
export interface CacheStats {
    /** キャッシュ内の総エントリ数 */
    totalEntries: number;
    /** キャッシュのヒット率 */
    hitRate: number;
    /** 推定メモリ使用量（バイト） */
    memoryUsage: number;
}

// ============================================================================
// イベント関連
// ============================================================================

/**
 * @type ExtensionEventType
 * @description 拡張機能内でEventEmitterを介して通知されるイベントの種別。
 */
export type ExtensionEventType = 
    | 'connectionChanged'
    | 'pageLoaded'
    | 'pageUpdated'
    | 'treeRefreshed'
    | 'settingsChanged';

/**
 * @interface ExtensionEvent
 * @description 拡張機能内イベントのデータ構造。
 * @template T - イベントデータの型。
 */
export interface ExtensionEvent<T = any> {
    /** イベント種別 */
    type: ExtensionEventType;
    /** イベントに関連するデータ */
    data: T;
    /** イベント発生時刻 */
    timestamp: Date;
}

/**
 * @class PageConflictError
 * @extends {Error}
 * @description ページの更新競合が発生した際にスローされるカスタムエラー。
 */
export class PageConflictError extends Error {
    public readonly isConflictError = true;
    /**
     * @constructor
     * @param {string} message - エラーメッセージ。
     * @param {GrowiPage} serverPage - サーバー上の最新のページ情報。
     */
    constructor(message: string, public readonly serverPage: GrowiPage) {
        super(message);
        this.name = 'PageConflictError';
    }
}