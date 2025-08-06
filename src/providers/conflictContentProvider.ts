import * as vscode from 'vscode';

/**
 * @class ConflictContentProvider
 * @implements {vscode.TextDocumentContentProvider}
 * @description ページの更新競合が発生した際に、サーバー側のコンテンツを読み取り専用ドキュメントとして提供するクラス。
 *              これにより、VSCodeの差分表示機能を利用して、ローカルの変更とサーバー上の変更を比較できる。
 *              このクラスはシングルトンパターンで実装される。
 */
export class ConflictContentProvider implements vscode.TextDocumentContentProvider {
    // シングルトンインスタンス
    private static _instance: ConflictContentProvider;

    /**
     * @static
     * @property {ConflictContentProvider} instance
     * @description ConflictContentProviderのシングルトンインスタンスを取得します。
     */
    public static get instance(): ConflictContentProvider {
        if (!ConflictContentProvider._instance) {
            ConflictContentProvider._instance = new ConflictContentProvider();
        }
        return ConflictContentProvider._instance;
    }

    // ドキュメントの変更をVSCodeに通知するためのEventEmitter
    private readonly _onDidChange = new vscode.EventEmitter<vscode.Uri>();
    readonly onDidChange = this._onDidChange.event;

    // URIをキーとして、ドキュメントのコンテンツをメモリ上に保持するMap
    private content = new Map<string, string>();

    /**
     * @constructor
     * @private
     * @description シングルトンパターンを強制するため、コンストラクタはprivateになっています。
     */
    private constructor() {}

    /**
     * @method provideTextDocumentContent
     * @param {vscode.Uri} uri - 内容を提供するドキュメントのURI。
     * @returns {string} ドキュメントのコンテンツ。
     * @description VSCodeから要求されたURIに対応するドキュメントのコンテンツを返します。
     */
    public provideTextDocumentContent(uri: vscode.Uri): string {
        return this.content.get(uri.toString()) || '';
    }

    /**
     * @method setContent
     * @param {vscode.Uri} uri - 設定するドキュメントのURI。
     * @param {string} content - 設定するコンテンツ。
     * @description 指定されたURIのドキュメントコンテンツをメモリに保存し、変更を通知します。
     */
    public setContent(uri: vscode.Uri, content: string): void {
        this.content.set(uri.toString(), content);
        // コンテンツが変更されたことをVSCodeに通知し、関連するドキュメントの再読み込みを促す
        this._onDidChange.fire(uri);
    }

    /**
     * @method deleteContent
     * @param {vscode.Uri} uri - 削除するドキュメントのURI。
     * @description 指定されたURIのドキュメントコンテンツをメモリから削除します。
     *              差分表示が閉じられた後などに呼び出される。
     */
    public deleteContent(uri: vscode.Uri): void {
        this.content.delete(uri.toString());
    }
}