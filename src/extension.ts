import * as vscode from 'vscode';
import { GrowiTreeDataProvider } from './providers/treeDataProvider';
import { ConnectionsDataProvider } from './providers/connectionsDataProvider';
import { CommandManager } from './commands';
import { GrowiWebviewProvider } from './webview';
import { ConfigManager } from './utils/config';
import { CacheManager } from './utils/cache';
import { Logger } from './utils/logger';
import { RealtimeSyncManager } from './websocket/syncManager';
import { GrowiWebSocketClient } from './websocket/client';
import { AuthManagerImpl } from './api/auth';
import { GrowiApiClientImpl } from './api/client';
import { GrowiFileSystemProvider } from './providers/growiFileSystemProvider';
import { ConflictContentProvider } from './providers/conflictContentProvider';

/**
 * @function activate
 * @param {vscode.ExtensionContext} context - VSCodeから提供される拡張機能のコンテキスト。
 * @description 拡張機能が有効化されたときに呼び出されるメインのエントリーポイント。
 *              すべてのマネージャー、プロバイダー、コマンドを初期化し、相互に連携させます。
 */
export function activate(context: vscode.ExtensionContext) {
    // シングルトンロガーのインスタンスを取得
    const logger = Logger.getInstance();
    logger.info('GROWI連携拡張機能を開始します...');

    try {
        // package.jsonの'when'句で使用するコンテキスト変数を初期化
        vscode.commands.executeCommand('setContext', 'growi:connected', false);
        vscode.commands.executeCommand('setContext', 'growi:hasConnections', false);

        // --- 依存関係の注入 (Dependency Injection) ---
        // 各コンポーネントをインスタンス化し、必要な依存関係を渡していく

        // 1. 基本ユーティリティの初期化
        const configManager = new ConfigManager(context);
        const cacheManager = new CacheManager();
        
        // 接続設定が既にあるかチェックし、コンテキストを更新
        const connections = configManager.getConnections();
        vscode.commands.executeCommand('setContext', 'growi:hasConnections', connections.length > 0);

        // 2. API関連の初期化
        const authManager = new AuthManagerImpl(configManager);
        const growiWebSocketClient = new GrowiWebSocketClient();
        context.subscriptions.push(growiWebSocketClient); // 破棄時にリソース解放
        const apiClient = new GrowiApiClientImpl(authManager, cacheManager, configManager, growiWebSocketClient);

        // 3. プロバイダーの初期化と登録
        // 仮想ファイルシステムプロバイダー (growi:/スキーマをハンドル)
        const growiFileSystemProvider = new GrowiFileSystemProvider(apiClient);
        context.subscriptions.push(vscode.workspace.registerFileSystemProvider('growi', growiFileSystemProvider, { isCaseSensitive: true }));
        
        // 更新競合時の差分表示用プロバイダー
        context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('growi-conflict', ConflictContentProvider.instance));

        // ページツリービューのデータプロバイダー
        const treeDataProvider = new GrowiTreeDataProvider(context, configManager, apiClient, cacheManager);
        const treeView = vscode.window.createTreeView('growiExplorer', { treeDataProvider, showCollapseAll: true });
        context.subscriptions.push(treeView);

        // 接続管理ビューのデータプロバイダー
        const connectionsProvider = new ConnectionsDataProvider(configManager);
        const connectionsView = vscode.window.createTreeView('growiConnections', { treeDataProvider: connectionsProvider });
        context.subscriptions.push(connectionsView);

        // 4. 高レベルマネージャーの初期化
        // リアルタイム同期マネージャー
        const realtimeSyncManager = new RealtimeSyncManager(growiWebSocketClient);
        realtimeSyncManager.setDependencies(treeDataProvider, cacheManager); // 依存関係をセット
        context.subscriptions.push(realtimeSyncManager);

        // コマンドマネージャー
        const commandManager = new CommandManager(context, treeDataProvider, connectionsProvider, configManager, cacheManager, apiClient);
        commandManager.registerCommands();

        // プレビューWebviewプロバイダー
        const webviewProvider = new GrowiWebviewProvider(context);
        context.subscriptions.push(vscode.window.registerWebviewViewProvider('growiPreview', webviewProvider));
        // プレビュー更新用コマンドの登録
        context.subscriptions.push(vscode.commands.registerCommand('growi.updatePreview',
            (content: string, title?: string, pageId?: string) => webviewProvider.updatePreview(content, title, pageId)
        ));

        // 5. UIコンポーネントの初期化
        // ステータスバーアイテム
        const statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.text = '$(plug) GROWI: Disconnected';
        statusBarItem.command = 'growi.connect';
        statusBarItem.show();
        context.subscriptions.push(statusBarItem);

        // --- イベントリスナーの設定 ---
        // 接続状態の変更を監視し、ステータスバーとコンテキストを更新
        context.subscriptions.push(
            treeDataProvider.onConnectionChanged((connected: boolean) => {
                statusBarItem.text = connected ? '$(check) GROWI: Connected' : '$(plug) GROWI: Disconnected';
                vscode.commands.executeCommand('setContext', 'growi:connected', connected);
                connectionsProvider.refresh(); // 接続ビューのアクティブ状態表示を更新
            })
        );

        logger.info('GROWI連携拡張機能は正常に有効化されました。');
        
    } catch (error) {
        logger.error('拡張機能の有効化に失敗しました:', error);
        vscode.window.showErrorMessage('GROWI連携拡張機能の初期化に失敗しました。');
    }
}

/**
 * @function deactivate
 * @description 拡張機能が無効化されるときに呼び出されるクリーンアップ関数。
 */
export function deactivate() {
    const logger = Logger.getInstance();
    logger.info('GROWI連携拡張機能を無効化します...');
    // context.subscriptionsにpushされたリソースは自動的に破棄される
}