const Binance = require("binance-api-node").default;
const config = require("../config/config");
const logger = require("../utils/logger");

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
 */
function reinitialize(options) {
  client = createClient(options);
  logger.info("Binanceクライアントを再初期化しました");
  return client;
}

/**
 * 現在の価格を取得
 * @param {string} symbol - 取引ペア（例: BTCUSDT）
 * @returns {Promise<number>} - 現在の価格
 */
async function getCurrentPrice(symbol = config.trading.defaultSymbol) {
  try {
    const ticker = await client.prices({ symbol });
    return parseFloat(ticker[symbol]);
  } catch (error) {
    logger.error(`価格取得エラー: ${error.message}`);
    throw error;
  }
}

/**
 * アカウント残高を取得
 * @returns {Promise<Object>} - アカウント情報
 */
async function getAccountBalance() {
  try {
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
  } catch (error) {
    logger.error(`アカウント残高取得エラー: ${error.message}`);
    throw error;
  }
}

/**
 * 注文を作成
 * @param {Object} orderParams - 注文パラメータ
 * @returns {Promise<Object>} - 注文情報
 */
async function createOrder(orderParams) {
  try {
    return await client.order(orderParams);
  } catch (error) {
    logger.error(`注文作成エラー: ${error.message}`);
    throw error;
  }
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
        let currentStartTime = startTime;
        let allCandles = [];

        while (currentStartTime < endTime) {
          // 次のチャンクの終了時間を計算（最大でendTimeまで）
          const chunkEndTime = Math.min(
            currentStartTime + maxTimeRange,
            endTime
          );

          // データを取得してマージ
          const chunkCandles = await fetchCandlesChunk(
            symbol,
            interval,
            limit,
            currentStartTime,
            chunkEndTime
          );
          allCandles = [...allCandles, ...chunkCandles];

          // 次のチャンクの開始時間を設定（最後のローソク足の次から）
          if (chunkCandles.length > 0) {
            // 最後のローソク足の時間 + 間隔
            currentStartTime =
              chunkCandles[chunkCandles.length - 1].time + intervalMs;
          } else {
            // データがない場合は次のチャンクへ
            currentStartTime = chunkEndTime + 1;
          }

          // 進捗ログ
          logger.debug(
            `バックテストデータ取得進捗: ${new Date(
              currentStartTime
            ).toISOString()} / ${new Date(endTime).toISOString()} (${Math.floor(
              ((currentStartTime - startTime) / (endTime - startTime)) * 100
            )}%)`
          );

          // API制限に配慮して少し待機
          await new Promise((resolve) => setTimeout(resolve, 100));
        }

        logger.info(`取得完了: 合計 ${allCandles.length} 件のローソク足データ`);
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
    logger.error(`ローソク足データ取得エラー: ${error.message}`);
    throw error;
  }
}

/**
 * 1チャンク分のローソク足データを取得
 * @private
 */
async function fetchCandlesChunk(symbol, interval, limit, startTime, endTime) {
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

module.exports = {
  client,
  reinitialize,
  getCurrentPrice,
  getAccountBalance,
  createOrder,
  getCandles,
};
