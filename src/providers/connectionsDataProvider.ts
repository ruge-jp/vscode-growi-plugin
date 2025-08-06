import * as vscode from 'vscode';
import { ConfigManager } from '../utils/config';
import { GrowiConnection } from '../api/types';
import { Logger } from '../utils/logger';

/**
 * @class ConnectionsDataProvider
 * @implements {vscode.TreeDataProvider<ConnectionTreeItem>}
 * @description 「接続」ビューに表示されるGROWIサーバー接続の一覧を提供するTreeDataProvider。
 */
export class ConnectionsDataProvider implements vscode.TreeDataProvider<ConnectionTreeItem> {
    // ツリーデータの変更をVSCodeに通知するためのEventEmitter
    private _onDidChangeTreeData = new vscode.EventEmitter<ConnectionTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData = this._onDidChangeTreeData.event;

    private logger = Logger.getInstance();

    /**
     * @constructor
     * @param {ConfigManager} configManager - 設定管理クラスのインスタンス。
     */
    constructor(private configManager: ConfigManager) {
        // VSCodeの設定が変更されたときにツリーを自動的に更新するようリスナーを登録
        vscode.workspace.onDidChangeConfiguration(() => this.refresh(), this);
    }

    /**
     * @method refresh
     * @description ツリービューの表示を強制的に更新します。
     */
    refresh(): void {
        this._onDidChangeTreeData.fire();
    }

    /**
     * @method getTreeItem
     * @param {ConnectionTreeItem} element - ツリーアイテム。
     * @returns {vscode.TreeItem} そのアイテム自身を返します。
     * @description 指定された要素のTreeItem表現を返します。
     */
    getTreeItem(element: ConnectionTreeItem): vscode.TreeItem {
        return element;
    }

    /**
     * @method getChildren
     * @param {ConnectionTreeItem} [element] - 親要素。
     * @returns {Thenable<ConnectionTreeItem[]>} 子要素の配列。
     * @description 要素の子を取得します。ルート要素（elementがundefined）の場合、接続一覧を返します。
     */
    getChildren(element?: ConnectionTreeItem): Thenable<ConnectionTreeItem[]> {
        // このプロバイダーは階層を持たないため、ルートレベルのアイテムのみを返す
        if (!element) {
            return Promise.resolve(this.getConnectionItems());
        }
        // 子要素は存在しない
        return Promise.resolve([]);
    }

    /**
     * @method getConnectionItems
     * @private
     * @returns {ConnectionTreeItem[]} 接続設定から生成されたTreeItemの配列。
     * @description 設定ファイルからGROWI接続の一覧を読み込み、TreeItemの配列に変換します。
     */
    private getConnectionItems(): ConnectionTreeItem[] {
        const connections = this.configManager.getConnections();
        
        // 接続設定が一つも存在しない場合の表示
        if (connections.length === 0) {
            return [
                new ConnectionTreeItem(
                    '接続を追加してください',
                    vscode.TreeItemCollapsibleState.None,
                    {
                        command: 'growi.addConnection', // クリック時に接続追加コマンドを実行
                        title: '接続を追加',
                    },
                    'add' // アイコン
                )
            ];
        }

        // 各接続設定をTreeItemにマッピング
        return connections.map(connection => {
            const isActive = this.configManager.getActiveConnectionId() === connection.id;
            const item = new ConnectionTreeItem(
                connection.name,
                vscode.TreeItemCollapsibleState.None, // 接続アイテムは子を持たない
                {
                    command: 'growi.connect', // クリック時に接続コマンドを実行
                    title: '接続',
                    arguments: [connection] // コマンドに接続オブジェクトを渡す
                },
                isActive ? 'check' : 'circle-outline' // アクティブな接続にはチェックマークを表示
            );
            
            item.description = connection.serverUrl; // 説明としてサーバーURLを表示
            item.tooltip = `${connection.serverUrl} (認証方式: ${connection.authType})`;
            
            // コンテキストメニュー（右クリックメニュー）の表示を制御するための値
            // package.jsonの"view/item/context"で定義されたメニューが表示される
            item.contextValue = 'growiConnection';
            
            return item;
        });
    }
}

/**
 * @class ConnectionTreeItem
 * @extends {vscode.TreeItem}
 * @description 接続ビューで表示される各接続設定のTreeItem。
 */
export class ConnectionTreeItem extends vscode.TreeItem {
    /**
     * @constructor
     * @param {string} label - 表示されるラベル。
     * @param {vscode.TreeItemCollapsibleState} collapsibleState - アイテムが展開可能かどうか。
     * @param {vscode.Command} [command] - アイテムクリック時に実行されるコマンド。
     * @param {string} [iconId] - 表示するThemeIconのID。
     */
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly command?: vscode.Command,
        iconId?: string
    ) {
        super(label, collapsibleState);
        this.tooltip = this.label;
        this.command = command;
        
        if (iconId) {
            // VSCodeの標準アイコンセット(ThemeIcon)を使用
            this.iconPath = new vscode.ThemeIcon(iconId);
        }
    }
}