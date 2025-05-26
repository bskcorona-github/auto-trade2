/**
 * Socket.IO認証ミドルウェア
 * WebSocket接続を保護するための機能を提供
 */

const logger = require("../utils/logger");

// セッション検証（auth.jsのsessionsと連携する必要がある）
const sessions = {};

/**
 * Socket.IO認証ミドルウェア
 * @param {Object} socket - Socket.IOソケットオブジェクト
 * @param {Function} next - 次のミドルウェア関数
 */
function socketAuthMiddleware(socket, next) {
  try {
    // ハンドシェイク情報からセッションIDまたはAPIキーを取得
    const { sessionId, apiKey } = socket.handshake.auth;

    // セッションまたはAPIキーが提供されていない場合
    if (!sessionId && !apiKey) {
      logger.warning(`未認証のSocket接続試行: ${socket.handshake.address}`);
      return next(new Error("認証情報が必要です"));
    }

    // セッションによる認証
    if (sessionId && sessions[sessionId]) {
      // セッションの有効期限をチェック
      if (sessions[sessionId].expires < Date.now()) {
        logger.warning(
          `期限切れセッションでのSocket接続試行: ${socket.handshake.address}`
        );
        return next(new Error("セッションの有効期限が切れました"));
      }

      // セッション情報をソケットに添付
      socket.session = sessions[sessionId];
      socket.user = {
        username: sessions[sessionId].username,
        permissions: sessions[sessionId].permissions,
      };

      logger.info(`セッション認証でSocket接続: ${socket.user.username}`);
      return next();
    }

    // APIキーによる認証はここで実装（上記のセッション認証と同様）

    // どの認証方法も成功しなかった場合
    logger.warning(
      `無効な認証情報でのSocket接続試行: ${socket.handshake.address}`
    );
    next(new Error("認証に失敗しました"));
  } catch (error) {
    logger.error(`Socket認証エラー: ${error.message}`);
    next(new Error("認証処理中にエラーが発生しました"));
  }
}

/**
 * セッション情報を設定
 * auth.jsのセッション情報と同期するために使用
 * @param {Object} authSessions - 認証モジュールのセッションオブジェクト
 */
function setSessions(authSessions) {
  if (authSessions && typeof authSessions === "object") {
    Object.assign(sessions, authSessions);
  }
}

/**
 * Socket認可ミドルウェア
 * 特定の操作に対する権限チェック
 * @param {string} permission - 必要な権限
 * @returns {Function} - Socket.IOミドルウェア
 */
function requireSocketPermission(permission) {
  return (socket, next) => {
    // ユーザー情報がない場合
    if (!socket.user) {
      return next(new Error("認証されていません"));
    }

    // 権限をチェック
    if (!socket.user.permissions.includes(permission)) {
      logger.warning(
        `権限不足のSocket操作: ${socket.user.username}, 必要な権限: ${permission}`
      );
      return next(new Error("この操作を実行する権限がありません"));
    }

    next();
  };
}

/**
 * イベントに対する権限チェックラッパー
 * @param {string} eventName - イベント名
 * @param {Function} handler - イベントハンドラ
 * @param {string} requiredPermission - 必要な権限
 * @returns {Function} - 権限チェック付きハンドラ
 */
function protectedEvent(eventName, handler, requiredPermission) {
  return (socket) => {
    socket.on(eventName, (...args) => {
      // コールバック関数を取得（最後の引数）
      const callback =
        typeof args[args.length - 1] === "function" ? args.pop() : () => {};

      // 権限チェック
      if (
        !socket.user ||
        !socket.user.permissions.includes(requiredPermission)
      ) {
        logger.warning(
          `権限不足のイベント: ${eventName}, ユーザー: ${
            socket.user?.username || "不明"
          }`
        );
        return callback({ error: "この操作を実行する権限がありません" });
      }

      // 権限があれば実行
      handler(socket, args, callback);
    });
  };
}

module.exports = {
  socketAuthMiddleware,
  setSessions,
  requireSocketPermission,
  protectedEvent,
};
