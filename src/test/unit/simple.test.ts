/**
 * 簡単なテスト例
 */

import * as testUtils from '../testUtils';

describe('簡単なテスト', () => {
  it('テストユーティリティが正常に動作する', () => {
    const mockPage = testUtils.createMockGrowiPage({
      title: 'Simple Test Page',
      content: 'Simple test content'
    });

    expect(mockPage.title).toBe('Simple Test Page');
    expect(mockPage.content).toBe('Simple test content');
    expect(mockPage.id).toBe('test-page-id');
  });

  it('モック接続設定が正常に動作する', () => {
    const mockConnection = testUtils.createMockGrowiConnection({
      name: 'Custom GROWI',
      serverUrl: 'https://custom.growi.com'
    });

    expect(mockConnection.name).toBe('Custom GROWI');
    expect(mockConnection.serverUrl).toBe('https://custom.growi.com');
    expect(mockConnection.authType).toBe('token');
  });

  it('モック検索結果が正常に動作する', () => {
    const mockResult = testUtils.createMockSearchResult({
      score: 0.85,
      snippet: 'Custom snippet'
    });

    expect(mockResult.score).toBe(0.85);
    expect(mockResult.snippet).toBe('Custom snippet');
    expect(mockResult.page.title).toBe('Test Page');
  });

  it('Axiosレスポンスモックが正常に動作する', () => {
    const mockResponse = testUtils.createMockAxiosResponse(
      { message: 'success' },
      200
    );

    expect(mockResponse.data.ok).toBe(true);
    expect(mockResponse.data.data.message).toBe('success');
    expect(mockResponse.status).toBe(200);

    const errorResponse = testUtils.createMockAxiosResponse(
      null,
      404
    );

    expect(errorResponse.data.ok).toBe(false);
    expect(errorResponse.data.error?.message).toBe('Test error');
    expect(errorResponse.status).toBe(404);
  });

  it('非同期ヘルパーが動作する', async () => {
    let condition = false;
    
    // 100ms後にconditionをtrueにする
    setTimeout(() => {
      condition = true;
    }, 100);

    await testUtils.waitFor(() => condition, 1000);
    
    expect(condition).toBe(true);
  }, 2000);
});