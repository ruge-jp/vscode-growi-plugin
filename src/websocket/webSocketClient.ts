import { EventEmitter } from 'events';
import WebSocket from 'ws';
import { Logger } from '../utils/logger';

/**
 * @enum {number} WebSocketState
 * @description WebSocketクライアントの接続状態を定義します。
 */
export enum WebSocketState {
  CONNECTING,
  OPEN,
  CLOSING,
  CLOSED,
}

/**
 * @interface WebSocketClientOptions
 * @description WebSocketClientの動作をカスタマイズするためのオプション。
 */
export interface WebSocketClientOptions {
  /** 自動再接続を有効にするか */
  reconnectEnabled?: boolean;
  /** 再接続試行の間隔（ミリ秒） */
  reconnectInterval?: number;
  /** 最大再接続試行回数 */
  maxReconnectAttempts?: number;
  /** ハートビート（死活監視）を有効にするか */
  heartbeatEnabled?: boolean;
  /** ハートビートの間隔（ミリ秒） */
  heartbeatInterval?: number;
}

/**
 * @class WebSocketClient
 * @extends {EventEmitter}
 * @description `ws`ライブラリをラップし、自動再接続やハートビート機能を提供する汎用WebSocketクライアント。
 */
export class WebSocketClient extends EventEmitter {
  private url: string;
  private ws?: WebSocket;
  private state: WebSocketState = WebSocketState.CLOSED;
  private logger = Logger.getInstance();

  // 再接続関連のプロパティ
  private reconnectEnabled: boolean;
  private reconnectInterval: number;
  private maxReconnectAttempts: number;
  private reconnectAttempts = 0;

  // ハートビート関連のプロパティ
  private heartbeatEnabled: boolean;
  private heartbeatInterval: number;
  private heartbeatTimer?: NodeJS.Timeout;

  /**
   * @constructor
   * @param {string} url - 接続先のWebSocket URL。
   * @param {WebSocketClientOptions} [options] - 動作オプション。
   */
  constructor(url: string, options: WebSocketClientOptions = {}) {
    super();
    this.url = url;
    // オプションが指定されていない場合はデフォルト値を設定
    this.reconnectEnabled = options.reconnectEnabled ?? true;
    this.reconnectInterval = options.reconnectInterval ?? 5000;
    this.maxReconnectAttempts = options.maxReconnectAttempts ?? 5;
    this.heartbeatEnabled = options.heartbeatEnabled ?? true;
    this.heartbeatInterval = options.heartbeatInterval ?? 30000;
  }

  /**
   * @method connect
   * @description WebSocketサーバーへの接続を開始します。
   */
  public connect(): void {
    if (this.state === WebSocketState.OPEN || this.state === WebSocketState.CONNECTING) {
      this.logger.debug('WebSocketは既に接続中または接続済みです。');
      return;
    }

    this.state = WebSocketState.CONNECTING;
    this.emit('connecting');
    this.logger.debug(`WebSocketに接続中: ${this.url}`);

    this.ws = new WebSocket(this.url);

    // wsインスタンスのイベントリスナーを設定
    this.ws.on('open', this.onOpen.bind(this));
    this.ws.on('message', this.onMessage.bind(this));
    this.ws.on('close', this.onClose.bind(this));
    this.ws.on('error', this.onError.bind(this));
  }

  /**
   * @method send
   * @param {any} data - 送信するデータ。
   * @description WebSocket経由でデータを送信します。
   */
  public send(data: any): void {
    if (this.state !== WebSocketState.OPEN) {
      this.logger.error('WebSocketが接続されていません。データを送信できません。');
      return;
    }
    this.ws?.send(data);
  }

  /**
   * @method close
   * @description WebSocket接続を正常に切断します。このメソッド呼び出し後の再接続は行われません。
   */
  public close(): void {
    if (this.state === WebSocketState.CLOSED || this.state === WebSocketState.CLOSING) {
      return;
    }
    this.reconnectEnabled = false; // 手動での切断時は再接続を無効化
    this.state = WebSocketState.CLOSING;
    this.ws?.close();
  }

  /**
   * @method getState
   * @returns {WebSocketState} 現在の接続状態。
   */
  public getState(): WebSocketState {
    return this.state;
  }

  /**
   * @method onOpen
   * @private
   * @description 'open'イベントのハンドラ。接続が確立したときに呼び出されます。
   */
  private onOpen(): void {
    this.state = WebSocketState.OPEN;
    this.reconnectAttempts = 0; // 再接続試行回数をリセット
    this.emit('open');
    this.logger.info('WebSocket接続が確立しました。');

    if (this.heartbeatEnabled) {
      this.startHeartbeat();
    }
  }

  /**
   * @method onMessage
   * @private
   * @description 'message'イベントのハンドラ。サーバーからメッセージを受信したときに呼び出されます。
   */
  private onMessage(data: WebSocket.Data): void {
    this.emit('message', data);
  }

  /**
   * @method onClose
   * @private
   * @description 'close'イベントのハンドラ。接続が閉じたときに呼び出されます。
   */
  private onClose(code: number, reason: string): void {
    this.state = WebSocketState.CLOSED;
    this.stopHeartbeat();
    this.emit('close', code, reason);
    this.logger.info(`WebSocket接続が閉じられました。コード: ${code}, 理由: ${reason}`);

    // 正常な切断(コード1000)でなく、再接続が有効な場合に再接続を試みる
    if (this.reconnectEnabled && code !== 1000) {
      this.attemptReconnect();
    }
  }

  /**
   * @method onError
   * @private
   * @description 'error'イベントのハンドラ。エラー発生時に呼び出されます。
   */
  private onError(error: Error): void {
    this.emit('error', error);
    this.logger.error('WebSocketエラーが発生しました:', error);
    // 'ws'ライブラリは'error'イベントの後に'close'イベントを発行するため、
    // 再接続処理はonCloseに任せる。
  }

  /**
   * @method attemptReconnect
   * @private
   * @description 再接続を試みます。試行回数が上限に達すると諦めます。
   */
  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      this.emit('reconnect_failed');
      this.logger.error('WebSocketの最大再接続回数に達しました。');
      return;
    }

    this.reconnectAttempts++;
    // 再接続試行ごとに遅延を増やす（Exponential Backoff）
    const delay = this.reconnectInterval * this.reconnectAttempts;
    this.emit('reconnecting', this.reconnectAttempts);
    this.logger.info(`${delay}ms 後に再接続を試みます... (試行 ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

    setTimeout(() => {
      this.connect();
    }, delay);
  }

  /**
   * @method startHeartbeat
   * @private
   * @description ハートビート（死活監視）タイマーを開始します。
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // 既存のタイマーがあればクリア
    this.heartbeatTimer = setInterval(() => {
      if (this.state === WebSocketState.OPEN) {
        // 'heartbeat'イベントを発行し、上位層にPing送信などを促す
        this.emit('heartbeat');
      }
    }, this.heartbeatInterval);
    this.logger.debug('ハートビートを開始しました。');
  }

  /**
   * @method stopHeartbeat
   * @private
   * @description ハートビートタイマーを停止します。
   */
  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = undefined;
      this.logger.debug('ハートビートを停止しました。');
    }
  }
}