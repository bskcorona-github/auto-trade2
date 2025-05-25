const fs = require("fs");
const path = require("path");

// ログディレクトリの作成
const logDir = path.join(__dirname, "../../logs");
if (!fs.existsSync(logDir)) {
  fs.mkdirSync(logDir, { recursive: true });
}

// 現在の日付を取得
const getDateString = () => {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(
    2,
    "0"
  )}-${String(now.getDate()).padStart(2, "0")}`;
};

// タイムスタンプを取得
const getTimestamp = () => {
  const now = new Date();
  return `${now.toISOString()}`;
};

// ログレベル
const LogLevel = {
  DEBUG: "DEBUG",
  INFO: "INFO",
  WARNING: "WARNING",
  ERROR: "ERROR",
};

// ログメッセージを記録する関数
function logMessage(level, message) {
  const timestamp = getTimestamp();
  const logEntry = `[${timestamp}] [${level}] ${message}\n`;

  // コンソールに出力
  console.log(logEntry);

  // ファイルに書き込み
  const dateStr = getDateString();
  const logFilePath = path.join(logDir, `${dateStr}.log`);

  fs.appendFileSync(logFilePath, logEntry);

  // エラーの場合は別ファイルにも記録
  if (level === LogLevel.ERROR) {
    const errorLogPath = path.join(logDir, `${dateStr}-errors.log`);
    fs.appendFileSync(errorLogPath, logEntry);
  }
}

module.exports = {
  debug: (message) => logMessage(LogLevel.DEBUG, message),
  info: (message) => logMessage(LogLevel.INFO, message),
  warning: (message) => logMessage(LogLevel.WARNING, message),
  error: (message) => logMessage(LogLevel.ERROR, message),
};
