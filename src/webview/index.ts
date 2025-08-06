import * as vscode from 'vscode';

/**
 * @interface CurrentPage
 * @description 現在プレビューに表示されているページの情報を保持します。
 */
interface CurrentPage {
    content: string;
    title?: string;
    id?: string;
    revision: string;
}

/**
 * @class GrowiWebviewProvider
 * @implements {vscode.WebviewViewProvider}
 * @description 'growi.preview'ビューの実装。ページのMarkdownコンテンツをHTMLとしてレンダリングします。
 */
export class GrowiWebviewProvider implements vscode.WebviewViewProvider {
    public static readonly viewType = 'growi.preview';

    private view?: vscode.WebviewView;
    private context: vscode.ExtensionContext;
    private currentPage?: CurrentPage;

    constructor(context: vscode.ExtensionContext) {
        this.context = context;
    }

    /**
     * @method resolveWebviewView
     * @description Webviewビューが表示されるときに呼び出され、Webviewの初期化を行います。
     */
    public resolveWebviewView(
        webviewView: vscode.WebviewView,
        context: vscode.WebviewViewResolveContext,
        _token: vscode.CancellationToken,
    ) {
        this.view = webviewView;

        webviewView.webview.options = {
            enableScripts: true, // Webview内でJavaScriptを有効化
            localResourceRoots: [this.context.extensionUri] // 'media'フォルダへのアクセスを許可
        };

        webviewView.webview.html = this.getHtmlForWebview(webviewView.webview);

        // ビューが再表示された場合、最後に表示していたコンテンツを復元
        if (this.currentPage) {
            this.updateContent(this.currentPage.content, this.currentPage.title, this.currentPage.id, this.currentPage.revision);
        }
    }

    /**
     * @method updatePreview
     * @description プレビューのコンテンツを更新します。
     */
    public updatePreview(content: string, title?: string, pageId?: string, revision?: string): void {
        if (this.view) {
            this.currentPage = { content, title, id: pageId, revision: revision || '' };
            // HTML自体を再設定することも可能だが、postMessageの方が効率的
            this.updateContent(content, title, pageId, revision);
        }
    }

    /**
     * @method getHtmlForWebview
     * @private
     * @description Webviewの基本的なHTML構造を生成します。
     */
    private getHtmlForWebview(webview: vscode.Webview): string {
        // スクリプトやスタイルシートへのパスをWebview用の特別なURIに変換
        const scriptUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'main.js'));
        const styleUri = webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'media', 'styles.css'));
        
        // Content Security Policy (CSP) のためのnonce（ランダムな文字列）を生成
        const nonce = this.getNonce();

        return `
            <!DOCTYPE html>
            <html lang="en">
            <head>
                <meta charset="UTF-8">
                <!-- CSPを設定し、インラインスクリプトの実行を制限し、許可されたソースからのリソースのみを読み込む -->
                <meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src ${webview.cspSource}; script-src 'nonce-${nonce}';">
                <meta name="viewport" content="width=device-width, initial-scale=1.0">
                <title>GROWI Preview</title>
                <link href="${styleUri}" rel="stylesheet">
            </head>
            <body>
                <div id="content"></div>
                <!-- nonceを付与したスクリプトのみが実行を許可される -->
                <script nonce="${nonce}" src="${scriptUri}"></script>
            </body>
            </html>
        `;
    }

    /**
     * @method updateContent
     * @private
     * @description `postMessage` APIを使用して、Webview内のコンテンツを効率的に更新します。
     */
    private updateContent(content: string, title?: string, pageId?: string, revision?: string): void {
        this.view?.webview.postMessage({
            command: 'update',
            content,
            title,
            pageId,
            revision
        });
    }

    /**
     * @method getNonce
     * @private
     * @description CSPで使用するランダムな文字列を生成します。
     */
    private getNonce(): string {
        let text = '';
        const possible = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
        for (let i = 0; i < 32; i++) {
            text += possible.charAt(Math.floor(Math.random() * possible.length));
        }
        return text;
    }
}

/**
 * @class PageHistory
 * @description プレビューの閲覧履歴を管理し、「進む」「戻る」機能を提供します。
 */
class PageHistory {
    private history: { pageId: string, revision: string }[] = [];
    private currentIndex = -1;

