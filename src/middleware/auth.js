/**
 * 認証・認可ミドルウェア
 * APIエンドポイントを保護するための機能を提供
 */

const crypto = require("crypto");
const EventEmitter = require("events");
const logger = require("../utils/logger");

// イベントエミッターの作成
const authEvents = new EventEmitter();

// APIキー設定
let apiKeys = {};

// 環境変数からデフォルトAPIキーを取得
const initializeDefaultApiKeys = () => {
  const testApiKey = process.env.TEST_API_KEY || "test-api-key";
  const adminApiKey = process.env.ADMIN_API_KEY || "admin-api-key";

  return {
    [testApiKey]: {
      permissions: ["read", "backtest"],
    },
    [adminApiKey]: {
      permissions: ["read", "backtest", "trading", "admin"],
    },
    // Binanceテスト用APIキーも追加
    [process.env.BINANCE_API_KEY]: {
      permissions: ["read", "backtest", "trading"],
    },
  };
};

// 初期APIキーをセット
apiKeys = initializeDefaultApiKeys();

// セッション情報ストア
const sessions = {};

/**
 * 安全なランダムキーを生成
 * @param {number} length - 生成するキーの長さ
 * @returns {string} - 生成されたキー
 */
function generateSecureKey(length = 32) {
  return crypto.randomBytes(length).toString("hex");
}

/**
 * APIキーを設定
 * @param {Object} keys - APIキーオブジェクト
 */
function setApiKeys(keys) {
  if (keys && typeof keys === "object") {
    // 既存のキーとマージ
    apiKeys = { ...apiKeys, ...keys };
    logger.info("APIキー設定を更新しました");
  }
}

/**
 * セッション情報を取得（外部モジュールとの連携用）
 * @returns {Object} - セッション情報オブジェクト
 */
function getSessions() {
  return sessions;
}

/**
 * APIキー認証ミドルウェア
 * APIキーによる認証を実行
 */
function apiKeyAuth(req, res, next) {
  // リクエストからAPIキーを取得
  const apiKey = req.headers["x-api-key"];

  // キーが指定されていない場合
  if (!apiKey) {
    return res.status(401).json({
      success: false,
      error: "認証に失敗しました: APIキーが必要です",
    });
  }

  // キーが有効かチェック
  if (!apiKeys[apiKey]) {
    logger.warning(`無効なAPIキーでのアクセス試行: ${req.ip}`);
    return res.status(401).json({
      success: false,
      error: "認証に失敗しました: 無効なAPIキー",
    });
  }

  // 認証成功
  req.auth = {
    apiKey,
    permissions: apiKeys[apiKey].permissions || [],
  };

  next();
}

/**
 * 権限チェックミドルウェア
 * 指定された権限を持っているかチェック
 * @param {string} permission - 必要な権限
 * @returns {Function} - Expressミドルウェア
 */
function requirePermission(permission) {
  return (req, res, next) => {
    // 認証されていない場合
    if (!req.auth) {
      return res.status(401).json({
        success: false,
        error: "認証されていません",
      });
    }

    // 権限をチェック
    if (!req.auth.permissions.includes(permission)) {
      logger.warning(
        `権限不足のアクセス試行: ${req.ip}, 必要な権限: ${permission}`
      );
      return res.status(403).json({
        success: false,
        error: "この操作を実行する権限がありません",
      });
    }

    next();
  };
}

/**
 * セッション認証ミドルウェア
 * ウェブセッションによる認証
 */
function sessionAuth(req, res, next) {
  // セッションIDを取得
  const sessionId = req.cookies?.sessionId;

  if (!sessionId || !sessions[sessionId]) {
    return res.status(401).json({
      success: false,
      error: "認証に失敗しました: ログインが必要です",
    });
  }

  // セッションの有効期限をチェック
  const session = sessions[sessionId];
  if (session.expires < Date.now()) {
    delete sessions[sessionId];
    authEvents.emit("sessionUpdate");
    return res.status(401).json({
      success: false,
      error: "セッションの有効期限が切れました: 再ログインしてください",
    });
  }

  // セッション情報をリクエストに添付
  req.session = session;
  req.auth = {
    username: session.username,
    permissions: session.permissions,
  };

  // セッションの有効期限を延長（30分）
  session.expires = Date.now() + 30 * 60 * 1000;

  next();
}

/**
 * ログイン処理
 * @param {string} username - ユーザー名
 * @param {string} password - パスワード
 * @returns {Object} - セッション情報
 */
function login(username, password) {
  // 実際のシステムでは、データベースからユーザー情報を検索し、
  // パスワードハッシュを検証するなどの処理が必要

  // ここではデモ用の簡易実装
  if (username === "admin" && password === "password") {
    const sessionId = generateSecureKey();
    const session = {
      id: sessionId,
      username,
      permissions: ["admin", "trading", "backtest"],
      created: Date.now(),
      expires: Date.now() + 30 * 60 * 1000, // 30分
    };

    sessions[sessionId] = session;
    authEvents.emit("sessionUpdate");
    return { sessionId, ...session };
  }

  return null;
}

/**
 * ログアウト処理
 * @param {string} sessionId - セッションID
 */
function logout(sessionId) {
  if (sessionId && sessions[sessionId]) {
    delete sessions[sessionId];
    authEvents.emit("sessionUpdate");
    return true;
  }
  return false;
}

// 定期的にセッションのクリーンアップを実行
setInterval(() => {
  const now = Date.now();
  let expiredCount = 0;

  Object.keys(sessions).forEach((sessionId) => {
    if (sessions[sessionId].expires < now) {
      delete sessions[sessionId];
      expiredCount++;
    }
  });

  if (expiredCount > 0) {
    logger.debug(`期限切れセッション削除: ${expiredCount}件`);
    authEvents.emit("sessionUpdate");
  }
}, 15 * 60 * 1000); // 15分ごとに実行

// イベントリスナー登録関数
function on(event, listener) {
  authEvents.on(event, listener);
}

module.exports = {
  apiKeyAuth,
  sessionAuth,
  requirePermission,
  login,
  logout,
  setApiKeys,
  getSessions,
  on,
};
