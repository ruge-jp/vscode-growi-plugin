/**
 * Jest テストセットアップファイル
 * 全テストの前に実行される共通設定
 */

// テストタイムアウトの設定
jest.setTimeout(10000);

// モックの共通設定
beforeEach(() => {
  // 各テスト前にモックをクリア
  jest.clearAllMocks();
  
  // console.log/error のモック（必要に応じて）
  if (process.env.NODE_ENV === 'test') {
    jest.spyOn(console, 'log').mockImplementation(() => {});
    jest.spyOn(console, 'error').mockImplementation(() => {});
  }
});

afterEach(() => {
  // テスト後のクリーンアップ
  jest.restoreAllMocks();
});