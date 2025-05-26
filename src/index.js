const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const fs = require("fs");
const cookieParser = require("cookie-parser");
const config = require("./config/config");
const logger = require("./utils/logger");
const riskManager = require("./utils/riskManager");
const binanceClient = require("./api/binanceClient");
const MovingAverageCrossover = require("./strategies/MovingAverageCrossover");
const BacktestEngine = require("./backtesting/BacktestEngine");
const auth = require("./middleware/auth");
const socketAuth = require("./middleware/socketAuth");

// Expressアプリケーションの初期化
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use(cookieParser());
app.use(express.static(path.join(__dirname, "public")));

// ビューエンジンの設定
app.set("view engine", "html");
app.engine("html", (filePath, options, callback) => {
  fs.readFile(filePath, (err, content) => {
    if (err) return callback(err);
    return callback(null, content.toString());
  });
});
app.set("views", path.join(__dirname, "views"));

// デフォルトのAPIキーを設定（本番環境では環境変数や設定ファイルから取得）
auth.setApiKeys({
  "test-api-key": {
    permissions: ["read", "backtest"],
  },
  "admin-api-key": {
    permissions: ["read", "backtest", "trading", "admin"],
  },
});

// ルートページを表示
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// ログインエンドポイント
app.post("/api/login", (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({
        success: false,
        error: "ユーザー名とパスワードが必要です",
      });
    }

    const session = auth.login(username, password);

    if (!session) {
      return res.status(401).json({
        success: false,
        error: "ログインに失敗しました: 無効なユーザー名またはパスワード",
      });
    }

    // クッキーにセッションIDを設定
    res.cookie("sessionId", session.sessionId, {
      httpOnly: true,
      secure: process.env.NODE_ENV === "production",
      maxAge: 30 * 60 * 1000, // 30分
    });

    res.json({
      success: true,
      message: "ログインに成功しました",
      user: {
        username: session.username,
        permissions: session.permissions,
      },
    });
  } catch (error) {
    logger.error(`ログインエラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// ログアウトエンドポイント
app.post("/api/logout", auth.sessionAuth, (req, res) => {
  try {
    const sessionId = req.cookies?.sessionId;

    if (sessionId) {
      auth.logout(sessionId);
      res.clearCookie("sessionId");
    }

    res.json({
      success: true,
      message: "ログアウトしました",
    });
  } catch (error) {
    logger.error(`ログアウトエラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// APIエンドポイント - 現在の価格を取得（認証必須）
app.get("/api/price", auth.apiKeyAuth, async (req, res) => {
  try {
    const symbol = req.query.symbol || config.trading.defaultSymbol;
    const price = await binanceClient.getCurrentPrice(symbol);
    res.json({ success: true, price, symbol });
  } catch (error) {
    logger.error(`価格取得エラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// APIエンドポイント - バックテスト実行（バックテスト権限必須）
app.post(
  "/api/backtest",
  auth.apiKeyAuth,
  auth.requirePermission("backtest"),
  async (req, res) => {
    try {
      const {
        symbol,
        timeframe,
        strategyName,
        strategyParams,
        startDate,
        endDate,
        initialBalance,
        positionSizePercent,
      } = req.body;

      // 入力バリデーション
      if (!symbol || typeof symbol !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "有効な取引ペアが必要です" });
      }

      if (!timeframe || typeof timeframe !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "有効な時間枠が必要です" });
      }

      if (!strategyName || typeof strategyName !== "string") {
        return res
          .status(400)
          .json({ success: false, error: "有効な戦略名が必要です" });
      }

      if (!startDate || !endDate) {
        return res
          .status(400)
          .json({ success: false, error: "有効な開始日と終了日が必要です" });
      }

      // 日付の妥当性チェック
      const startTime = new Date(startDate).getTime();
      const endTime = new Date(endDate).getTime();

      if (isNaN(startTime) || isNaN(endTime)) {
        return res
          .status(400)
          .json({ success: false, error: "無効な日付形式です" });
      }

      if (startTime >= endTime) {
        return res.status(400).json({
          success: false,
          error: "開始日は終了日より前である必要があります",
        });
      }

      // 数値パラメータのバリデーション
      if (
        initialBalance !== undefined &&
        (isNaN(initialBalance) || initialBalance <= 0)
      ) {
        return res.status(400).json({
          success: false,
          error: "初期残高は正の数値である必要があります",
        });
      }

      if (
        positionSizePercent !== undefined &&
        (isNaN(positionSizePercent) ||
          positionSizePercent <= 0 ||
          positionSizePercent > 100)
      ) {
        return res.status(400).json({
          success: false,
          error: "ポジションサイズは0より大きく100以下である必要があります",
        });
      }

      // 進捗メッセージ
      logger.info(
        `バックテスト開始: ${startDate} から ${endDate} まで (${timeframe}足)`
      );

      // ローソク足データを取得
      const candles = await binanceClient.getCandles({
        symbol: symbol || config.trading.defaultSymbol,
        interval: timeframe || config.trading.defaultTimeframe,
        startTime,
        endTime,
      });

      logger.info(`データ取得完了: ${candles.length} 件のローソク足データ`);

      // 戦略を初期化
      let strategy;
      try {
        if (strategyName === "MovingAverageCrossover") {
          strategy = new MovingAverageCrossover(strategyParams || {});
        } else {
          return res
            .status(400)
            .json({ success: false, error: "サポートされていない戦略です" });
        }
      } catch (strategyError) {
        return res.status(400).json({
          success: false,
          error: `戦略初期化エラー: ${strategyError.message}`,
        });
      }

      // バックテストエンジンを初期化して実行
      const backtestEngine = new BacktestEngine({
        initialBalance: initialBalance || 10000,
        positionSizePercent:
          positionSizePercent || config.riskManagement.positionSizePercent,
      });
      const result = backtestEngine.run(candles, strategy);

      // 実際に処理された期間情報を追加
      if (candles.length > 0) {
        const actualStartDate = new Date(candles[0].time);
        const actualEndDate = new Date(candles[candles.length - 1].time);
        logger.info(
          `実際の処理期間: ${actualStartDate.toISOString()} から ${actualEndDate.toISOString()}`
        );
      }

      // インテリジェントなサンプリングを実行
      const maxCandles = 1000; // レスポンスに含めるローソク足の最大数
      let includedCandles = candles;

      if (candles.length > maxCandles) {
        includedCandles = intelligentSampling(
          candles,
          result.signals,
          maxCandles
        );
        logger.info(
          `大量データのため ${candles.length} 件から ${includedCandles.length} 件にサンプリング`
        );
      }

      // 結果オブジェクトにローソク足データを追加
      const responseResult = {
        ...result,
        candles: includedCandles,
        totalCandleCount: candles.length,
      };

      res.json(responseResult);
    } catch (error) {
      logger.error(`バックテストエラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

/**
 * インテリジェントなサンプリングを実行
 * シグナルポイントを優先しつつ、均等なサンプリングも行う
 * @param {Array} candles - 全ローソク足データ
 * @param {Array} signals - シグナルデータ
 * @param {number} maxSamples - 最大サンプル数
 * @returns {Array} - サンプリングされたローソク足データ
 */
function intelligentSampling(candles, signals, maxSamples) {
  // シグナルポイントに対応するキャンドルを抽出
  const signalIndices = new Set();

  if (signals && signals.length > 0) {
    signals.forEach((signal) => {
      if (
        signal.candleIndex !== undefined &&
        signal.candleIndex < candles.length
      ) {
        signalIndices.add(signal.candleIndex);
      }
    });
  }

  // シグナルポイントの数を考慮して残りのポイント数を計算
  const signalCount = signalIndices.size;
  const remainingSamples = Math.max(0, maxSamples - signalCount);

  // 残りのポイントを均等に分布させる
  const sampledCandles = [];

  if (remainingSamples > 0) {
    // 均等なステップを計算
    const step = Math.max(1, Math.floor(candles.length / remainingSamples));

    // 均等サンプリング
    for (let i = 0; i < candles.length; i += step) {
      // シグナルポイントでなければ追加
      if (!signalIndices.has(i)) {
        sampledCandles.push(candles[i]);
      }

      // 最大サンプル数に達したら終了
      if (sampledCandles.length >= remainingSamples) {
        break;
      }
    }
  }

  // シグナルポイントを追加
  signalIndices.forEach((index) => {
    sampledCandles.push(candles[index]);
  });

  // 時間順にソート
  sampledCandles.sort((a, b) => a.time - b.time);

  // 最大サンプル数に制限
  return sampledCandles.slice(0, maxSamples);
}

// APIエンドポイント - 戦略パラメータ最適化
app.post("/api/optimize", async (req, res) => {
  try {
    const {
      symbol,
      timeframe,
      strategyName,
      paramRanges,
      startDate,
      endDate,
      initialBalance,
      positionSizePercent,
      optimizationMetric,
      populationSize,
      generations,
    } = req.body;

    // 最適化に必要なデータを取得
    const startTime = new Date(startDate).getTime();
    const endTime = new Date(endDate).getTime();

    // ローソク足データを取得
    const candles = await binanceClient.getCandles({
      symbol: symbol || config.trading.defaultSymbol,
      interval: timeframe || config.trading.defaultTimeframe,
      startTime,
      endTime,
    });

    // StrategyOptimizerをインポート
    const StrategyOptimizer = require("./backtesting/StrategyOptimizer");

    // 最適化エンジンを初期化
    const optimizer = new StrategyOptimizer({
      initialBalance: initialBalance || 10000,
      positionSizePercent:
        positionSizePercent || config.riskManagement.positionSizePercent,
      strategyName: strategyName || "MovingAverageCrossover",
      optimizationMetric: optimizationMetric || "profit",
      populationSize: populationSize || 20,
      generations: generations || 5,
    });

    // 最適化を実行
    const result = await optimizer.optimize(candles, paramRanges);

    res.json(result);
  } catch (error) {
    logger.error(`最適化エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - 利用可能な戦略を取得
app.get("/api/strategies", (req, res) => {
  const strategies = [
    {
      name: "MovingAverageCrossover",
      description: "移動平均線クロスオーバー戦略",
      params: {
        shortPeriod: {
          type: "number",
          default: 9,
          min: 2,
          max: 50,
          description: "短期移動平均線の期間",
        },
        longPeriod: {
          type: "number",
          default: 21,
          min: 5,
          max: 200,
          description: "長期移動平均線の期間",
        },
      },
    },
  ];

  res.json({ success: true, strategies });
});

// APIエンドポイント - API設定の更新（認証と管理者権限必須）
app.post(
  "/api/settings/api",
  auth.apiKeyAuth,
  auth.requirePermission("admin"),
  async (req, res) => {
    try {
      const { BINANCE_API_KEY, BINANCE_API_SECRET, useTestnet } = req.body;

      // 入力バリデーション
      if (
        !BINANCE_API_KEY ||
        typeof BINANCE_API_KEY !== "string" ||
        BINANCE_API_KEY.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          error: "有効なAPIキーが必要です",
        });
      }

      if (
        !BINANCE_API_SECRET ||
        typeof BINANCE_API_SECRET !== "string" ||
        BINANCE_API_SECRET.trim() === ""
      ) {
        return res.status(400).json({
          success: false,
          error: "有効なAPIシークレットが必要です",
        });
      }

      // APIキーとシークレットの組み合わせを検証
      const isValid = await binanceClient.validateApiCredentials(
        BINANCE_API_KEY,
        BINANCE_API_SECRET
      );

      if (!isValid) {
        return res.status(400).json({
          success: false,
          error:
            "APIキーとシークレットの検証に失敗しました。Binanceで有効なAPIキーを確認してください。",
        });
      }

      // 設定オブジェクトをコピーしてから変更（直接変更しない）
      const updatedConfig = {
        ...config,
        binance: {
          ...config.binance,
          apiKey: BINANCE_API_KEY,
          apiSecret: BINANCE_API_SECRET,
          testnet: Boolean(useTestnet),
        },
      };

      logger.info(
        `API設定を更新しました: ユーザー ${req.auth.username || "APIキー認証"}`
      );

      // Binanceクライアントを新しい設定で再初期化
      await binanceClient.reinitialize(updatedConfig.binance);

      // 安全な形式で情報を返す（APIキーやシークレットを直接返さない）
      const apiInfo = binanceClient.getSafeApiInfo();

      res.json({
        success: true,
        message: "API設定を更新しました",
        apiInfo,
      });
    } catch (error) {
      logger.error(`API設定更新エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// Socket.IO認証ミドルウェアを設定
io.use(socketAuth.socketAuthMiddleware);

// auth.jsとsocketAuth.jsのセッション連携を設定
socketAuth.setSessions(auth.getSessions());

// ソケット認証設定更新イベントリスナーを追加
auth.on("sessionUpdate", () => {
  socketAuth.setSessions(auth.getSessions());
  logger.debug("Socket認証セッション情報を更新しました");
});

// APIエンドポイント - 戦略設定の更新（認証と権限必須）
app.post(
  "/api/settings/strategy",
  auth.apiKeyAuth,
  auth.requirePermission("admin"),
  (req, res) => {
    try {
      const { strategyName, params } = req.body;

      if (!strategyName) {
        return res.status(400).json({
          success: false,
          error: "戦略名が必要です",
        });
      }

      // パラメータのバリデーション
      if (params && typeof params === "object") {
        // 戦略に応じたバリデーションルール
        if (strategyName === "MovingAverageCrossover") {
          if (
            params.shortPeriod !== undefined &&
            (typeof params.shortPeriod !== "number" ||
              params.shortPeriod < 2 ||
              params.shortPeriod > 50)
          ) {
            return res.status(400).json({
              success: false,
              error: "短期移動平均線の期間は2から50の間で指定してください",
            });
          }
          if (
            params.longPeriod !== undefined &&
            (typeof params.longPeriod !== "number" ||
              params.longPeriod < 5 ||
              params.longPeriod > 200)
          ) {
            return res.status(400).json({
              success: false,
              error: "長期移動平均線の期間は5から200の間で指定してください",
            });
          }
        }
      }

      // 設定を保存（実際の実装ではDBなどに保存）
      logger.info(`戦略設定を更新: ${strategyName}, ${JSON.stringify(params)}`);

      res.json({ success: true, message: "戦略設定を更新しました" });
    } catch (error) {
      logger.error(`戦略設定更新エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// APIエンドポイント - リスク設定の更新（認証と権限必須）
app.post(
  "/api/settings/risk",
  auth.apiKeyAuth,
  auth.requirePermission("admin"),
  (req, res) => {
    try {
      const {
        maxDailyLoss,
        maxWeeklyLoss,
        maxMonthlyLoss,
        positionSizePercent,
      } = req.body;

      // 入力バリデーション
      if (maxDailyLoss !== undefined) {
        if (
          typeof maxDailyLoss !== "number" ||
          maxDailyLoss < 0 ||
          maxDailyLoss > 100
        ) {
          return res.status(400).json({
            success: false,
            error: "日次最大損失は0から100の間の数値である必要があります",
          });
        }
      }

      if (maxWeeklyLoss !== undefined) {
        if (
          typeof maxWeeklyLoss !== "number" ||
          maxWeeklyLoss < 0 ||
          maxWeeklyLoss > 100
        ) {
          return res.status(400).json({
            success: false,
            error: "週次最大損失は0から100の間の数値である必要があります",
          });
        }
      }

      if (maxMonthlyLoss !== undefined) {
        if (
          typeof maxMonthlyLoss !== "number" ||
          maxMonthlyLoss < 0 ||
          maxMonthlyLoss > 100
        ) {
          return res.status(400).json({
            success: false,
            error: "月次最大損失は0から100の間の数値である必要があります",
          });
        }
      }

      if (positionSizePercent !== undefined) {
        if (
          typeof positionSizePercent !== "number" ||
          positionSizePercent <= 0 ||
          positionSizePercent > 100
        ) {
          return res.status(400).json({
            success: false,
            error:
              "ポジションサイズは0より大きく100以下の数値である必要があります",
          });
        }
      }

      // 設定を更新（環境変数は直接変更しない）
      const settings = {};

      if (maxDailyLoss !== undefined) {
        settings.maxDailyLoss = maxDailyLoss;
      }

      if (maxWeeklyLoss !== undefined) {
        settings.maxWeeklyLoss = maxWeeklyLoss;
      }

      if (maxMonthlyLoss !== undefined) {
        settings.maxMonthlyLoss = maxMonthlyLoss;
      }

      if (positionSizePercent !== undefined) {
        settings.positionSizePercent = positionSizePercent;
      }

      // RiskManagerのupdateSettings関数を使用して設定を更新
      riskManager.updateSettings(settings);

      logger.info("リスク設定を安全に更新しました");

      res.json({
        success: true,
        message: "リスク設定を更新しました",
        settings: riskManager.getRiskSettings(),
      });
    } catch (error) {
      logger.error(`リスク設定更新エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// APIエンドポイント - 日次損益を取得（認証必須）
app.get("/api/daily-profit", auth.apiKeyAuth, (req, res) => {
  try {
    // 現在のリスク統計情報を取得
    const stats = riskManager.getRiskStats();

    res.json({
      success: true,
      profit: stats.dailyProfit || 0,
      stats,
    });
  } catch (error) {
    logger.error(`日次損益取得エラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// APIエンドポイント - 取引開始（認証と取引権限必須）
app.post(
  "/api/trading/start",
  auth.apiKeyAuth,
  auth.requirePermission("trading"),
  (req, res) => {
    try {
      // 実際の実装では取引エンジンを起動
      logger.info(
        `取引を開始します: ユーザー ${req.auth.username || "APIキー認証"}`
      );

      res.json({
        success: true,
        message: "取引を開始しました",
        strategy: "MovingAverageCrossover",
      });
    } catch (error) {
      logger.error(`取引開始エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// APIエンドポイント - 取引停止（認証と取引権限必須）
app.post(
  "/api/trading/stop",
  auth.apiKeyAuth,
  auth.requirePermission("trading"),
  (req, res) => {
    try {
      // 実際の実装では取引エンジンを停止
      logger.info(
        `取引を停止します: ユーザー ${req.auth.username || "APIキー認証"}`
      );

      res.json({
        success: true,
        message: "取引を停止しました",
      });
    } catch (error) {
      logger.error(`取引停止エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// APIエンドポイント - 緊急停止（認証と取引権限必須）
app.post(
  "/api/trading/emergency-stop",
  auth.apiKeyAuth,
  auth.requirePermission("trading"),
  (req, res) => {
    try {
      // 実際の実装では全ポジションをクローズして取引エンジンを停止
      logger.warning(
        `緊急停止を実行します: ユーザー ${req.auth.username || "APIキー認証"}`
      );

      res.json({
        success: true,
        message: "緊急停止を実行しました",
      });
    } catch (error) {
      logger.error(`緊急停止エラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// APIエンドポイント - テストモード切り替え（認証と管理者権限必須）
app.post(
  "/api/trading/test-mode",
  auth.apiKeyAuth,
  auth.requirePermission("admin"),
  (req, res) => {
    try {
      // リクエストからテストモード設定を取得
      const { testMode } = req.body;

      // testModeの型を確認
      if (testMode !== undefined && typeof testMode !== "boolean") {
        return res.status(400).json({
          success: false,
          error: "テストモードはboolean型である必要があります",
        });
      }

      // 現在の設定を取得
      const currentTestMode = config.binance.testnet || false;

      // 新しい設定値（指定がなければ現在の設定を反転）
      const newTestMode = testMode !== undefined ? testMode : !currentTestMode;

      // 設定を安全に更新（オブジェクトの複製を使用）
      const updatedConfig = {
        ...config,
        binance: {
          ...config.binance,
          testnet: newTestMode,
        },
      };

      // 設定変更のログ
      logger.info(
        `テストモード設定変更: ${currentTestMode ? "ON" : "OFF"} → ${
          newTestMode ? "ON" : "OFF"
        }, ユーザー: ${req.auth.username || "APIキー認証"}`
      );

      // Binanceクライアントを新しい設定で再初期化
      binanceClient
        .reinitialize(updatedConfig.binance)
        .then(() => {
          res.json({
            success: true,
            testMode: newTestMode,
            message: `テストモードを${newTestMode ? "有効" : "無効"}にしました`,
          });
        })
        .catch((error) => {
          logger.error(`テストモード切り替えエラー: ${error.message}`);
          res.status(500).json({
            success: false,
            error: "設定の適用に失敗しました",
          });
        });
    } catch (error) {
      logger.error(`テストモード切り替えエラー: ${error.message}`);
      res.status(500).json({ success: false, error: "内部サーバーエラー" });
    }
  }
);

// Socket.IOイベント
io.on("connection", (socket) => {
  const username = socket.user?.username || "認証なし";
  logger.info(`新しいクライアント接続: ${socket.id}, ユーザー: ${username}`);

  // 価格更新イベント（読み取り権限必須）
  socketAuth.protectedEvent(
    "subscribe:price",
    (socket, args, callback) => {
      const symbol = args[0] || config.trading.defaultSymbol;
      logger.info(`価格購読開始: ${symbol}, ユーザー: ${socket.user.username}`);
      // 実際の購読ロジックをここに実装
      callback({ success: true, message: `${symbol}の価格購読を開始しました` });
    },
    "read"
  )(socket);

  // 切断イベント
  socket.on("disconnect", () => {
    logger.info(`クライアント切断: ${socket.id}, ユーザー: ${username}`);
  });
});

// グローバルエラーハンドリングミドルウェア
app.use((err, req, res, next) => {
  // エラーのログ記録
  logger.error(
    `グローバルエラーハンドラー: ${err.message}, スタック: ${err.stack}`
  );

  // クライアントに適切なレスポンスを返す
  res.status(err.status || 500).json({
    success: false,
    error:
      process.env.NODE_ENV === "production"
        ? "内部サーバーエラー"
        : err.message,
  });
});

// 404エラーハンドリング
app.use((req, res) => {
  logger.warning(
    `存在しないエンドポイントにアクセス: ${req.method} ${req.path}, IP: ${req.ip}`
  );
  res.status(404).json({
    success: false,
    error: "リクエストされたリソースが見つかりません",
  });
});

// 未処理のPromise拒否を処理
process.on("unhandledRejection", (reason, promise) => {
  logger.error(`未処理のPromise拒否: ${reason}`);
});

// 未処理の例外を処理
process.on("uncaughtException", (error) => {
  logger.error(`未処理の例外: ${error.message}, スタック: ${error.stack}`);

  // 安全にシャットダウンすべきかどうかを判断
  if (error.message.includes("EADDRINUSE")) {
    logger.error(
      "ポートが既に使用されています。サーバーをシャットダウンします。"
    );
    process.exit(1);
  }
});

// サーバーを起動
const PORT = config.port;
server.listen(PORT, () => {
  logger.info(`サーバー起動: http://localhost:${PORT}`);
  logger.info(`環境: ${config.nodeEnv}`);
});
