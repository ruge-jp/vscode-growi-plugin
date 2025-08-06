/**
 * AuthManager 単体テスト
 */

import * as vscode from 'vscode';
import { AuthManagerImpl } from '../../../api/auth';
import { ConfigManager } from '../../../utils/config';

// VS Code APIのモック
jest.mock('vscode', () => require("../utils/testUtils").createMockVSCodeAPI());

// 依存関係のモック
const mockConfigManager = {
  getConnections: jest.fn(),
  getConnection: jest.fn(),
  getAuthToken: jest.fn(),
  storeAuthToken: jest.fn(),
  removeAuthToken: jest.fn(),
} as jest.Mocked<Partial<ConfigManager>>;

describe('AuthManager', () => {
  let authManager: AuthManagerImpl;
  let mockContext: vscode.ExtensionContext;

  beforeEach(() => {
    jest.clearAllMocks();

    // モックコンテキストの作成
    mockContext = {
      secrets: {
        get: jest.fn(),
        store: jest.fn(),
        delete: jest.fn(),
      },
      globalState: {
        get: jest.fn(),
        update: jest.fn(),
      },
      subscriptions: [],
    } as any;

    authManager = new AuthManagerImpl(
      mockContext,
      mockConfigManager as ConfigManager
    );
  });

  describe('constructor', () => {
    it('正しく初期化される', () => {
      expect(authManager).toBeInstanceOf(AuthManagerImpl);
    });
  });

  describe('authenticate', () => {
    it('Token認証で正常に認証できる', async () => {
      const connectionId = 'test-connection';
      const credentials = {
        type: 'token' as const,
        value: 'test-token-12345',
      };

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'token',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.storeAuthToken!.mockResolvedValue(undefined);

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(true);
      expect(result.connectionId).toBe(connectionId);
      expect(mockConfigManager.storeAuthToken).toHaveBeenCalledWith(
        connectionId,
        'test-token-12345'
      );
    });

    it('QueryParam認証で正常に認証できる', async () => {
      const connectionId = 'test-connection';
      const credentials = {
        type: 'queryParam' as const,
        value: 'test-query-token',
      };

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'queryParam',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.storeAuthToken!.mockResolvedValue(undefined);

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(true);
      expect(result.connectionId).toBe(connectionId);
      expect(mockConfigManager.storeAuthToken).toHaveBeenCalledWith(
        connectionId,
        'test-query-token'
      );
    });

    it('Cookie認証で正常に認証できる', async () => {
      const connectionId = 'test-connection';
      const credentials = {
        type: 'cookie' as const,
        value: 'session_id=abc123; path=/',
      };

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'cookie',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.storeAuthToken!.mockResolvedValue(undefined);

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(true);
      expect(result.connectionId).toBe(connectionId);
      expect(mockConfigManager.storeAuthToken).toHaveBeenCalledWith(
        connectionId,
        'session_id=abc123; path=/'
      );
    });

    it('存在しない接続IDでエラーになる', async () => {
      const connectionId = 'non-existent';
      const credentials = {
        type: 'token' as const,
        value: 'test-token',
      };

      mockConfigManager.getConnection!.mockReturnValue(null);

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(false);
      expect(result.error).toContain('接続設定が見つかりません');
      expect(mockConfigManager.storeAuthToken).not.toHaveBeenCalled();
    });

    it('認証タイプが一致しない場合エラーになる', async () => {
      const connectionId = 'test-connection';
      const credentials = {
        type: 'token' as const,
        value: 'test-token',
      };

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'cookie', // 異なる認証タイプ
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(false);
      expect(result.error).toContain('認証方式が一致しません');
    });

    it('トークン保存に失敗した場合エラーになる', async () => {
      const connectionId = 'test-connection';
      const credentials = {
        type: 'token' as const,
        value: 'test-token',
      };

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'token',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.storeAuthToken!.mockRejectedValue(
        new Error('Storage error')
      );

      const result = await authManager.authenticate(connectionId, credentials);

      expect(result.success).toBe(false);
      expect(result.error).toContain('認証情報の保存に失敗');
    });
  });

  describe('getAuthHeaders', () => {
    it('Token認証のヘッダーを正しく生成する', async () => {
      const connectionId = 'test-connection';
      const token = 'bearer-token-12345';

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'token',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.getAuthToken!.mockResolvedValue(token);

      const headers = await authManager.getAuthHeaders(connectionId);

      expect(headers).toEqual({
        'Authorization': `Bearer ${token}`,
      });
    });

    it('Cookie認証のヘッダーを正しく生成する', async () => {
      const connectionId = 'test-connection';
      const cookie = 'session_id=abc123; path=/';

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'cookie',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.getAuthToken!.mockResolvedValue(cookie);

      const headers = await authManager.getAuthHeaders(connectionId);

      expect(headers).toEqual({
        'Cookie': cookie,
      });
    });

    it('QueryParam認証では空のヘッダーを返す', async () => {
      const connectionId = 'test-connection';

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'queryParam',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);

      const headers = await authManager.getAuthHeaders(connectionId);

      expect(headers).toEqual({});
    });

    it('トークンが存在しない場合は空のヘッダーを返す', async () => {
      const connectionId = 'test-connection';

      const connection = global.testUtils.createMockGrowiConnection({
        id: connectionId,
        authType: 'token',
      });

      mockConfigManager.getConnection!.mockReturnValue(connection);
      mockConfigManager.getAuthToken!.mockResolvedValue(null);

      const headers = await authManager.getAuthHeaders(connectionId);

      expect(headers).toEqual({});
    });

    it('存在しない接続IDでエラーになる', async () => {
      const connectionId = 'non-existent';

      mockConfigManager.getConnection!.mockReturnValue(null);

      await expect(authManager.getAuthHeaders(connectionId)).rejects.toThrow(
        '接続設定が見つかりません'
      );
    });
  });

  describe('isAuthenticated', () => {
    it('認証済みの場合trueを返す', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.getAuthToken!.mockResolvedValue('test-token');

      const result = await authManager.isAuthenticated(connectionId);

      expect(result).toBe(true);
      expect(mockConfigManager.getAuthToken).toHaveBeenCalledWith(connectionId);
    });

    it('未認証の場合falseを返す', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.getAuthToken!.mockResolvedValue(null);

      const result = await authManager.isAuthenticated(connectionId);

      expect(result).toBe(false);
    });

    it('トークン取得でエラーが発生した場合falseを返す', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.getAuthToken!.mockRejectedValue(new Error('Storage error'));

      const result = await authManager.isAuthenticated(connectionId);

      expect(result).toBe(false);
    });
  });

  describe('clearAuthentication', () => {
    it('認証情報を正しくクリアする', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.removeAuthToken!.mockResolvedValue(undefined);

      await authManager.clearAuthentication(connectionId);

      expect(mockConfigManager.removeAuthToken).toHaveBeenCalledWith(connectionId);
    });

    it('クリア処理でエラーが発生してもスローしない', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.removeAuthToken!.mockRejectedValue(new Error('Storage error'));

      // エラーがスローされないことを確認
      await expect(authManager.clearAuthentication(connectionId)).resolves.toBeUndefined();
    });
  });

  describe('onConnectionFailure', () => {
    it('接続失敗時に認証情報をクリアする', async () => {
      const connectionId = 'test-connection';

      mockConfigManager.removeAuthToken!.mockResolvedValue(undefined);

      await authManager.onConnectionFailure(connectionId);

      expect(mockConfigManager.removeAuthToken).toHaveBeenCalledWith(connectionId);
    });
  });
});