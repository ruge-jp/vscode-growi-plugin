/**
 * テストユーティリティ関数
 */

// VS Code APIのモック
export const createMockVSCodeAPI = () => {
    return {
        window: {
            showInputBox: jest.fn(),
            showQuickPick: jest.fn(),
            showInformationMessage: jest.fn(),
            showErrorMessage: jest.fn(),
            showWarningMessage: jest.fn(),
            createStatusBarItem: jest.fn(() => ({
                text: '',
                show: jest.fn(),
                hide: jest.fn(),
                dispose: jest.fn()
            })),
            createTreeView: jest.fn(),
            createWebviewPanel: jest.fn()
        },
        workspace: {
            getConfiguration: jest.fn(() => ({
                get: jest.fn(),
                update: jest.fn()
            })),
            openTextDocument: jest.fn(),
            onDidChangeConfiguration: jest.fn()
        },
        commands: {
            registerCommand: jest.fn(),
            executeCommand: jest.fn()
        },
        Uri: {
            file: jest.fn(path => ({ fsPath: path })),
            parse: jest.fn()
        },
        TreeDataProvider: jest.fn(),
        TreeItem: jest.fn(),
        TreeItemCollapsibleState: {
            None: 0,
            Collapsed: 1,
            Expanded: 2
        },
        StatusBarAlignment: {
            Left: 1,
            Right: 2
        },
        ThemeColor: jest.fn()
    };
};

// グローバルAPIのモック設定
export const setupGlobalMocks = () => {
    const mockAPI = createMockVSCodeAPI();
    
    // VS Code APIをグローバルに設定
    (global as any).vscode = mockAPI;
    
    return mockAPI;
};

// テスト用の共通設定
export const commonTestSetup = () => {
    const mockAPI = setupGlobalMocks();
    
    // Jest環境設定
    jest.clearAllMocks();
    
    return { mockAPI };
};