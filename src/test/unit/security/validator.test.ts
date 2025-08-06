/**
 * SecurityValidator 単体テスト
 */

import { SecurityValidator } from '../../../security/validator';

describe('SecurityValidator', () => {
    let validator: SecurityValidator;

    beforeEach(() => {
        validator = new SecurityValidator();
    });

    describe('validateUrl', () => {
        it('有効なHTTPS URLを受け入れる', () => {
            const result = validator.validateUrl('https://example.growi.com');
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
            expect(result.sanitizedValue).toBe('https://example.growi.com/');
        });

        it('有効なHTTP URLを受け入れる', () => {
            const result = validator.validateUrl('http://localhost:3000');
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('無効なプロトコルを拒否する', () => {
            const result = validator.validateUrl('ftp://example.com');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('HTTPまたはHTTPSプロトコルのみサポートされています');
        });

        it('危険な文字を含むURLを拒否する', () => {
            const result = validator.validateUrl('https://example.com/<script>alert("xss")</script>');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('URLに危険な文字が含まれています');
        });

        it('本番環境でプライベートIPを拒否する', () => {
            const originalEnv = process.env.NODE_ENV;
            process.env.NODE_ENV = 'production';
            
            const result = validator.validateUrl('https://192.168.1.1');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('プライベートIPアドレスへのアクセスは許可されていません');
            
            process.env.NODE_ENV = originalEnv;
        });

        it('無効なURL形式を拒否する', () => {
            const result = validator.validateUrl('not-a-url');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('無効なURL形式です');
        });

        it('空文字列を拒否する', () => {
            const result = validator.validateUrl('');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('URLが指定されていません');
        });
    });

    describe('validateAuthToken', () => {
        it('有効な認証トークンを受け入れる', () => {
            const token = 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIiwibmFtZSI6IkpvaG4gRG9lIiwiaWF0IjoxNTE2MjM5MDIyfQ.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c';
            const result = validator.validateAuthToken(token);
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('短すぎるトークンを拒否する', () => {
            const result = validator.validateAuthToken('short');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('認証トークンが短すぎます');
        });

        it('長すぎるトークンを拒否する', () => {
            const longToken = 'a'.repeat(2049);
            const result = validator.validateAuthToken(longToken);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('認証トークンが長すぎます');
        });

        it('危険な文字を含むトークンを拒否する', () => {
            const result = validator.validateAuthToken('token<script>alert("xss")</script>');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('認証トークンに危険な文字が含まれています');
        });

        it('無効な形式のトークンを拒否する', () => {
            const result = validator.validateAuthToken('token with spaces and $pecial chars!');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('認証トークンの形式が無効です');
        });
    });

    describe('validatePagePath', () => {
        it('有効なページパスを受け入れる', () => {
            const result = validator.validatePagePath('/project/documentation');
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('スラッシュで始まらないパスを拒否する', () => {
            const result = validator.validatePagePath('project/documentation');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('ページパスは/で始まる必要があります');
        });

        it('パストラバーサル攻撃を拒否する', () => {
            const result = validator.validatePagePath('/project/../../../etc/passwd');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('パストラバーサル攻撃の可能性があります');
        });

        it('禁止されたパスを拒否する', () => {
            const result = validator.validatePagePath('/admin/config');
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('アクセス禁止されたパスです');
        });

        it('長すぎるパスを拒否する', () => {
            const longPath = '/' + 'a'.repeat(1000);
            const result = validator.validatePagePath(longPath);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('ページパスが長すぎます');
        });

        it('パスをサニタイズする', () => {
            const result = validator.validatePagePath('/project//test/../clean');
            
            expect(result.isValid).toBe(true);
            expect(result.sanitizedValue).toBe('/project/test/clean');
        });
    });

    describe('validatePageContent', () => {
        it('有効なMarkdownコンテンツを受け入れる', () => {
            const content = '# タイトル\n\nこれは**有効な**Markdownコンテンツです。';
            const result = validator.validatePageContent(content);
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });

        it('危険なスクリプトタグを拒否する', () => {
            const content = '<script>alert("xss")</script>';
            const result = validator.validatePageContent(content);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('危険なスクリプトが含まれています');
        });

        it('過度なHTMLタグを拒否する', () => {
            const content = '<div><span><p><a><b><i><u><em><strong>'.repeat(100);
            const result = validator.validatePageContent(content);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('過度なHTMLタグが含まれています');
        });

        it('大きすぎるコンテンツを拒否する', () => {
            const content = 'a'.repeat(11 * 1024 * 1024); // 11MB
            const result = validator.validatePageContent(content);
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('コンテンツサイズが大きすぎます（最大10MB）');
        });

        it('javascript: URLを除去する', () => {
            const content = '[悪意のあるリンク](javascript:alert("xss"))';
            const result = validator.validatePageContent(content);
            
            expect(result.isValid).toBe(true);
            expect(result.sanitizedValue).not.toContain('javascript:');
        });
    });

    describe('validateInput', () => {
        it('必須フィールドの検証', () => {
            const result = validator.validateInput('', { required: true });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('必須項目です');
        });

        it('型の検証', () => {
            const result = validator.validateInput('文字列', { type: 'number' });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('number型である必要があります');
        });

        it('最小長の検証', () => {
            const result = validator.validateInput('abc', { minLength: 5 });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('最低5文字必要です');
        });

        it('最大長の検証', () => {
            const result = validator.validateInput('abcdefghijk', { maxLength: 5 });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('最大5文字まで入力可能です');
        });

        it('パターンの検証', () => {
            const result = validator.validateInput('invalid-email', { 
                pattern: /^[^\s@]+@[^\s@]+\.[^\s@]+$/ 
            });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('形式が正しくありません');
        });

        it('許可された値の検証', () => {
            const result = validator.validateInput('invalid', { 
                allowedValues: ['option1', 'option2', 'option3'] 
            });
            
            expect(result.isValid).toBe(false);
            expect(result.errors).toContain('許可された値: option1, option2, option3');
        });

        it('サニタイズオプション', () => {
            const result = validator.validateInput('<script>alert("xss")</script>', { 
                sanitize: true 
            });
            
            expect(result.isValid).toBe(true);
            expect(result.sanitizedValue).toBe('&lt;script&gt;alert(&quot;xss&quot;)&lt;/script&gt;');
        });

        it('null値の処理', () => {
            const result = validator.validateInput(null, { required: false });
            
            expect(result.isValid).toBe(true);
            expect(result.errors).toHaveLength(0);
        });
    });

    describe('generateSecurityReport', () => {
        it('セキュリティレポートを生成する', () => {
            const validationResults = [
                { isValid: true, errors: [] },
                { isValid: false, errors: ['エラー1', 'エラー2'] },
                { isValid: false, errors: ['エラー3'] }
            ];

            const report = validator.generateSecurityReport(validationResults);
            
            expect(report).toContain('総チェック数: 3');
            expect(report).toContain('成功: 1');
            expect(report).toContain('失敗: 2');
            expect(report).toContain('エラー1');
            expect(report).toContain('エラー2');
            expect(report).toContain('エラー3');
        });

        it('すべて成功の場合のレポート', () => {
            const validationResults = [
                { isValid: true, errors: [] },
                { isValid: true, errors: [] }
            ];

            const report = validator.generateSecurityReport(validationResults);
            
            expect(report).toContain('✅ セキュリティ問題は検出されませんでした');
        });
    });
});