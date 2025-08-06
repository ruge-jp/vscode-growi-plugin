/**
 * テストユーティリティ関数
 */

/**
 * モックGrowiPageを生成
 */
export function createMockGrowiPage(overrides: Partial<any> = {}) {
  return {
    id: 'test-page-id',
    path: '/test/page',
    title: 'Test Page',
    content: '# Test Page\n\nTest content',
    createdAt: new Date('2025-01-01'),
    updatedAt: new Date('2025-01-25'),
    creator: {
      id: 'user-1',
      username: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      status: 'active'
    },
    lastUpdateUser: {
      id: 'user-1', 
      username: 'testuser',
      name: 'Test User',
      email: 'test@example.com',
      status: 'active'
    },
    tags: ['test'],
    pageType: 'normal',
    hasChildren: false,
    revision: 1,
    grant: 1,
    status: 'published',
    ...overrides
  };
}

/**
 * モックGrowiConnectionを生成
 */
export function createMockGrowiConnection(overrides: Partial<any> = {}) {
  return {
    id: 'test-connection-id',
    name: 'Test GROWI Server',
    serverUrl: 'https://test.growi.com',
    authType: 'token',
    ...overrides
  };
}

/**
 * モック検索結果を生成
 */
export function createMockSearchResult(overrides: Partial<any> = {}) {
  return {
    page: createMockGrowiPage(),
    snippet: 'Test snippet with highlighted content',
    score: 0.95,
    ...overrides
  };
}

/**
 * VS Code API のモック
 */
export function createMockVSCodeAPI() {
  return {
    window: {
      showInformationMessage: jest.fn().mockResolvedValue(undefined),
      showWarningMessage: jest.fn().mockResolvedValue(undefined),
      showErrorMessage: jest.fn().mockResolvedValue(undefined),
      showInputBox: jest.fn().mockResolvedValue('test input'),
      showQuickPick: jest.fn().mockResolvedValue(undefined),
      withProgress: jest.fn().mockImplementation((options: any, task: any) => task({ report: jest.fn() })),
      createTreeView: jest.fn().mockReturnValue({
        reveal: jest.fn(),
        onDidChangeSelection: jest.fn(),
        onDidChangeVisibility: jest.fn(),
      }),
      registerTreeDataProvider: jest.fn(),
      activeTextEditor: null,
    },
    workspace: {
      getConfiguration: jest.fn().mockReturnValue({
        get: jest.fn(),
        update: jest.fn(),
        has: jest.fn(),
        inspect: jest.fn(),
      }),
      openTextDocument: jest.fn(),
      applyEdit: jest.fn(),
      onDidChangeConfiguration: jest.fn(),
    },
    commands: {
      registerCommand: jest.fn(),
      executeCommand: jest.fn(),
    },
    Uri: {
      parse: jest.fn().mockImplementation((str: string) => ({ fsPath: str, path: str })),
      file: jest.fn().mockImplementation((str: string) => ({ fsPath: str, path: str })),
      from: jest.fn().mockImplementation((obj: any) => obj),
    },
    TreeItemCollapsibleState: {
      None: 0,
      Collapsed: 1,
      Expanded: 2,
    },
    ProgressLocation: {
      Notification: 15,
    },
    ThemeIcon: jest.fn().mockImplementation((id: string) => ({ id })),
    EventEmitter: jest.fn().mockImplementation(() => ({
      event: jest.fn(),
      fire: jest.fn(),
      dispose: jest.fn(),
    })),
    ExtensionContext: jest.fn(),
    Position: jest.fn().mockImplementation((line: number, char: number) => ({ line, character: char })),
    Range: jest.fn().mockImplementation((start: any, end: any) => ({ start, end })),
    WorkspaceEdit: jest.fn().mockImplementation(() => ({
      insert: jest.fn(),
      replace: jest.fn(),
      delete: jest.fn(),
    })),
    MarkdownString: jest.fn().mockImplementation((value: string) => ({
      value,
      isTrusted: false,
      appendMarkdown: jest.fn(),
    })),
  };
}

/**
 * HTTP リクエストのモック
 */
export function createMockAxiosResponse(data: any, status = 200) {
  return {
    data: {
      ok: status < 400,
      data,
      error: status >= 400 ? { message: 'Test error' } : null,
    },
    status,
    statusText: status < 400 ? 'OK' : 'Error',
    headers: {},
    config: {},
  };
}

/**
 * 非同期テストのヘルパー
 */
export function waitFor(condition: () => boolean, timeout = 5000): Promise<void> {
  return new Promise((resolve, reject) => {
    const startTime = Date.now();
    const checkCondition = () => {
      if (condition()) {
        resolve();
      } else if (Date.now() - startTime > timeout) {
        reject(new Error('Timeout waiting for condition'));
      } else {
        setTimeout(checkCondition, 10);
      }
    };
    checkCondition();
  });
}