    add(pageId: string, revision: string): void {
        // 同じページ・リビジョンが連続している場合は追加しない
        if (this.currentIndex >= 0 && this.history[this.currentIndex].pageId === pageId && this.history[this.currentIndex].revision === revision) {
            return;
        }
        // 「戻る」操作後に新しいページを表示した場合、それ以降の履歴を削除
        if (this.currentIndex < this.history.length - 1) {
            this.history = this.history.slice(0, this.currentIndex + 1);
        }
        this.history.push({ pageId, revision });
        this.currentIndex++;
    }

    canGoBack = (): boolean => this.currentIndex > 0;
    canGoForward = (): boolean => this.currentIndex < this.history.length - 1;

    back(): { pageId: string, revision: string } | undefined {
        return this.canGoBack() ? this.history[--this.currentIndex] : undefined;
    }

    forward(): { pageId: string, revision: string } | undefined {
        return this.canGoForward() ? this.history[++this.currentIndex] : undefined;
    }
}

/**
 * @class PreviewToolbar
 * @description プレビュー用の「進む」「戻る」ボタンをステータスバーに表示・管理します。
 */
class PreviewToolbar {
    private backButton: vscode.StatusBarItem;
    private forwardButton: vscode.StatusBarItem;
    private history: PageHistory;

    constructor(history: PageHistory) {
        this.history = history;
        this.backButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 101);
        this.backButton.text = `$(arrow-left)`;
        this.backButton.command = 'growi.preview.back';
        this.backButton.tooltip = 'プレビュー履歴を戻る';

        this.forwardButton = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        this.forwardButton.text = `$(arrow-right)`;
        this.forwardButton.command = 'growi.preview.forward';
        this.forwardButton.tooltip = 'プレビュー履歴を進む';

        this.updateVisibility();
    }

    updateVisibility(): void {
        this.history.canGoBack() ? this.backButton.show() : this.backButton.hide();
        this.history.canGoForward() ? this.forwardButton.show() : this.forwardButton.hide();
    }

    dispose(): void {
        this.backButton.dispose();
        this.forwardButton.dispose();
    }
}

/**
 * @class GrowiWebviewManager
 * @description WebviewProvider, PageHistory, PreviewToolbarを統合管理するシングルトンクラス。
 */
export class GrowiWebviewManager {
    private static instance: GrowiWebviewManager;
    private webviewProvider: GrowiWebviewProvider;
    private pageHistory = new PageHistory();
    private toolbar: PreviewToolbar;

    private constructor(context: vscode.ExtensionContext) {
        this.webviewProvider = new GrowiWebviewProvider(context);
        this.toolbar = new PreviewToolbar(this.pageHistory);
        
        // Webviewプロバイダーと関連コマンドを登録
        vscode.window.registerWebviewViewProvider('growiPreview', this.webviewProvider);
        
        vscode.commands.registerCommand('growi.updatePreview', (content: string, title?: string, pageId?: string, revision?: string) => {
            this.webviewProvider.updatePreview(content, title, pageId, revision);
            if (pageId && revision) {
                this.pageHistory.add(pageId, revision);
                this.toolbar.updateVisibility();
            }
        });

        vscode.commands.registerCommand('growi.preview.back', () => {
            const record = this.pageHistory.back();
            if (record) {
                // TODO: 実際にページ内容を再取得して表示するコマンドを呼び出す
                console.log(`履歴を戻る: ${record.pageId} (リビジョン: ${record.revision})`);
                this.toolbar.updateVisibility();
            }
        });

        vscode.commands.registerCommand('growi.preview.forward', () => {
            const record = this.pageHistory.forward();
            if (record) {
                // TODO: 実際にページ内容を再取得して表示するコマンドを呼び出す
                console.log(`履歴を進む: ${record.pageId} (リビジョン: ${record.revision})`);
                this.toolbar.updateVisibility();
            }
        });
    }

    public static getInstance(context: vscode.ExtensionContext): GrowiWebviewManager {
        if (!GrowiWebviewManager.instance) {
            GrowiWebviewManager.instance = new GrowiWebviewManager(context);
        }
        return GrowiWebviewManager.instance;
    }

    public dispose(): void {
        this.toolbar.dispose();
    }
}