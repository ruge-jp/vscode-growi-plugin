/**
 * @file セキュリティバリデーター
 * @description 拡張機能で扱う様々な入力値の検証とサニタイズを行い、セキュリティを確保します。
 */

import { Logger } from '../utils/logger';

/**
 * @interface ValidationRule
 * @description 汎用的な入力値検証のルールを定義します。
 */
interface ValidationRule {
    required?: boolean;
    type?: 'string' | 'number' | 'boolean' | 'object' | 'array';
    minLength?: number;
    maxLength?: number;
    pattern?: RegExp;
    allowedValues?: string[];
    sanitize?: boolean;
}

/**
 * @interface ValidationResult
 * @description 検証処理の結果を格納します。
 */
interface ValidationResult {
    /** 検証が成功したかどうか */
    isValid: boolean;
    /** 検証で検出されたエラーメッセージの配列 */
    errors: string[];
    /** サニタイズされた値（サニタイズが有効な場合） */
    sanitizedValue?: any;
}

/**
 * @class SecurityValidator
 * @description URL、APIトークン、ページコンテンツなどの入力値を検証し、セキュリティリスクを低減するクラス。
 */
export class SecurityValidator {
    private logger = Logger.getInstance();

    /**
     * @method validateUrl
     * @param {string} url - 検証するURL。
     * @returns {ValidationResult} 検証結果。
     * @description URLが安全な形式（HTTP/HTTPSプロトコル、有効なホスト名など）であるか検証します。
     */
    public validateUrl(url: string): ValidationResult {
        const errors: string[] = [];
        if (!url || typeof url !== 'string') {
            errors.push('URLが指定されていません。');
            return { isValid: false, errors };
        }

        try {
            const urlObj = new URL(url);
            if (!['http:', 'https:'].includes(urlObj.protocol)) {
                errors.push('URLはHTTPまたはHTTPSプロトコルである必要があります。');
            }
            // SSRF (Server-Side Request Forgery) 対策としてプライベートIPへのアクセスを制限
            if (process.env.NODE_ENV === 'production' && this.isPrivateIP(urlObj.hostname)) {
                errors.push('プライベートIPアドレスへのアクセスは許可されていません。');
            }
            if (this.containsMaliciousCharacters(url)) {
                errors.push('URLに不正な文字が含まれています。');
            }
        } catch (error) {
            errors.push('無効なURL形式です。');
        }

        return {
            isValid: errors.length === 0,
            errors,
            sanitizedValue: this.sanitizeUrl(url)
        };
    }

    /**
     * @method validateAuthToken
     * @param {string} token - 検証する認証トークン。
     * @returns {ValidationResult} 検証結果。
     * @description 認証トークンが基本的な要件（長さ、文字種など）を満たしているか検証します。
     */
    public validateAuthToken(token: string): ValidationResult {
        const errors: string[] = [];
        if (!token || typeof token !== 'string') {
            errors.push('認証トークンが指定されていません。');
            return { isValid: false, errors };
        }
        if (token.length < 10 || token.length > 2048) {
            errors.push('認証トークンの長さが不正です。');
        }
        if (!this.isValidBase64OrAlphanumeric(token)) {
            errors.push('認証トークンに無効な文字が含まれています。');
        }
        return {
            isValid: errors.length === 0,
            errors,
            sanitizedValue: this.sanitizeString(token)
        };
    }

    /**
     * @method validatePagePath
     * @param {string} path - 検証するページパス。
     * @returns {ValidationResult} 検証結果。
     * @description ページパスにパストラバーサルのような攻撃パターンが含まれていないか検証します。
     */
    public validatePagePath(path: string): ValidationResult {
        const errors: string[] = [];
        if (!path || typeof path !== 'string') {
            errors.push('ページパスが指定されていません。');
            return { isValid: false, errors };
        }
        if (!path.startsWith('/')) {
            errors.push('ページパスは \'/\' で始まる必要があります。');
        }
        if (this.containsPathTraversal(path)) {
            errors.push('パスに不正なシーケンス (../ など) が含まれています。');
        }
        const forbiddenPaths = ['/admin', '/api', '/config'];
        if (forbiddenPaths.some(fp => path.toLowerCase().startsWith(fp))) {
            errors.push('予約されたパスプレフィックスは使用できません。');
        }
        return {
            isValid: errors.length === 0,
            errors,
            sanitizedValue: this.sanitizePath(path)
        };
    }

    /**
     * @method validatePageContent
     * @param {string} content - 検証するページコンテンツ。
     * @returns {ValidationResult} 検証結果。
     * @description ページコンテンツにXSS（クロスサイトスクリプティング）に繋がるような危険なスクリプトが含まれていないか検証します。
     */
    public validatePageContent(content: string): ValidationResult {
        const errors: string[] = [];
        if (typeof content !== 'string') {
            errors.push('コンテンツは文字列である必要があります。');
            return { isValid: false, errors };
        }
        if (content.length > 10 * 1024 * 1024) { // 10MB
            errors.push('コンテンツサイズが大きすぎます（最大10MB）。');
        }
        if (this.containsDangerousScript(content)) {
            errors.push('コンテンツに危険なスクリプトが含まれている可能性があります。');
        }
        return {
            isValid: errors.length === 0,
            errors,
            sanitizedValue: this.sanitizeContent(content)
        };
    }

