/**
 * @file セキュリティ監査ツール
 * @description コードベース全体の静的なセキュリティチェックと脆弱性検出を行います。
 */

import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import { Logger } from '../utils/logger';
import { SecurityValidator } from './validator';

/**
 * @interface SecurityAuditResult
 * @description 単一のセキュリティ監査結果を表します。
 */
interface SecurityAuditResult {
    /** 検出された問題の重要度 */
    severity: 'low' | 'medium' | 'high' | 'critical';
    /** 問題のカテゴリ */
    category: string;
    /** 問題の詳細な説明 */
    description: string;
    /** 問題が検出されたファイル（該当する場合） */
    file?: string;
    /** 問題が検出された行番号（該当する場合） */
    line?: number;
    /** 推奨される対応策 */
    recommendation: string;
}

/**
 * @interface AuditConfig
 * @description セキュリティ監査の実行設定。
 */
interface AuditConfig {
    /** 依存関係のチェックを行うか */
    checkDependencies: boolean;
    /** コード内の秘密情報の漏洩をチェックするか */
    checkSecrets: boolean;
    /** ファイル権限のチェックを行うか */
    checkPermissions: boolean;
    /** 危険なデータフローをチェックするか */
    checkDataFlow: boolean;
    /** 監査結果の出力形式 */
    outputFormat: 'console' | 'file' | 'both';
}

/**
 * @class SecurityAuditor
 * @description プロジェクトのセキュリティ監査を実行するクラス。
 */
export class SecurityAuditor {
    private logger = Logger.getInstance();
    private validator = new SecurityValidator();
    private findings: SecurityAuditResult[] = [];

    /**
     * @method performFullAudit
     * @param {string} workspaceRoot - 監査対象のワークスペースルートパス。
     * @param {AuditConfig} [config] - 監査設定。
     * @returns {Promise<SecurityAuditResult[]>} 検出された問題の配列。
     * @description 設定に基づいて、包括的なセキュリティ監査を実行します。
     */
    public async performFullAudit(
        workspaceRoot: string,
        config: AuditConfig = this.getDefaultConfig()
    ): Promise<SecurityAuditResult[]> {
        this.findings = [];
        this.logger.info('セキュリティ監査を開始します...');

        try {
            // 各種監査処理を順次実行
            if (config.checkDependencies) await this.auditDependencies(workspaceRoot);
            if (config.checkSecrets) await this.auditSecrets(workspaceRoot);
            if (config.checkPermissions) await this.auditPermissions(workspaceRoot);
            if (config.checkDataFlow) await this.auditDataFlow(workspaceRoot);
            
            await this.auditCodePatterns(workspaceRoot);
            await this.auditConfiguration(workspaceRoot);

            this.logger.info(`セキュリティ監査が完了しました: ${this.findings.length}件の問題が検出されました。`);

            // 結果を指定された形式で出力
            if (config.outputFormat !== 'console') {
                await this.generateAuditReport(workspaceRoot);
            }

            return this.findings;

        } catch (error) {
            this.logger.error('セキュリティ監査中にエラーが発生しました:', error);
            throw error;
        }
    }

    /**
     * @method auditDependencies
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description `package.json`を解析し、既知の脆弱性を持つ依存関係や不適切な設定を検出します。
     */
    private async auditDependencies(workspaceRoot: string): Promise<void> {
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        if (!fs.existsSync(packageJsonPath)) return;

        try {
            const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
            const vulnerableDeps = this.getVulnerableDependencies();
            const allDeps = { ...packageJson.dependencies, ...packageJson.devDependencies };

            for (const [depName, version] of Object.entries(allDeps)) {
                if (vulnerableDeps[depName]) {
                    const vulnInfo = vulnerableDeps[depName];
                    if (this.isVulnerableVersion(version as string, vulnInfo.affectedVersions)) {
                        this.addFinding({
                            severity: vulnInfo.severity,
                            category: 'Dependency Vulnerability',
                            description: `脆弱性のある依存関係が検出されました: ${depName}@${version}`,
                            file: 'package.json',
                            recommendation: `${depName} をバージョン ${vulnInfo.fixedVersion} 以上に更新してください。`
                        });
                    }
                }
            }
        } catch (error) {
            this.logger.warn('package.jsonの解析に失敗しました:', error);
        }
    }

