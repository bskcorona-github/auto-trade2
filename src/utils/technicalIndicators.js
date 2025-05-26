/**
 * テクニカル指標計算用ユーティリティ
 * 'technicalindicators'ライブラリのラッパーに追加機能を提供します
 */

const technicalIndicators = require("technicalindicators");
const logger = require("./logger");

/**
 * 単純移動平均(SMA)を計算
 * @param {Array} values - 価格データの配列
 * @param {number} period - 期間
 * @returns {Array} - SMA値の配列
 */
function sma(values, period) {
  try {
    return technicalIndicators.SMA.calculate({
      period: period,
      values: values,
    });
  } catch (error) {
    logger.error(`SMA計算エラー: ${error.message}`);
    return [];
  }
}

/**
 * 指数移動平均(EMA)を計算
 * @param {Array} values - 価格データの配列
 * @param {number} period - 期間
 * @returns {Array} - EMA値の配列
 */
function ema(values, period) {
  try {
    return technicalIndicators.EMA.calculate({
      period: period,
      values: values,
    });
  } catch (error) {
    logger.error(`EMA計算エラー: ${error.message}`);
    return [];
  }
}

/**
 * 相対力指数(RSI)を計算
 * @param {Array} values - 価格データの配列
 * @param {number} period - 期間
 * @returns {Array} - RSI値の配列
 */
function rsi(values, period) {
  try {
    return technicalIndicators.RSI.calculate({
      period: period,
      values: values,
    });
  } catch (error) {
    logger.error(`RSI計算エラー: ${error.message}`);
    return [];
  }
}

/**
 * MACD(Moving Average Convergence Divergence)を計算
 * @param {Array} values - 価格データの配列
 * @param {number} fastPeriod - 短期EMA期間
 * @param {number} slowPeriod - 長期EMA期間
 * @param {number} signalPeriod - シグナル期間
 * @returns {Object} - MACD, Signal, Histogramの配列を含むオブジェクト
 */
function macd(values, fastPeriod = 12, slowPeriod = 26, signalPeriod = 9) {
  try {
    return technicalIndicators.MACD.calculate({
      fastPeriod: fastPeriod,
      slowPeriod: slowPeriod,
      signalPeriod: signalPeriod,
      values: values,
    });
  } catch (error) {
    logger.error(`MACD計算エラー: ${error.message}`);
    return { macd: [], signal: [], histogram: [] };
  }
}

/**
 * ボリンジャーバンドを計算
 * @param {Array} values - 価格データの配列
 * @param {number} period - 期間
 * @param {number} stdDev - 標準偏差の倍率
 * @returns {Object} - 上限/下限/中心線の配列を含むオブジェクト
 */
function bollingerBands(values, period = 20, stdDev = 2) {
  try {
    return technicalIndicators.BollingerBands.calculate({
      period: period,
      values: values,
      stdDev: stdDev,
    });
  } catch (error) {
    logger.error(`ボリンジャーバンド計算エラー: ${error.message}`);
    return { upper: [], middle: [], lower: [] };
  }
}

/**
 * ATR(Average True Range)を計算
 * @param {Array} high - 高値の配列
 * @param {Array} low - 安値の配列
 * @param {Array} close - 終値の配列
 * @param {number} period - 期間
 * @returns {Array} - ATR値の配列
 */
function atr(high, low, close, period = 14) {
  try {
    return technicalIndicators.ATR.calculate({
      high: high,
      low: low,
      close: close,
      period: period,
    });
  } catch (error) {
    logger.error(`ATR計算エラー: ${error.message}`);
    return [];
  }
}

/**
 * ストキャスティクスオシレーターを計算
 * @param {Array} high - 高値の配列
 * @param {Array} low - 安値の配列
 * @param {Array} close - 終値の配列
 * @param {number} period - 期間
 * @param {number} signalPeriod - シグナル期間
 * @returns {Object} - k値とd値の配列を含むオブジェクト
 */
function stochastic(high, low, close, period = 14, signalPeriod = 3) {
  try {
    return technicalIndicators.Stochastic.calculate({
      high: high,
      low: low,
      close: close,
      period: period,
      signalPeriod: signalPeriod,
    });
  } catch (error) {
    logger.error(`ストキャスティクス計算エラー: ${error.message}`);
    return { k: [], d: [] };
  }
}

// インジケーターをエクスポート
module.exports = {
  sma,
  ema,
  rsi,
  macd,
  bollingerBands,
  atr,
  stochastic,
};