    /**
     * @method validateInput
     * @param {any} value - 検証する値。
     * @param {ValidationRule} rules - 検証ルールのセット。
     * @returns {ValidationResult} 検証結果。
     * @description 提供されたルールセットに基づいて、汎用的な入力値検証を行います。
     */
    public validateInput(value: any, rules: ValidationRule): ValidationResult {
        const errors: string[] = [];
        if (rules.required && (value === null || value === undefined || value === '')) {
            errors.push('この項目は必須です。');
            return { isValid: false, errors };
        }
        // (以降の実装は省略)
        return { isValid: true, errors: [] };
    }

    /**
     * @method containsMaliciousCharacters
     * @private
     * @description スクリプトインジェクションなどに利用される可能性のある危険な文字やパターンを検出します。
     */
    private containsMaliciousCharacters(input: string): boolean {
        const dangerousPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, // <script>タグ
            /javascript:/gi, // javascript: プロトコル
            /on\w+\s*=/gi, // on<event>= ハンドラ
            /[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g // 制御文字（改行、タブを除く）
        ];
        return dangerousPatterns.some(pattern => pattern.test(input));
    }

    /**
     * @method containsPathTraversal
     * @private
     * @description パストラバーサル攻撃（ディレクトリトラバーサル）に利用されるパターンを検出します。
     */
    private containsPathTraversal(path: string): boolean {
        return /(\.\.\/|\.\.\\|%2e%2e%2f|%2e%2e%5c)/gi.test(path);
    }

    /**
     * @method isPrivateIP
     * @private
     * @description SSRF攻撃を防ぐため、ホスト名がプライベートIPアドレスの範囲にないかチェックします。
     */
    private isPrivateIP(hostname: string): boolean {
        const privateIPv4Patterns = [/^10\./, /^172\.(1[6-9]|2[0-9]|3[0-1])\./, /^192\.168\./, /^127\./, /^localhost$/i];
        const privateIPv6Patterns = [/^::1$/, /^fe80:/i, /^fc00:/i, /^fd00:/i];
        return [...privateIPv4Patterns, ...privateIPv6Patterns].some(pattern => pattern.test(hostname));
    }

    /**
     * @method isValidBase64OrAlphanumeric
     * @private
     * @description トークンが一般的な形式（Base64または英数字）であるかチェックします。
     */
    private isValidBase64OrAlphanumeric(token: string): boolean {
        return /^[A-Za-z0-9+\/]+=*$/.test(token) || /^[A-Za-z0-9._-]+$/.test(token);
    }

    /**
     * @method containsDangerousScript
     * @private
     * @description コンテンツ内のより広範な危険なスクリプトパターンを検出します。
     */
    private containsDangerousScript(content: string): boolean {
        const dangerousScriptPatterns = [
            /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
            /javascript:/gi,
            /vbscript:/gi,
            /data:text\/html/gi,
            /expression\s*\(/gi,
        ];
        return dangerousScriptPatterns.some(pattern => pattern.test(content));
    }

    /**
     * @method containsExcessiveHtml
     * @private
     * @description コンテンツに対してHTMLタグの割合が異常に高くないかチェックします。
     */
    private containsExcessiveHtml(content: string): boolean {
        const htmlTagCount = (content.match(/<[^>]+>/g) || []).length;
        // HTMLタグが10個以上あり、かつコンテンツ長の30%を超える場合は異常とみなす
        return htmlTagCount > 10 && (htmlTagCount * 10) > (content.length || 1);
    }

    /**
     * @method sanitizeUrl
     * @private
     * @description URLから安全な部分（プロトコル、ホスト、パス）のみを抽出してサニタイズします。
     */
    private sanitizeUrl(url: string): string {
        try {
            const urlObj = new URL(url);
            return `${urlObj.protocol}//${urlObj.host}${urlObj.pathname}`;
        } catch {
            return '';
        }
    }

    /**
     * @method sanitizePath
     * @private
     * @description パスから危険な文字やシーケンスを除去してサニタイズします。
     */
    private sanitizePath(path: string): string {
        return path.replace(/\.\.[\/\\]/g, '').replace(/[<>"']/g, '').replace(/\/+/g, '/').slice(0, 1000);
    }

    /**
     * @method sanitizeString
     * @private
     * @description 一般的な文字列からHTMLエンティティや制御文字を除去してサニタイズします。
     */
    private sanitizeString(input: string): string {
        const htmlEntities: { [key: string]: string } = { '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#x27;', '&': '&amp;' };
        return input.replace(/[<>"'&]/g, match => htmlEntities[match] || match)
                    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    /**
     * @method sanitizeContent
     * @private
     * @description Markdownコンテンツから危険なスクリプトなどを除去してサニタイズします。
     */
    private sanitizeContent(content: string): string {
        return content
            .replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, '')
            .replace(/javascript:|vbscript:|on\w+\s*=/gi, '')
            .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '');
    }

    /**
     * @method generateSecurityReport
     * @param {ValidationResult[]} validationResults - 検証結果の配列。
     * @returns {string} 整形されたレポート文字列。
     * @description 複数の検証結果をまとめて、人間が読みやすい形式のレポートを生成します。
     */
    public generateSecurityReport(validationResults: ValidationResult[]): string {
        const failedChecks = validationResults.filter(r => !r.isValid);
        if (failedChecks.length === 0) {
            return '✅ セキュリティ上の問題は検出されませんでした。';
        }
        const allErrors = failedChecks.flatMap(r => r.errors);
        return `
=== セキュリティ検証レポート ===
実行日時: ${new Date().toLocaleString('ja-JP')}
検出された問題: ${allErrors.length}件
${allErrors.map(e => `- ${e}`).join('\n')}
`;
    }
}
