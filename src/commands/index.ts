import * as vscode from 'vscode';
import { GrowiTreeDataProvider } from '../providers/treeDataProvider';
import { ConfigManager } from '../utils/config';
import { CacheManager } from '../utils/cache';
import { Logger } from '../utils/logger';
import { GrowiTreeItem, GrowiConnection } from '../api/types';
import { GrowiApiClient } from '../api/client';
import { ConnectionsDataProvider } from '../providers/connectionsDataProvider';

/**
 * @class CommandManager
 * @description VSCode拡張機能の全コマンドを登録し、その実行ロジックを管理するクラス。
 */
export class CommandManager {
    private logger = Logger.getInstance();
    private context: vscode.ExtensionContext;
    private treeDataProvider: GrowiTreeDataProvider;
    private connectionsDataProvider: ConnectionsDataProvider;
    private configManager: ConfigManager;
    private apiClient: GrowiApiClient;

    /**
     * @constructor
     * @param {vscode.ExtensionContext} context - 拡張機能のコンテキスト。
     * @param {GrowiTreeDataProvider} treeDataProvider - ページツリーのデータプロバイダー。
     * @param {ConnectionsDataProvider} connectionsDataProvider - 接続ビューのデータプロバイダー。
     * @param {ConfigManager} configManager - 設定マネージャー。
     * @param {CacheManager} cacheManager - キャッシュマネージャー。
     * @param {GrowiApiClient} apiClient - GROWI APIクライアント。
     */
    constructor(
        context: vscode.ExtensionContext,
        treeDataProvider: GrowiTreeDataProvider,
        connectionsDataProvider: ConnectionsDataProvider,
        configManager: ConfigManager,
        cacheManager: CacheManager,
        apiClient: GrowiApiClient
    ) {
        this.context = context;
        this.treeDataProvider = treeDataProvider;
        this.connectionsDataProvider = connectionsDataProvider;
        this.configManager = configManager;
        this.apiClient = apiClient;
    }

    /**
     * @method registerCommands
     * @description すべてのコマンドをVSCodeに登録します。
     */
    public registerCommands(): void {
        const commands = [
            vscode.commands.registerCommand('growi.connect', this.connectCommand.bind(this)),
            vscode.commands.registerCommand('growi.disconnect', this.disconnectCommand.bind(this)),
            vscode.commands.registerCommand('growi.refreshTree', this.refreshTreeCommand.bind(this)),
            vscode.commands.registerCommand('growi.createPage', this.createPageCommand.bind(this)),
            vscode.commands.registerCommand('growi.deletePage', this.deletePageCommand.bind(this)),
            vscode.commands.registerCommand('growi.syncPage', this.syncPageCommand.bind(this)),
            vscode.commands.registerCommand('growi.previewPage', this.previewPageCommand.bind(this)),
            vscode.commands.registerCommand('growi.openSettings', this.openSettingsCommand.bind(this)),
            vscode.commands.registerCommand('growi.addConnection', this.addConnectionCommand.bind(this)),
            vscode.commands.registerCommand('growi.removeConnection', this.removeConnectionCommand.bind(this)),
            vscode.commands.registerCommand('growi.showPreview', this.showPreviewCommand.bind(this)),
            vscode.commands.registerCommand('growi.openPage', this.openPageCommand.bind(this)),
            vscode.commands.registerCommand('growi.refreshConnections', () => this.connectionsDataProvider.refresh()),
        ];

        // 登録したコマンドを拡張機能の破棄時にクリーンアップするリストに追加
        commands.forEach(command => this.context.subscriptions.push(command));
        this.logger.info('全コマンドが登録されました。');
    }

