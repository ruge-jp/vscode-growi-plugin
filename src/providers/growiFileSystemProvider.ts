import * as vscode from 'vscode';
import { GrowiApiClient } from '../api/client';
import { PageConflictError } from '../api/types';
import { Logger } from '../utils/logger';
import { ConflictContentProvider } from './conflictContentProvider';

/**
 * @class GrowiFileSystemProvider
 * @implements {vscode.FileSystemProvider}
 * @description GROWI上のページをVSCodeの仮想ファイルシステムとして提供するクラス。
 *              'growi:'スキーマのURIに対するファイル操作（読み込み、書き込みなど）をハンドルする。
 */
export class GrowiFileSystemProvider implements vscode.FileSystemProvider {
    private _emitter = new vscode.EventEmitter<vscode.FileChangeEvent[]>();
    readonly onDidChangeFile: vscode.Event<vscode.FileChangeEvent[]> = this._emitter.event;

    private logger = Logger.getInstance();
    private revisionMap = new Map<string, string>();
    private conflictedUris = new Set<string>();
    private localConflictContentCache = new Map<string, Uint8Array>();

    constructor(private apiClient: GrowiApiClient) {}

    watch(uri: vscode.Uri, options: { recursive: boolean; excludes: string[]; }): vscode.Disposable {
        return new vscode.Disposable(() => {});
    }

    async stat(uri: vscode.Uri): Promise<vscode.FileStat> {
        this.logger.debug(`stat: ${uri.toString()}`);
        return { type: vscode.FileType.File, ctime: Date.now(), mtime: Date.now(), size: 1024 };
    }

    readDirectory(uri: vscode.Uri): Thenable<[string, vscode.FileType][]> {
        throw vscode.FileSystemError.NoPermissions('ディレクトリの読み取りはサポートされていません。');
    }

    createDirectory(uri: vscode.Uri): void {
        throw vscode.FileSystemError.NoPermissions('ディレクトリの作成はサポートされていません。');
    }

    async readFile(uri: vscode.Uri): Promise<Uint8Array> {
        const uriString = uri.toString();
        this.logger.debug(`readFile: ${uriString}`);

        if (this.conflictedUris.has(uriString) && this.localConflictContentCache.has(uriString)) {
            this.logger.warn(`競合解決中のため、キャッシュされたローカルコンテンツを返します: ${uriString}`);
            return this.localConflictContentCache.get(uriString)!;
        }

        if (!this.apiClient.isConnected()) {
            throw vscode.FileSystemError.Unavailable('GROWIに接続されていません。');
        }
        
        const pageId = this.getPageIdFromUri(uri);
        try {
            const page = await this.apiClient.getPage(pageId, true);
            this.revisionMap.set(pageId, page.revision);
            return Buffer.from(page.content || '');
        } catch (error) {
            this.logger.error(`ページ(ID: ${pageId})の読み込みに失敗しました:`, error);
            throw vscode.FileSystemError.FileNotFound(uri);
        }
    }

    async writeFile(uri: vscode.Uri, content: Uint8Array, options: { create: boolean; overwrite: boolean; }): Promise<void> {
        this.logger.debug(`writeFile: ${uri.toString()}`);
        if (!this.apiClient.isConnected()) {
            vscode.window.showWarningMessage('GROWIに接続してください。');
            throw vscode.FileSystemError.Unavailable('GROWIに接続されていません。');
        }
        const pageId = this.getPageIdFromUri(uri);
        const fileContent = Buffer.from(content).toString('utf8');

        if (this.conflictedUris.has(uri.toString())) {
            await this.resolveConflictSave(uri, pageId, fileContent);
            return;
        }

        const revision = this.revisionMap.get(pageId);
        if (!revision) {
            throw vscode.FileSystemError.Unavailable('リビジョンIDが見つかりません。ファイルを一度閉じて開き直してください。');
        }

        try {
            const updatedPage = await this.apiClient.updatePage(pageId, { content: fileContent, revision: revision });
            this.revisionMap.set(pageId, updatedPage.revision);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
        } catch (error: any) {
            if (error?.isConflictError && error.serverPage) {
                await this.handleConflict(uri, error.serverPage, content);
            } else {
                this.logger.error(`ページ(ID: ${pageId})の書き込みに失敗しました:`, error);
                throw vscode.FileSystemError.Unavailable(`GROWIへの保存に失敗しました: ${error.message}`);
            }
        }
    }

    private async resolveConflictSave(uri: vscode.Uri, pageId: string, content: string): Promise<void> {
        const uriString = uri.toString();
        this.logger.info(`競合解決後の保存を実行: ${uriString}`);
        try {
            const serverPage = await this.apiClient.getPage(pageId, true);
            const updatedPage = await this.apiClient.updatePage(pageId, {
                content: content,
                revision: serverPage.revision,
                isOverwrite: true,
            });

            this.logger.info(`競合解決成功: ${uriString}`);
            this.revisionMap.set(pageId, updatedPage.revision);
            this.conflictedUris.delete(uriString);
            this.localConflictContentCache.delete(uriString);
            this._emitter.fire([{ type: vscode.FileChangeType.Changed, uri }]);
            vscode.window.showInformationMessage("競合は正常に解決されました。");

        } catch (error: any) {
            this.logger.error('競合解決中の保存に失敗しました:', error);
            vscode.window.showErrorMessage(`競合の解決に失敗しました: ${error.message}`);
        }
    }

    private async handleConflict(localUri: vscode.Uri, serverPage: any, localContent: Uint8Array) {
        const uriString = localUri.toString();
        this.logger.warn(`更新競合を処理中: ${uriString}`);
        const choice = await vscode.window.showWarningMessage(
            `"${serverPage.title}" の変更内容がサーバー上のバージョンと競合しました。`,
            { modal: true },
            '変更を比較する',
            '自分の変更で上書きする'
        );

        if (choice === '変更を比較する') {
            this.conflictedUris.add(uriString);
            this.localConflictContentCache.set(uriString, localContent);

            const serverUri = vscode.Uri.parse(`growi-conflict:/server/${serverPage.id}/${serverPage.title}.md`);
            ConflictContentProvider.instance.setContent(serverUri, serverPage.content);

            const title = `サーバー上の最新版 (左) ↔ あなたの編集 (右) - ${serverPage.title}`;
            await vscode.commands.executeCommand('vscode.diff', serverUri, localUri, title);
            
            vscode.window.showInformationMessage('差分を確認し、エディタでマージ編集を完了した後、ファイルを保存してください。');

        } else if (choice === '自分の変更で上書きする') {
            await this.resolveConflictSave(localUri, serverPage.id, Buffer.from(localContent).toString('utf8'));
        }
    }

    delete(uri: vscode.Uri, options: { recursive: boolean; }): void {
        throw vscode.FileSystemError.NoPermissions('ファイルの削除はサポートされていません。');
    }

    rename(oldUri: vscode.Uri, newUri: vscode.Uri, options: { overwrite: boolean; }): void {
        throw vscode.FileSystemError.NoPermissions('ファイル名の変更はサポートされていません。');
    }

    private getPageIdFromUri(uri: vscode.Uri): string {
        return uri.path.split('/')[1];
    }
}
