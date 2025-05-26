const express = require("express");
const http = require("http");
const path = require("path");
const socketIo = require("socket.io");
const fs = require("fs");
const config = require("./config/config");
const logger = require("./utils/logger");
const riskManager = require("./utils/riskManager");
const binanceClient = require("./api/binanceClient");
const MovingAverageCrossover = require("./strategies/MovingAverageCrossover");
const BacktestEngine = require("./backtesting/BacktestEngine");

// Expressアプリケーションの初期化
const app = express();
const server = http.createServer(app);
const io = socketIo(server);

// ミドルウェアの設定
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
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

// ルートページを表示
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "views", "index.html"));
});

// APIエンドポイント - 現在の価格を取得
app.get("/api/price", async (req, res) => {
  try {
    const symbol = req.query.symbol || config.trading.defaultSymbol;
    const price = await binanceClient.getCurrentPrice(symbol);
    res.json({ success: true, price, symbol });
  } catch (error) {
    logger.error(`価格取得エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - バックテスト実行
app.post("/api/backtest", async (req, res) => {
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
});

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

// APIエンドポイント - API設定の更新
app.post("/api/settings/api", (req, res) => {
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

    // 環境変数を直接変更せず、新しい設定オブジェクトを使用
    // process.env.BINANCE_API_KEY = BINANCE_API_KEY;
    // process.env.BINANCE_API_SECRET = BINANCE_API_SECRET;

    // Binanceクライアントを新しい設定で再初期化
    binanceClient.reinitialize(updatedConfig.binance);

    logger.info("API設定を安全に更新しました");

    res.json({ success: true, message: "API設定を更新しました" });
  } catch (error) {
    logger.error(`API設定更新エラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// APIエンドポイント - 戦略設定の更新
app.post("/api/settings/strategy", (req, res) => {
  try {
    const { strategyName, params } = req.body;

    if (!strategyName) {
      return res.status(400).json({
        success: false,
        error: "戦略名が必要です",
      });
    }

    // 設定を保存（実際の実装ではDBなどに保存）
    logger.info(`戦略設定を更新: ${strategyName}, ${JSON.stringify(params)}`);

    res.json({ success: true, message: "戦略設定を更新しました" });
  } catch (error) {
    logger.error(`戦略設定更新エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - リスク設定の更新
app.post("/api/settings/risk", (req, res) => {
  try {
    const { maxDailyLoss, maxWeeklyLoss, maxMonthlyLoss, positionSizePercent } =
      req.body;

    // 設定を更新
    if (maxDailyLoss !== undefined) {
      riskManager.maxDailyLoss = maxDailyLoss;
      process.env.MAX_DAILY_LOSS = maxDailyLoss;
    }

    if (maxWeeklyLoss !== undefined) {
      riskManager.maxWeeklyLoss = maxWeeklyLoss;
      process.env.MAX_WEEKLY_LOSS = maxWeeklyLoss;
    }

    if (maxMonthlyLoss !== undefined) {
      riskManager.maxMonthlyLoss = maxMonthlyLoss;
      process.env.MAX_MONTHLY_LOSS = maxMonthlyLoss;
    }

    if (positionSizePercent !== undefined) {
      riskManager.positionSizePercent = positionSizePercent;
      process.env.POSITION_SIZE_PERCENT = positionSizePercent;
    }

    logger.info("リスク設定を更新しました");

    res.json({ success: true, message: "リスク設定を更新しました" });
  } catch (error) {
    logger.error(`リスク設定更新エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - 日次損益を取得
app.get("/api/daily-profit", (req, res) => {
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
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - 取引開始
app.post("/api/trading/start", (req, res) => {
  try {
    // 実際の実装では取引エンジンを起動
    logger.info("取引を開始します");

    res.json({
      success: true,
      message: "取引を開始しました",
      strategy: "MovingAverageCrossover",
    });
  } catch (error) {
    logger.error(`取引開始エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - 取引停止
app.post("/api/trading/stop", (req, res) => {
  try {
    // 実際の実装では取引エンジンを停止
    logger.info("取引を停止します");

    res.json({
      success: true,
      message: "取引を停止しました",
    });
  } catch (error) {
    logger.error(`取引停止エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - 緊急停止
app.post("/api/trading/emergency-stop", (req, res) => {
  try {
    // 実際の実装では全ポジションをクローズして取引エンジンを停止
    logger.warning("緊急停止を実行します");

    res.json({
      success: true,
      message: "緊急停止を実行しました",
    });
  } catch (error) {
    logger.error(`緊急停止エラー: ${error.message}`);
    res.status(500).json({ success: false, error: error.message });
  }
});

// APIエンドポイント - テストモード切り替え
app.post("/api/trading/test-mode", (req, res) => {
  try {
    // テストモードのステータスを取得または反転
    const currentTestMode = config.binance.testnet || false;
    const newTestMode =
      req.body.testMode !== undefined
        ? Boolean(req.body.testMode)
        : !currentTestMode;

    // 設定を更新（コピーしてから変更）
    const updatedConfig = {
      ...config,
      binance: {
        ...config.binance,
        testnet: newTestMode,
      },
    };

    // Binanceクライアントを新しい設定で再初期化
    binanceClient
      .reinitialize(updatedConfig.binance)
      .then(() => {
        logger.info(`テストモード: ${newTestMode ? "ON" : "OFF"}`);
        res.json({
          success: true,
          testMode: newTestMode,
          message: `テストモード: ${newTestMode ? "ON" : "OFF"}`,
        });
      })
      .catch((error) => {
        logger.error(`テストモード切り替えエラー: ${error.message}`);
        res
          .status(500)
          .json({ success: false, error: "設定の適用に失敗しました" });
      });
  } catch (error) {
    logger.error(`テストモード切り替えエラー: ${error.message}`);
    res.status(500).json({ success: false, error: "内部サーバーエラー" });
  }
});

// Socket.IOイベント
io.on("connection", (socket) => {
  logger.info(`新しいクライアント接続: ${socket.id}`);

  // 切断イベント
  socket.on("disconnect", () => {
    logger.info(`クライアント切断: ${socket.id}`);
  });
});

// サーバーを起動
const PORT = config.port;
server.listen(PORT, () => {
  logger.info(`サーバー起動: http://localhost:${PORT}`);
  logger.info(`環境: ${config.nodeEnv}`);
});