    /**
     * @method connectCommand
     * @private
     * @description GROWIサーバーへの接続を実行するコマンド。
     */
    private async connectCommand(): Promise<void> {
        try {
            const connection = await this.selectConnection();
            if (!connection) return; // ユーザーが接続を選択しなかった場合
            await this.treeDataProvider.connect(connection);
            vscode.window.showInformationMessage(`GROWIサーバー '${connection.name}' に正常に接続しました。`);
        } catch (error) {
            this.logger.error('接続に失敗しました:', error);
            vscode.window.showErrorMessage(`接続に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    }

    /**
     * @method disconnectCommand
     * @private
     * @description GROWIサーバーから切断するコマンド。
     */
    private async disconnectCommand(): Promise<void> {
        try {
            this.treeDataProvider.disconnect();
            vscode.window.showInformationMessage('正常に切断しました。');
        } catch (error) {
            this.logger.error('切断に失敗しました:', error);
            vscode.window.showErrorMessage(`切断に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    }

    /**
     * @method selectConnection
     * @private
     * @description ユーザーに接続先を選択させるQuickPickを表示します。
     * @returns {Promise<GrowiConnection | undefined>} 選択された接続情報。
     */
    private async selectConnection(): Promise<GrowiConnection | undefined> {
        const connections = this.configManager.getConnections();
        if (connections.length === 0) {
            vscode.window.showInformationMessage('GROWI接続が設定されていません。先に追加してください。');
            return;
        }
        if (connections.length === 1) {
            return connections[0]; // 接続先が1つの場合は選択不要
        }
        const items = connections.map(c => ({ label: c.name, description: c.serverUrl, connection: c }));
        const selected = await vscode.window.showQuickPick(items, { placeHolder: '接続するGROWIサーバーを選択してください' });
        return selected?.connection;
    }

    /**
     * @method refreshTreeCommand
     * @private
     * @param {GrowiTreeItem} [element] - 更新の起点となるツリーアイテム。指定しない場合は全体を更新。
     * @description ページツリービューを更新します。
     */
    private refreshTreeCommand(element?: GrowiTreeItem): void {
        this.treeDataProvider.refresh(element);
    }

    /**
     * @method createPageCommand
     * @private
     * @param {GrowiTreeItem} [parentItem] - 親となるページのツリーアイテム。
     * @description 新規ページを作成します。
     */
    private async createPageCommand(parentItem?: GrowiTreeItem): Promise<void> {
        this.logger.info(`createPageコマンド実行。親: ${parentItem?.title || 'ルート'}`);
        if (!this.treeDataProvider.getConnectionStatus()) {
            vscode.window.showWarningMessage('GROWIに接続されていません。');
            return;
        }
        const title = await vscode.window.showInputBox({ prompt: '作成するページのタイトルを入力してください' });
        if (!title) {
            this.logger.debug('ページ作成がキャンセルされました（タイトル未入力）。');
            return;
        }

        const parentPath = parentItem?.path || '/';
        const path = parentPath.endsWith('/') ? `${parentPath}${title}` : `${parentPath}/${title}`;
        this.logger.debug(`次のパスでページを作成します: ${path}`);

        try {
            const newPage = await this.apiClient.createPage({
                path,
                title,
                content: `# ${title}\n\n新規作成されたページです。`,
                parentId: parentItem?.id
            });
            this.logger.info(`ページがサーバー上で作成されました: ${newPage.title} (ID: ${newPage.id})`);
            this.treeDataProvider.refresh(); // ツリーを更新して新しいページを表示
            vscode.window.showInformationMessage(`ページを作成しました: ${newPage.title}`);
        } catch (error) {
            this.logger.error('ページの作成に失敗しました:', error);
            vscode.window.showErrorMessage(`ページの作成に失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method openPageCommand
     * @private
     * @param {GrowiTreeItem} item - 開くページのツリーアイテム。
     * @description 選択されたページをエディタで開きます。
     */
    private async openPageCommand(item: GrowiTreeItem): Promise<void> {
        this.logger.info(`openPageコマンド実行: ${item.title} (ID: ${item.id})`);
        if (!this.treeDataProvider.getConnectionStatus()) {
            vscode.window.showWarningMessage('GROWIに接続されていません。');
            return;
        }
        try {
            // growiスキーマのURIを生成し、FileSystemProviderを介してコンテンツを読み込む
            const uri = vscode.Uri.parse(`growi:/${item.id}/${item.title}.md`);
            const doc = await vscode.workspace.openTextDocument(uri);
            await vscode.window.showTextDocument(doc, { preview: false });
            this.logger.info(`ページをエディタで開きました: ${item.title}`);
        } catch (error) {
            this.logger.error('ページのオープンに失敗しました:', error);
            vscode.window.showErrorMessage(`ページのオープンに失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method deletePageCommand
     * @private
     * @param {GrowiTreeItem} item - 削除するページのツリーアイテム。
     * @description 選択されたページを削除します。
     */
    private async deletePageCommand(item: GrowiTreeItem): Promise<void> {
        if (!this.treeDataProvider.getConnectionStatus()) {
            vscode.window.showWarningMessage('GROWIに接続されていません。');
            return;
        }
        // 削除確認のダイアログを表示
        const result = await vscode.window.showWarningMessage(
            `ページ "${item.title}" を本当に削除しますか？`,
            { modal: true },
            '削除'
        );
        if (result !== '削除') return;

        try {
            await this.apiClient.deletePage(item.id);
            this.treeDataProvider.refresh();
            vscode.window.showInformationMessage(`ページを削除しました: ${item.title}`);
        } catch (error) {
            this.logger.error('ページの削除に失敗しました:', error);
            vscode.window.showErrorMessage(`ページの削除に失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method syncPageCommand
     * @private
     * @description 現在アクティブなエディタの内容をサーバーと同期（更新）します。
     */
    private async syncPageCommand(): Promise<void> {
        if (!this.treeDataProvider.getConnectionStatus()) {
            vscode.window.showWarningMessage('GROWIに接続されていません。');
            return;
        }
        const activeEditor = vscode.window.activeTextEditor;
        if (!activeEditor) {
            vscode.window.showWarningMessage('アクティブなエディタがありません。');
            return;
        }
        const content = activeEditor.document.getText();
        // コンテンツ内のメタデータからページIDを抽出
        const pageIdMatch = content.match(/<!-- GROWI:PAGE_ID=(.+?) -->/);

        if (!pageIdMatch) {
            const result = await vscode.window.showWarningMessage(
                'ページIDが見つかりません。新規ページとして作成しますか？',
                '新規作成'
            );
            if (result === '新規作成') await this.createPageFromEditor(activeEditor);
            return;
        }

        const pageId = pageIdMatch[1];
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'ページを同期中…',
            cancellable: false
        }, async () => {
            try {
                const page = await this.apiClient.getPage(pageId);
                // メタデータを削除したクリーンなコンテンツをサーバーに送信
                const cleanContent = content.replace(/<!-- GROWI:PAGE_ID=.+? -->\n?/, '');
                await this.apiClient.updatePage(pageId, { content: cleanContent, revision: page.revision });
                this.treeDataProvider.refresh();
                vscode.window.showInformationMessage(`ページを同期しました: ${page.title}`);
            } catch (error) {
                this.logger.error('ページの同期に失敗しました:', error);
                vscode.window.showErrorMessage(`同期に失敗しました: ${error instanceof Error ? error.message : error}`);
            }
        });
    }

    /**
     * @method createPageFromEditor
     * @private
     * @param {vscode.TextEditor} editor - 対象のエディタ。
     * @description 現在のエディタの内容から新規ページを作成します。
     */
    private async createPageFromEditor(editor: vscode.TextEditor): Promise<void> {
        const content = editor.document.getText();
        const fileName = editor.document.fileName;
        const baseName = require('path').basename(fileName, '.md');

        const title = await vscode.window.showInputBox({ prompt: 'ページのタイトルを入力してください', value: baseName });
        if (!title) return;
        const path = await vscode.window.showInputBox({ prompt: 'ページのパスを入力してください', value: `/${title}` });
        if (!path) return;

        try {
            const newPage = await this.apiClient.createPage({ path, title, content });
            // 作成後、エディタのコンテンツにページIDのメタデータを挿入
            const contentWithMeta = `<!-- GROWI:PAGE_ID=${newPage.id} -->\n${content}`;
            const edit = new vscode.WorkspaceEdit();
            const fullRange = new vscode.Range(editor.document.positionAt(0), editor.document.positionAt(content.length));
            edit.replace(editor.document.uri, fullRange, contentWithMeta);
            await vscode.workspace.applyEdit(edit);
            vscode.window.showInformationMessage(`新規ページを作成しました: ${newPage.title}`);
        } catch (error) {
            this.logger.error('エディタからのページ作成に失敗しました:', error);
            vscode.window.showErrorMessage(`ページの作成に失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method previewPageCommand
     * @private
     * @param {GrowiTreeItem} item - プレビューするページのツリーアイテム。
     * @description ページのプレビューを表示します。
     */
    private async previewPageCommand(item: GrowiTreeItem): Promise<void> {
        if (!this.treeDataProvider.getConnectionStatus()) {
            vscode.window.showWarningMessage('GROWIに接続されていません。');
            return;
        }
        try {
            const page = await this.apiClient.getPage(item.id);
            await vscode.commands.executeCommand('growi.showPreview', page);
        } catch (error) {
            this.logger.error('プレビューの表示に失敗しました:', error);
            vscode.window.showErrorMessage(`プレビューの表示に失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method openSettingsCommand
     * @private
     * @description 拡張機能の設定画面を開きます。
     */
    private openSettingsCommand(): void {
        vscode.commands.executeCommand('workbench.action.openSettings', 'growi');
    }

    /**
     * @method addConnectionCommand
     * @private
     * @description 新しいGROWI接続設定を追加します。
     */
    private async addConnectionCommand(): Promise<void> {
        try {
            const name = await vscode.window.showInputBox({ prompt: '接続名を入力してください' });
            if (!name) return;

            const serverUrl = await vscode.window.showInputBox({ prompt: 'GROWIサーバーのURLを入力してください' });
            if (!serverUrl) return;

            await this.configManager.addConnection({
                name,
                serverUrl: serverUrl.replace(/\$/, ''), // 末尾のスラッシュを削除
                authType: 'token'
            });

            vscode.window.showInformationMessage(`接続設定を追加しました: ${name}`);
            vscode.commands.executeCommand('setContext', 'growi:hasConnections', true);

            // 認証情報の設定を促す
            const result = await vscode.window.showInformationMessage('続けて認証情報を設定しますか？', '設定する');
            if (result === '設定する') {
                const newConnection = this.configManager.getConnections().find(c => c.name === name);
                if (newConnection) {
                    await this.requestAuthentication(newConnection);
                }
            }
        } catch (error) {
            this.logger.error('接続の追加に失敗しました:', error);
            vscode.window.showErrorMessage(`接続の追加に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    }

    /**
     * @method requestAuthentication
     * @private
     * @param {GrowiConnection} connection - 認証情報を設定する接続。
     * @description APIトークンの入力を求め、保存します。
     */
    private async requestAuthentication(connection: GrowiConnection): Promise<void> {
        const authValue = await vscode.window.showInputBox({
            prompt: 'GROWIのAPI Tokenを入力してください',
            password: true
        });
        if (!authValue) return;
        try {
            await this.configManager.storeAuthToken(connection.id, authValue);
            vscode.window.showInformationMessage('認証情報を保存しました。接続を実行してください。');
        } catch (error) {
            this.logger.error('認証情報の保存に失敗しました:', error);
            vscode.window.showErrorMessage(`認証情報の保存に失敗しました: ${error instanceof Error ? error.message : error}`);
        }
    }

    /**
     * @method removeConnectionCommand
     * @private
     * @param {any} [connectionItem] - 削除する接続のアイテム。
     * @description 既存のGROWI接続設定を削除します。
     */
    private async removeConnectionCommand(connectionItem?: any): Promise<void> {
        this.logger.debug(`removeConnectionCommand: 引数 = ${JSON.stringify(connectionItem)}`);

        const connections = this.configManager.getConnections();
        if (connections.length === 0) {
            vscode.window.showInformationMessage('削除する接続設定がありません。');
            return;
        }

        let targetConnection: GrowiConnection | undefined;

        if (connectionItem && connectionItem.id) {
            // TreeItemから渡された場合は、idが 'connectionId@serverUrl' のような形式になっている可能性がある
            const id = connectionItem.id.split('@')[0];
            targetConnection = connections.find(c => c.id === id);
        } else {
            const items = connections.map(conn => ({ label: conn.name, description: conn.serverUrl, connection: conn }));
            const selected = await vscode.window.showQuickPick(items, { placeHolder: '削除する接続を選択してください' });
            if (selected) {
                targetConnection = selected.connection;
            }
        }

        if (!targetConnection) {
            this.logger.debug('削除対象の接続が特定できませんでした。');
            return;
        }

        const result = await vscode.window.showWarningMessage(`接続設定 "${targetConnection.name}" を削除しますか？`, { modal: true }, '削除');
        if (result !== '削除') {
            return;
        }

        try {
            await this.configManager.removeConnection(targetConnection.id);
            if (this.configManager.getActiveConnectionId() === targetConnection.id) {
                await this.disconnectCommand();
            }
            // connectionsDataProviderの更新をトリガー
            vscode.commands.executeCommand('growi.refreshConnections');
            vscode.window.showInformationMessage(`接続 "${targetConnection.name}" を削除しました。`);
        } catch (error) {
            this.logger.error('接続の削除に失敗しました:', error);
            vscode.window.showErrorMessage(`接続の削除に失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
        }
    }

    /**
     * @method showPreviewCommand
     * @private
     * @param {any} page - プレビューするページオブジェクト。
     * @description プレビュー用のWebViewを開き、コンテンツを更新します。
     */
    private async showPreviewCommand(page: any): Promise<void> {
        try {
            // プレビュー用のWebView（パネル）を表示
            await vscode.commands.executeCommand('workbench.view.extension.growiPreview');
            // 少し待ってからコンテンツを送信しないと、WebViewの準備が間に合わない場合がある
            setTimeout(() => {
                vscode.commands.executeCommand('growi.updatePreview', page.content, page.title, page.id);
            }, 100);
        } catch (error) {
            this.logger.error('プレビューの表示に失敗しました:', error);
        }
    }
}
