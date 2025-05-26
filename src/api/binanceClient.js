const Binance = require("binance-api-node").default;
const config = require("../config/config");
const logger = require("../utils/logger");

// クライアント初期化を同期的に保護するためのロック
let isInitializing = false;
let initializationQueue = [];

// Binance APIクライアントのインスタンス作成
let client = createClient(config.binance);

// Binanceクライアントを作成する関数
function createClient(options) {
  return Binance({
    apiKey: options.apiKey,
    apiSecret: options.apiSecret,
    getTime: () => Date.now(),
    httpOptions: {
      timeout: 30000, // 30秒のタイムアウト
    },
  });
}

/**
 * Binanceクライアントを再初期化
 * @param {Object} options - API設定
 * @returns {Promise<object>} - 初期化されたクライアント
 */
async function reinitialize(options) {
  // 入力検証
  if (!options || typeof options !== "object") {
    throw new Error("有効なAPIオプションが必要です");
  }

  if (
    !options.apiKey ||
    typeof options.apiKey !== "string" ||
    options.apiKey.trim() === ""
  ) {
    throw new Error("有効なAPIキーが必要です");
  }

  if (
    !options.apiSecret ||
    typeof options.apiSecret !== "string" ||
    options.apiSecret.trim() === ""
  ) {
    throw new Error("有効なAPIシークレットが必要です");
  }

  // 既に初期化中の場合はキューに追加
  if (isInitializing) {
    logger.info("別の初期化処理が進行中のため、キューに追加します");
    return new Promise((resolve, reject) => {
      initializationQueue.push({
        options,
        resolve,
        reject,
        timestamp: Date.now(),
      });
    });
  }

  isInitializing = true;
  const initStartTime = Date.now();

  try {
    logger.info("Binanceクライアントの初期化を開始します");
    client = createClient(options);

    // 接続テスト
    await executeApiCall(
      async () => await client.time(),
      "Binance API接続テスト"
    );

    logger.info(
      `Binanceクライアントを再初期化しました (${Date.now() - initStartTime}ms)`
    );

    // 古いキューリクエストを破棄（5分以上経過）
    const MAX_QUEUE_AGE = 5 * 60 * 1000; // 5分
    initializationQueue = initializationQueue.filter((item) => {
      const age = Date.now() - item.timestamp;
      if (age > MAX_QUEUE_AGE) {
        item.reject(new Error("初期化リクエストがタイムアウトしました"));
        return false;
      }
      return true;
    });

    // キューに溜まったリクエストを処理
    while (initializationQueue.length > 0) {
      const {
        options: queuedOptions,
        resolve,
        reject,
      } = initializationQueue.shift();

      try {
        // 各キューアイテムで個別に初期化を実行
        const newClient = createClient(queuedOptions);
        await executeApiCall(
          async () => await newClient.time(),
          "キューされたBinance API接続テスト"
        );

        logger.info(
          "キューに溜まったBinanceクライアント初期化リクエストを処理しました"
        );
        resolve(newClient);
      } catch (queueError) {
        logger.error(`キューされた初期化に失敗: ${queueError.message}`);
        reject(queueError);
      }
    }

    return client;
  } catch (error) {
    // エラー発生時もキューを処理（拒否）
    initializationQueue.forEach(({ reject }) => {
      reject(
        new Error(
          `初期化の失敗により関連リクエストが中断されました: ${error.message}`
        )
      );
    });
    initializationQueue = [];

    logger.error(`Binanceクライアント初期化エラー: ${error.message}`);
    throw error;
  } finally {
    isInitializing = false;
  }
}

/**
 * API呼び出しを実行し、エラーをハンドリング
 * @param {Function} apiCall - API呼び出し関数
 * @param {string} errorPrefix - エラーメッセージのプレフィックス
 * @param {number} retries - リトライ回数
 * @returns {Promise<any>} - API呼び出し結果
 */
async function executeApiCall(apiCall, errorPrefix, retries = 3) {
  try {
    return await apiCall();
  } catch (error) {
    // リトライ可能なエラーかチェック
    const isRetryableError =
      error.code === 429 || // レート制限
      error.code === -1003 || // IP制限
      (error.code >= 500 && error.code < 600); // サーバーエラー

    if (isRetryableError && retries > 0) {
      // リトライ間隔を計算（指数バックオフ）
      const retryDelay = Math.min(1000 * Math.pow(2, 3 - retries), 10000);
      logger.warning(
        `${errorPrefix}: リトライします (残り${retries}回) ${retryDelay}ms後`
      );

      await new Promise((resolve) => setTimeout(resolve, retryDelay));
      return executeApiCall(apiCall, errorPrefix, retries - 1);
    }

    // BinanceのAPI固有のエラー情報を保持
    const detailedError = new Error(`${errorPrefix}: ${error.message}`);
    detailedError.code = error.code;
    detailedError.apiError = error;

    logger.error(
      `${errorPrefix}: ${error.message} (コード: ${error.code || "なし"})`
    );
    throw detailedError;
  }
}

