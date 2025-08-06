import * as vscode from 'vscode';

/**
 * @type LogLevel
 * @description ログ出力の重要度レベルを定義します。
 * - `debug`: 詳細なデバッグ情報
 * - `info`: 通常の動作情報
 * - `warn`: 注意を要する問題
 * - `error`: 処理の続行が困難なエラー
 */
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

/**
 * @class Logger
 * @description 拡張機能全体のログ出力を一元管理するシングルトンクラス。
 *              VSCodeのOutput Channelにログを書き込みます。
 */
export class Logger {
    private static instance: Logger;
    private outputChannel: vscode.OutputChannel;
    private logLevel: LogLevel = 'info'; // デフォルトのログレベル

    /**
     * @constructor
     * @private
     * @description シングルトンパターンを適用するため、コンストラクタはprivateです。
     *              'GROWI Integration'という名前のOutput Channelを作成します。
     */
    private constructor() {
        this.outputChannel = vscode.window.createOutputChannel('GROWI Integration');
        // ビルドタイムスタンプが存在すれば、ログの先頭に出力
        if (process.env.BUILD_TIMESTAMP) {
            this.outputChannel.appendLine(`Build: ${process.env.BUILD_TIMESTAMP}`);
        }
    }

    /**
     * @method getInstance
     * @static
     * @returns {Logger} Loggerのシングルトンインスタンス。
     * @description アプリケーション全体で単一のLoggerインスタンスを共有するために使用します。
     */
    public static getInstance(): Logger {
        if (!Logger.instance) {
            Logger.instance = new Logger();
        }
        return Logger.instance;
    }

    /**
     * @method setLogLevel
     * @param {LogLevel} level - 設定する新しいログレベル。
     * @description ログの出力レベルを設定します。設定されたレベル以上の重要度のログのみが出力されます。
     */
    public setLogLevel(level: LogLevel): void {
        this.logLevel = level;
        this.info(`ログレベルが '${level}' に設定されました。`);
    }

    /**
     * @method debug
     * @param {string} message - ログメッセージ。
     * @param {...any[]} args - 追加のログデータ。
     * @description デバッグレベルのログを出力します。
     */
    public debug(message: string, ...args: any[]): void {
        if (this.shouldLog('debug')) {
            this.writeLog('DEBUG', message, args);
        }
    }

    /**
     * @method info
     * @param {string} message - ログメッセージ。
     * @param {...any[]} args - 追加のログデータ。
     * @description 情報レベルのログを出力します。
     */
    public info(message: string, ...args: any[]): void {
        if (this.shouldLog('info')) {
            this.writeLog('INFO', message, args);
        }
    }

    /**
     * @method warn
     * @param {string} message - ログメッセージ。
     * @param {...any[]} args - 追加のログデータ。
     * @description 警告レベルのログを出力し、VSCodeの警告通知も表示します。
     */
    public warn(message: string, ...args: any[]): void {
        if (this.shouldLog('warn')) {
            this.writeLog('WARN', message, args);
            // ユーザーに気づかせるため、Output Channelへの出力と同時にポップアップ通知も表示
            vscode.window.showWarningMessage(`GROWI: ${message}`);
        }
    }

    /**
     * @method error
     * @param {string} message - ログメッセージ。
     * @param {Error | any} [error] - 関連するエラーオブジェクト。
     * @param {...any[]} args - 追加のログデータ。
     * @description エラーレベルのログを出力し、VSCodeのエラー通知も表示します。
     */
    public error(message: string, error?: Error | any, ...args: any[]): void {
        if (this.shouldLog('error')) {
            const errorMessage = error ? `${message}: ${error.message || error}` : message;
            this.writeLog('ERROR', errorMessage, args);
            
            // エラーオブジェクトにスタックトレースがあれば、それもログに出力
            if (error instanceof Error && error.stack) {
                this.outputChannel.appendLine(`Stack trace: ${error.stack}`);
            }
            
            vscode.window.showErrorMessage(`GROWI: ${message}`);
        }
    }

    /**
     * @method show
     * @description Output Channelのパネルを表示します。
     */
    public show(): void {
        this.outputChannel.show();
    }

    /**
     * @method clear
     * @description Output Channelの内容をすべてクリアします。
     */
    public clear(): void {
        this.outputChannel.clear();
        this.info('ログがクリアされました。');
    }

    /**
     * @method dispose
     * @description Output Channelのリソースを解放します。拡張機能の終了時に呼び出されます。
     */
    public dispose(): void {
        this.outputChannel.dispose();
    }

    /**
     * @method shouldLog
     * @private
     * @param {LogLevel} level - これから出力しようとしているログのレベル。
     * @returns {boolean} ログを出力すべきかどうか。
     * @description 現在設定されているログレベルに基づき、指定されたレベルのログを出力すべきか判断します。
     *              例: logLevelが'info'の場合、'info', 'warn', 'error'は出力されるが、'debug'はされない。
     */
    private shouldLog(level: LogLevel): boolean {
        const levels: LogLevel[] = ['debug', 'info', 'warn', 'error'];
        const currentIndex = levels.indexOf(this.logLevel);
        const targetIndex = levels.indexOf(level);
        return targetIndex >= currentIndex;
    }

    /**
     * @method writeLog
     * @private
     * @param {string} level - ログレベルの文字列 ('INFO', 'DEBUG'など)。
     * @param {string} message - ログメッセージ。
     * @param {any[]} args - 追加データ。
     * @description タイムスタンプとレベルを付けて、整形されたログメッセージをOutput Channelに書き込みます。
     */
    private writeLog(level: string, message: string, args: any[]): void {
        const timestamp = new Date().toISOString();
        // 追加の引数はJSON形式に変換して見やすくする
        const formattedArgs = args.length > 0 ? ` ${JSON.stringify(args, null, 2)}` : '';
        const logMessage = `[${timestamp}] [${level}] ${message}${formattedArgs}`;
        
        this.outputChannel.appendLine(logMessage);
    }
}
