/**
 * @file WebSocket統合モジュール エントリーポイント
 * @description このモジュールは、GROWIサーバーとのリアルタイム通信に関連する機能を集約し、外部に提供します。
 *              WebSocketクライアントによる低レベルの通信管理と、それを利用した高レベルの
 *              リアルタイム同期管理機能が含まれます。
 */

// GrowiWebSocketClientクラスをエクスポート
// このクラスは、GROWIサーバーとのSocket.IO接続を直接管理し、
// メッセージの送受信や接続状態のハンドリングを行います。
export { GrowiWebSocketClient } from './client';

// RealtimeSyncManagerクラスをエクスポート
// このクラスは、GrowiWebSocketClientを利用して、ページの変更をリアルタイムに検知し、
// 編集中のドキュメントとの同期や競合解決などを管理します。
export { RealtimeSyncManager } from './syncManager';