    /**
     * @method auditSecrets
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description 正規表現を使用して、ソースコードにハードコードされたAPIキーやパスワードなどの秘密情報をスキャンします。
     */
    private async auditSecrets(workspaceRoot: string): Promise<void> {
        const secretPatterns = [
            { name: 'APIキー', pattern: /api[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9]{20,}/gi },
            { name: 'シークレットキー', pattern: /secret[_-]?key["\s]*[:=]["\s]*[a-zA-Z0-9]{20,}/gi },
            { name: 'パスワード', pattern: /password["\s]*[:=]["\s]*[^\s"]{8,}/gi },
            { name: 'プライベートキー', pattern: /-----BEGIN\s+(RSA\s+)?PRIVATE\s+KEY-----/gi },
        ];

        await this.scanDirectoryForPatterns(workspaceRoot, secretPatterns, (file, line, lineNum, pattern) => {
            this.addFinding({
                severity: 'critical',
                category: 'Secret Exposure',
                description: `ソースコード内に${pattern.name}がハードコードされている可能性があります。`,
                file: path.relative(workspaceRoot, file),
                line: lineNum,
                recommendation: '機密情報は環境変数やセキュアな設定ストアに移動し、このファイルを.gitignoreに追加してください。'
            });
        });
    }

    /**
     * @method auditPermissions
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description 重要な設定ファイル等のパーミッションが過度に緩やかでないかチェックします。
     */
    private async auditPermissions(workspaceRoot: string): Promise<void> {
        const criticalFiles = ['package.json', 'tsconfig.json', '.env'];
        for (const file of criticalFiles) {
            const filePath = path.join(workspaceRoot, file);
            if (fs.existsSync(filePath) && process.platform !== 'win32') {
                try {
                    const mode = fs.statSync(filePath).mode & parseInt('777', 8);
                    // グループまたは他者による書き込み権限があるかチェック
                    if (mode & parseInt('022', 8)) {
                        this.addFinding({
                            severity: 'medium',
                            category: 'File Permissions',
                            description: `重要ファイルに不適切なパーミッションが設定されています: ${file}`,
                            file,
                            recommendation: `\chmod 644 ${file}\\' を実行してパーミッションを修正してください。`
                        });
                    }
                } catch (error) {
                    this.logger.warn(`ファイルパーミッションのチェックに失敗しました: ${file}`, error);
                }
            }
        }
    }

    /**
     * @method auditDataFlow
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description XSSやコードインジェクションに繋がる可能性のある、危険なデータフローのパターンを検出します。
     */
    private async auditDataFlow(workspaceRoot: string): Promise<void> {
        const dataFlowPatterns = [
            { name: '検証されていないユーザー入力', pattern: /vscode\.window\.showInputBox\(\)[\s\S]*?(?!validator|validate|sanitize)/gi, severity: 'medium' as const },
            { name: '直接的なDOM操作', pattern: /innerHTML\s*=\s*[^;]+(?!escapeHtml|sanitize)/gi, severity: 'high' as const },
            { name: '動的なコード実行', pattern: /eval\s*\(|Function\s*\(|setTimeout\s*\([^,)]*["`]/gi, severity: 'high' as const },
        ];

        await this.scanDirectoryForPatterns(workspaceRoot, dataFlowPatterns, (file, line, lineNum, pattern) => {
            this.addFinding({
                severity: pattern.severity,
                category: 'Data Flow Security',
                description: `危険なデータフローの可能性があります: ${pattern.name}`,
                file: path.relative(workspaceRoot, file),
                line: lineNum,
                recommendation: this.getDataFlowRecommendation(pattern.name)
            });
        });
    }

    /**
     * @method auditCodePatterns
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description セキュリティリスクやコード品質の低下に繋がる可能性のあるコードパターンを検出します。
     */
    private async auditCodePatterns(workspaceRoot: string): Promise<void> {
        const codePatterns = [
            { name: '本番コード中のconsole.log', pattern: /console\.(log|debug|info)\s*\(/gi, severity: 'low' as const, excludeFiles: ['/test/'] },
            { name: 'ハードコードされたURL', pattern: /https?:\/\/[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/gi, severity: 'medium' as const, excludeFiles: ['/test/', 'README.md'] },
            { name: '未解決のTODO/FIXMEコメント', pattern: /(TODO|FIXME|HACK|XXX)[\s:].*$/gmi, severity: 'low' as const },
        ];

        await this.scanDirectoryForPatterns(workspaceRoot, codePatterns, (file, line, lineNum, pattern) => {
            if (pattern.excludeFiles?.some((exclude: string) => file.includes(exclude))) return;
            this.addFinding({
                severity: pattern.severity,
                category: 'Code Quality',
                description: `コード品質に関する問題: ${pattern.name}`,
                file: path.relative(workspaceRoot, file),
                line: lineNum,
                recommendation: this.getCodePatternRecommendation(pattern.name)
            });
        });
    }

    /**
     * @method auditConfiguration
     * @private
     * @param {string} workspaceRoot - ワークスペースルートパス。
     * @description `package.json`などの設定ファイルの内容を監査し、セキュリティ上のベストプラクティスに従っているか確認します。
     */
    private async auditConfiguration(workspaceRoot: string): Promise<void> {
        const packageJsonPath = path.join(workspaceRoot, 'package.json');
        if (fs.existsSync(packageJsonPath)) {
            try {
                const manifest = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8'));
                if (!manifest.license) {
                    this.addFinding({
                        severity: 'medium',
                        category: 'Configuration',
                        description: 'ライセンス情報が設定されていません。',
                        file: 'package.json',
                        recommendation: 'プロジェクトの利用条件を明確にするため、適切なライセンスを設定してください。'
                    });
                }
                // VSCode拡張機能に特化したチェック
                if (manifest.engines?.vscode && manifest.activationEvents?.includes('*')) {
                    this.addFinding({
                        severity: 'high',
                        category: 'Extension Security',
                        description: '拡張機能が全てのイベントでアクティベートされる設定になっています。',
                        file: 'package.json',
                        recommendation: 'パフォーマンスとセキュリティのため、必要最小限のアクティベーションイベントのみを指定してください。'
                    });
                }
            } catch (error) {
                this.logger.warn('package.jsonの設定監査に失敗しました:', error);
            }
        }
    }

    /**
     * @method scanDirectoryForPatterns
     * @private
     * @description 指定されたディレクトリを再帰的にスキャンし、ファイル内容が特定の正規表現パターンに一致するかどうかをチェックします。
     */
    private async scanDirectoryForPatterns(
        dirPath: string,
        patterns: any[],
        callback: (file: string, line: string, lineNum: number, pattern: any) => void
    ): Promise<void> {
        const excludeDirs = ['node_modules', '.git', 'dist', 'out', '.vscode'];
        const includeExts = ['.ts', '.js', '.json', '.md'];

        const scanFile = (filePath: string) => {
            try {
                const lines = fs.readFileSync(filePath, 'utf8').split('\n');
                for (let i = 0; i < lines.length; i++) {
                    for (const pattern of patterns) {
                        pattern.pattern.lastIndex = 0; // グローバルな正規表現の状態をリセット
                        if (pattern.pattern.test(lines[i])) {
                            callback(filePath, lines[i], i + 1, pattern);
                        }
                    }
                }
            } catch (error) { /* バイナリファイルなどは無視 */ }
        };

        const scanDir = (currentPath: string) => {
            try {
                fs.readdirSync(currentPath).forEach(item => {
                    const itemPath = path.join(currentPath, item);
                    if (fs.statSync(itemPath).isDirectory()) {
                        if (!excludeDirs.includes(item) && !item.startsWith('.')) scanDir(itemPath);
                    } else if (includeExts.includes(path.extname(item))) {
                        scanFile(itemPath);
                    }
                });
            } catch (error) {
                this.logger.warn(`ディレクトリスキャンエラー: ${currentPath}`, error);
            }
        };
        scanDir(dirPath);
    }

    /**
     * @method addFinding
     * @private
     * @description 検出された問題をリストに追加します。
     */
    private addFinding(finding: SecurityAuditResult): void {
        this.findings.push(finding);
        this.logger.debug('セキュリティ上の問題が検出されました:', finding);
    }

    /**
     * @method generateAuditReport
     * @private
     * @description 監査結果をMarkdown形式でファイルに出力し、エディタで開きます。
     */
    private async generateAuditReport(workspaceRoot: string): Promise<void> {
        const reportPath = path.join(workspaceRoot, 'security-audit-report.md');
        const sortedFindings = this.findings.sort((a, b) => {
            const severityOrder = { critical: 4, high: 3, medium: 2, low: 1 };
            return severityOrder[b.severity] - severityOrder[a.severity];
        });
        const report = this.generateMarkdownReport(sortedFindings);

        try {
            fs.writeFileSync(reportPath, report, 'utf8');
            this.logger.info(`セキュリティ監査レポートが生成されました: ${reportPath}`);
            const document = await vscode.workspace.openTextDocument(reportPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            this.logger.error('レポートの生成に失敗しました:', error);
        }
    }

    /**
     * @method generateMarkdownReport
     * @private
     * @returns {string} Markdown形式のレポート文字列。
     */
    private generateMarkdownReport(findings: SecurityAuditResult[]): string {
        // (実装は変更なし)
        const categoryCounts = findings.reduce((acc, finding) => {
            acc[finding.category] = (acc[finding.category] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        const severityCounts = findings.reduce((acc, finding) => {
            acc[finding.severity] = (acc[finding.severity] || 0) + 1;
            return acc;
        }, {} as Record<string, number>);

        let report = `# セキュリティ監査レポート\n\n`;
        report += `**実行日時**: ${new Date().toLocaleString('ja-JP')}\n`;
        report += `**総検出数**: ${findings.length}件\n\n`;
        report += `## 概要\n\n`;
        report += `### 重要度別\n- 🔴 Critical: ${severityCounts.critical || 0}件\n- 🟠 High: ${severityCounts.high || 0}件\n- 🟡 Medium: ${severityCounts.medium || 0}件\n- 🟢 Low: ${severityCounts.low || 0}件\n\n`;
        report += `### カテゴリ別\n${Object.entries(categoryCounts).map(([category, count]) => `- ${category}: ${count}件`).join('\n')}\n\n`;
        report += `## 検出された問題\n\n`;

        for (const finding of findings) {
            const severityIcon = { critical: '🔴', high: '🟠', medium: '🟡', low: '🟢' }[finding.severity];
            report += `### ${severityIcon} ${finding.description}\n\n`;
            report += `**重要度**: ${finding.severity.toUpperCase()}\n`;
            report += `**カテゴリ**: ${finding.category}\n`;
            if(finding.file) report += `**ファイル**: \\\`${finding.file}\\\`\n`;
            if(finding.line) report += `**行番号**: ${finding.line}\n`;
            report += `\n**推奨対応**: ${finding.recommendation}\n\n---\n\n`;
        }
        return report;
    }

    /**
     * @method getDefaultConfig
     * @private
     * @returns {AuditConfig} デフォルトの監査設定。
     */
    private getDefaultConfig(): AuditConfig {
        return {
            checkDependencies: true,
            checkSecrets: true,
            checkPermissions: true,
            checkDataFlow: true,
            outputFormat: 'both'
        };
    }

    /**
     * @method getVulnerableDependencies
     * @private
     * @description 既知の脆弱性を持つ依存関係のリストを返します。（このリストは定期的な更新が必要です）
     */
    private getVulnerableDependencies(): Record<string, any> {
        return {
            'lodash': { affectedVersions: '<4.17.21', fixedVersion: '4.17.21', severity: 'high' as const },
            'axios': { affectedVersions: '<0.21.2', fixedVersion: '0.21.2', severity: 'medium' as const }
        };
    }

    /**
     * @method isVulnerableVersion
     * @private
     * @description バージョン文字列が脆弱な範囲に含まれるか簡易的にチェックします。
     */
    private isVulnerableVersion(version: string, affectedPattern: string): boolean {
        // 注: これは簡易的な実装です。実際にはセマンティックバージョニングを扱うライブラリ(semver)を使用すべきです。
        const match = affectedPattern.match(/<([0-9.]+)/);
        if (match) {
            // 簡単なバージョン比較
            const vulnerableVersion = match[1];
            const versionParts = version.replace(/["^~]/, '').split('.').map(Number);
            const vulnerableParts = vulnerableVersion.split('.').map(Number);
            for (let i = 0; i < vulnerableParts.length; i++) {
                if (versionParts[i] < vulnerableParts[i]) return true;
                if (versionParts[i] > vulnerableParts[i]) return false;
            }
        }
        return false;
    }

    /**
     * @method getDataFlowRecommendation
     * @private
     * @returns {string} データフローの問題に対する推奨対応策。
     */
    private getDataFlowRecommendation(patternName: string): string {
        const recommendations: Record<string, string> = {
            '検証されていないユーザー入力': 'SecurityValidatorを使用して入力値を検証・サニタイズしてください。',
            '直接的なDOM操作': 'innerHTMLの代わりにtextContentを使用するか、DOMPurifyのようなライブラリでHTMLをサニタイズしてください。',
            '動的なコード実行': 'eval()やnew Function()の使用を避け、安全な代替手段（データのJSONパースなど）を検討してください。',
        };
        return recommendations[patternName] || '入力値の検証と出力値のエスケープを徹底してください。';
    }

    /**
     * @method getCodePatternRecommendation
     * @private
     * @returns {string} コードパターンの問題に対する推奨対応策。
     */
    private getCodePatternRecommendation(patternName: string): string {
        const recommendations: Record<string, string> = {
            '本番コード中のconsole.log': '専用のLoggerを使用し、本番ビルドではログ出力が抑制されるように設定してください。',
            'ハードコードされたURL': 'URLは設定ファイルや環境変数から読み込むように変更してください。',
            '未解決のTODO/FIXMEコメント': 'コメントに対応するIssueを作成し、計画的に修正してください。'
        };
        return recommendations[patternName] || 'コードの品質とメンテナンス性を向上させるためのリファクタリングを検討してください。';
    }
}