/**
 * 現在の価格を取得
 * @param {string} symbol - 取引ペア（例: BTCUSDT）
 * @returns {Promise<number>} - 現在の価格
 */
async function getCurrentPrice(symbol = config.trading.defaultSymbol) {
  return executeApiCall(async () => {
    const ticker = await client.prices({ symbol });
    return parseFloat(ticker[symbol]);
  }, `価格取得エラー (${symbol})`);
}

/**
 * アカウント残高を取得
 * @returns {Promise<Object>} - アカウント情報
 */
async function getAccountBalance() {
  return executeApiCall(async () => {
    const account = await client.accountInfo();
    return account.balances.reduce((acc, balance) => {
      if (parseFloat(balance.free) > 0 || parseFloat(balance.locked) > 0) {
        acc[balance.asset] = {
          free: parseFloat(balance.free),
          locked: parseFloat(balance.locked),
        };
      }
      return acc;
    }, {});
  }, "アカウント残高取得エラー");
}

/**
 * 注文を作成
 * @param {Object} orderParams - 注文パラメータ
 * @returns {Promise<Object>} - 注文情報
 */
async function createOrder(orderParams) {
  return executeApiCall(
    async () => await client.order(orderParams),
    "注文作成エラー"
  );
}

/**
 * 過去のローソク足データを取得
 * @param {Object} params - パラメータ
 * @returns {Promise<Array>} - ローソク足データの配列
 */
async function getCandles({
  symbol = config.trading.defaultSymbol,
  interval = "1h",
  limit = 500,
  startTime,
  endTime,
}) {
  try {
    // 日付範囲が大きい場合は分割して取得
    if (startTime && endTime) {
      const intervalMs = getIntervalInMs(interval);
      const maxTimeRange = intervalMs * limit;

      // 全期間が1回のリクエストで取得できる場合
      if (endTime - startTime <= maxTimeRange) {
        return await fetchCandlesChunk(
          symbol,
          interval,
          limit,
          startTime,
          endTime
        );
      }
      // 期間が大きい場合は分割して取得
      else {
        logger.info(
          `長期間のデータを取得します: ${new Date(
            startTime
          ).toISOString()} から ${new Date(endTime).toISOString()}`
        );

        // メモリ効率のために配列連結を避ける
        const allCandles = [];
        let currentStartTime = startTime;
        let requestCount = 0;
        let errorCount = 0;
        const startTimestamp = Date.now();

        while (currentStartTime < endTime) {
          // 次のチャンクの終了時間を計算（最大でendTimeまで）
          const chunkEndTime = Math.min(
            currentStartTime + maxTimeRange,
            endTime
          );

          try {
            // データを取得して追加（スプレッド演算子を使わない）
            const chunkCandles = await fetchCandlesChunk(
              symbol,
              interval,
              limit,
              currentStartTime,
              chunkEndTime
            );

            // 効率的な配列追加
            for (const candle of chunkCandles) {
              allCandles.push(candle);
            }

            // 次のチャンクの開始時間を設定（最後のローソク足の次から）
            if (chunkCandles.length > 0) {
              // 最後のローソク足の時間 + 間隔
              currentStartTime =
                chunkCandles[chunkCandles.length - 1].time + intervalMs;
            } else {
              // データがない場合は次のチャンクへ
              currentStartTime = chunkEndTime + 1;
            }

            // エラーカウントをリセット
            errorCount = 0;
          } catch (error) {
            errorCount++;

            // 連続エラーが多すぎる場合は中止
            if (errorCount >= 5) {
              throw new Error(
                `データ取得中に連続エラーが発生しました: ${error.message}`
              );
            }

            // エラー時は少し待機してから再試行
            logger.warning(
              `データ取得エラー (${errorCount}回目): ${error.message}. 再試行します...`
            );
            await new Promise((resolve) => setTimeout(resolve, 2000));
            continue;
          }

          // リクエストカウントを増やす
          requestCount++;

          // 進捗ログ
          const progressPercent = Math.floor(
            ((currentStartTime - startTime) / (endTime - startTime)) * 100
          );
          logger.debug(
            `バックテストデータ取得進捗: ${progressPercent}% (${requestCount}リクエスト, ${allCandles.length}件取得済)`
          );

          // API制限に配慮して動的に待機時間を調整
          const elapsedTime = Date.now() - startTimestamp;
          const requestsPerMinute = (requestCount / elapsedTime) * 60000;

          // Binanceの制限に近づいている場合は待機時間を長くする
          let waitTime = 100; // デフォルト待機時間(ms)

          if (requestsPerMinute > 800) {
            // Binanceの制限は1200/分だが余裕を持つ
            waitTime = 300;
          } else if (requestsPerMinute > 500) {
            waitTime = 200;
          }

          await new Promise((resolve) => setTimeout(resolve, waitTime));
        }

        logger.info(
          `取得完了: 合計 ${allCandles.length} 件のローソク足データ (${requestCount}回のリクエスト)`
        );
        return allCandles;
      }
    }
    // 日付範囲が指定されていない場合は通常のリクエスト
    else {
      return await fetchCandlesChunk(
        symbol,
        interval,
        limit,
        startTime,
        endTime
      );
    }
  } catch (error) {
    const errorMsg = `ローソク足データ取得エラー: ${error.message}`;
    logger.error(errorMsg);
    throw new Error(errorMsg);
  }
}

