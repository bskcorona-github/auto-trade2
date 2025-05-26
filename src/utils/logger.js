const fs = require("fs");
const path = require("path");
const { format } = require("util");

// ログレベル
const LOG_LEVELS = {
  DEBUG: 0,
  INFO: 1,
  WARNING: 2,
  ERROR: 3,
};

// 現在のログレベル（環境変数から取得またはデフォルト値）
const currentLogLevel = LOG_LEVELS[process.env.LOG_LEVEL] || LOG_LEVELS.INFO;

// ログディレクトリを作成
const logDir = path.join(__dirname, "../../logs");
try {
  if (!fs.existsSync(logDir)) {
    fs.mkdirSync(logDir, { recursive: true });
  }
} catch (error) {
  console.error(`ログディレクトリ作成エラー: ${error.message}`);
}

// 現在の日付からログファイル名を生成
function getLogFileName() {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}.log`;
}

// ログファイルのパスを取得
const logFilePath = path.join(logDir, getLogFileName());

/**
 * メッセージをログに記録
 * @param {string} level - ログレベル
 * @param {string} message - ログメッセージ
 */
function log(level, message) {
  // ログレベルをチェック
  if (LOG_LEVELS[level] < currentLogLevel) return;

  try {
    const timestamp = new Date().toISOString();
    // ログメッセージをサニタイズ
    const sanitizedMessage = sanitizeLogMessage(message);
    const logEntry = `[${timestamp}] [${level}] ${sanitizedMessage}\n`;

    // 非同期でファイルに書き込み
    fs.appendFile(logFilePath, logEntry, (err) => {
      if (err) {
        console.error(`ログ書き込みエラー: ${err.message}`);
      }
    });

    // コンソールにも出力
    console.log(`${level}: ${sanitizedMessage}`);
  } catch (error) {
    console.error(`ログエラー: ${error.message}`);
  }
}

/**
 * ログメッセージをサニタイズ
 * @param {string} message - 元のメッセージ
 * @returns {string} - サニタイズされたメッセージ
 */
function sanitizeLogMessage(message) {
  if (typeof message !== "string") {
    // 文字列でない場合は安全に変換
    try {
      message = format(message);
    } catch (e) {
      return "[変換不可能なメッセージ]";
    }
  }

  // セキュリティのためにコントロールシーケンスやログフォーマットを改ざんする可能性のある文字を無害化
  // 改行やタブを空白に置換
  message = message.replace(/[\r\n\t\v\f]/g, " ");

  // ANSI制御シーケンス（カラーコードなど）を削除
  message = message.replace(/\x1b\[[0-9;]*[mGKHF]/g, "");

  // ログエントリを改ざんする可能性のある文字列パターンを置換
  message = message.replace(
    /\[\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}.*?\]/g,
    "[FILTERED]"
  );

  return message;
}

// ログ関数をエクスポート
module.exports = {
  debug: (message) => log("DEBUG", message),
  info: (message) => log("INFO", message),
  warning: (message) => log("WARNING", message),
  error: (message) => log("ERROR", message),
};