/**
 * 1チャンク分のローソク足データを取得
 * @private
 */
async function fetchCandlesChunk(symbol, interval, limit, startTime, endTime) {
  return executeApiCall(async () => {
    const candles = await client.candles({
      symbol,
      interval,
      limit,
      startTime,
      endTime,
    });

    return candles.map((candle) => ({
      time: candle.openTime,
      open: parseFloat(candle.open),
      high: parseFloat(candle.high),
      low: parseFloat(candle.low),
      close: parseFloat(candle.close),
      volume: parseFloat(candle.volume),
    }));
  }, `ローソク足データチャンク取得エラー (${symbol}, ${interval})`);
}

/**
 * 時間間隔をミリ秒に変換
 * @private
 */
function getIntervalInMs(interval) {
  const intervalMap = {
    "1m": 60 * 1000,
    "3m": 3 * 60 * 1000,
    "5m": 5 * 60 * 1000,
    "15m": 15 * 60 * 1000,
    "30m": 30 * 60 * 1000,
    "1h": 60 * 60 * 1000,
    "2h": 2 * 60 * 60 * 1000,
    "4h": 4 * 60 * 60 * 1000,
    "6h": 6 * 60 * 60 * 1000,
    "8h": 8 * 60 * 60 * 1000,
    "12h": 12 * 60 * 60 * 1000,
    "1d": 24 * 60 * 60 * 1000,
    "3d": 3 * 24 * 60 * 60 * 1000,
    "1w": 7 * 24 * 60 * 60 * 1000,
    "1M": 30 * 24 * 60 * 60 * 1000,
  };

  return intervalMap[interval] || 60 * 60 * 1000; // デフォルトは1時間
}

/**
 * Binanceクライアントユーティリティ関数
 * 様々なセキュリティ強化と検証機能を追加
 */

/**
 * APIキーとシークレットを検証
 * @param {string} apiKey - BinanceのAPIキー
 * @param {string} apiSecret - BinanceのAPIシークレット
 * @returns {Promise<boolean>} - 有効な場合はtrue
 */
async function validateApiCredentials(apiKey, apiSecret) {
  if (
    !apiKey ||
    !apiSecret ||
    typeof apiKey !== "string" ||
    typeof apiSecret !== "string" ||
    apiKey.trim() === "" ||
    apiSecret.trim() === ""
  ) {
    return false;
  }

  // テスト接続を試行
  try {
    const tempClient = createClient({
      apiKey,
      apiSecret,
      testnet: true, // 検証時は常にテストネットを使用
    });

    // 接続テスト - 残高照会は権限が必要なため良いテスト
    await tempClient.accountInfo();
    return true;
  } catch (error) {
    logger.warning(`APIキー検証失敗: ${error.message}`);
    return false;
  }
}

/**
 * 安全にAPIキー情報を取得（機密情報を隠す）
 * @returns {Object} - 安全なAPIキー情報
 */
function getSafeApiInfo() {
  const apiKey = config.binance.apiKey || "";
  const apiSecret = config.binance.apiSecret || "";

  return {
    hasApiKey: apiKey.length > 0,
    hasApiSecret: apiSecret.length > 0,
    apiKeyMasked:
      apiKey.length > 8
        ? `${apiKey.substring(0, 4)}...${apiKey.substring(apiKey.length - 4)}`
        : "未設定",
    testnet: !!config.binance.testnet,
  };
}

module.exports = {
  client,
  reinitialize,
  getCurrentPrice,
  getAccountBalance,
  createOrder,
  getCandles,
  validateApiCredentials,
  getSafeApiInfo,
};
