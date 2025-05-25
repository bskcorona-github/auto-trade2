const technicalIndicators = require("technicalindicators");
const logger = require("../utils/logger");

/**
 * 移動平均線クロスオーバー戦略
 * 短期移動平均線が長期移動平均線を上から下に抜けたらSELL
 * 短期移動平均線が長期移動平均線を下から上に抜けたらBUY
 */
class MovingAverageCrossover {
  constructor(params = {}) {
    // デフォルトパラメータ
    this.shortPeriod = params.shortPeriod || 9;
    this.longPeriod = params.longPeriod || 21;
    this.name = "MovingAverageCrossover";
    this.description = `移動平均線クロスオーバー戦略 (短期: ${this.shortPeriod}, 長期: ${this.longPeriod})`;
  }

  /**
   * 戦略を実行し、シグナルを生成
   * @param {Array} candles - ローソク足データ
   * @returns {Object} - シグナル情報
   */
  execute(candles) {
    if (!candles || candles.length < this.longPeriod + 5) {
      logger.warning(
        `データ不足: 移動平均線計算には少なくとも ${
          this.longPeriod + 5
        } 件のデータが必要です`
      );
      return { signal: "NEUTRAL", reason: "データ不足" };
    }

    try {
      // 終値を抽出
      const closes = candles.map((candle) => candle.close);

      // 移動平均線を計算
      const shortMA = technicalIndicators.SMA.calculate({
        period: this.shortPeriod,
        values: closes,
      });

      const longMA = technicalIndicators.SMA.calculate({
        period: this.longPeriod,
        values: closes,
      });

      // 結果の長さを合わせる
      const diff = shortMA.length - longMA.length;
      const shortMAAligned = shortMA.slice(-longMA.length);

      // 現在と1つ前の値を取得
      const currentShortMA = shortMAAligned[shortMAAligned.length - 1];
      const currentLongMA = longMA[longMA.length - 1];
      const prevShortMA = shortMAAligned[shortMAAligned.length - 2];
      const prevLongMA = longMA[longMA.length - 2];

      // クロスオーバーを検出
      const isBuySignal =
        prevShortMA < prevLongMA && currentShortMA > currentLongMA;
      const isSellSignal =
        prevShortMA > prevLongMA && currentShortMA < currentLongMA;

      // シグナル生成
      let signal = "NEUTRAL";
      let reason = "";

      if (isBuySignal) {
        signal = "BUY";
        reason = `短期MA(${currentShortMA.toFixed(
          2
        )})が長期MA(${currentLongMA.toFixed(2)})を下から上に抜けました`;
        logger.info(`BUYシグナル: ${reason}`);
      } else if (isSellSignal) {
        signal = "SELL";
        reason = `短期MA(${currentShortMA.toFixed(
          2
        )})が長期MA(${currentLongMA.toFixed(2)})を上から下に抜けました`;
        logger.info(`SELLシグナル: ${reason}`);
      } else {
        reason = `クロスなし。短期MA: ${currentShortMA.toFixed(
          2
        )}, 長期MA: ${currentLongMA.toFixed(2)}`;
        logger.debug(`中立シグナル: ${reason}`);
      }

      // 分析データを追加
      const analysis = {
        shortMA: currentShortMA,
        longMA: currentLongMA,
        lastPrice: closes[closes.length - 1],
        trend: currentShortMA > currentLongMA ? "上昇" : "下降",
      };

      return { signal, reason, analysis };
    } catch (error) {
      logger.error(`移動平均線計算エラー: ${error.message}`);
      return { signal: "ERROR", reason: `戦略実行エラー: ${error.message}` };
    }
  }

  /**
   * バックテスト用のエントリー・エグジットポイントを生成
   * @param {Array} candles - ローソク足データ
   * @returns {Array} - エントリー・エグジットポイントの配列
   */
  generateBacktestSignals(candles) {
    if (!candles || candles.length < this.longPeriod + 5) {
      return [];
    }

    const signals = [];
    const closes = candles.map((candle) => candle.close);

    // 移動平均線を計算
    const shortMA = technicalIndicators.SMA.calculate({
      period: this.shortPeriod,
      values: closes,
    });

    const longMA = technicalIndicators.SMA.calculate({
      period: this.longPeriod,
      values: closes,
    });

    // 移動平均線の長さを合わせる
    const startIdx = this.longPeriod - 1;

    // すべてのデータを走査
    for (let i = 1; i < longMA.length; i++) {
      const currentShortMA = shortMA[i + (shortMA.length - longMA.length)];
      const currentLongMA = longMA[i];
      const prevShortMA = shortMA[i - 1 + (shortMA.length - longMA.length)];
      const prevLongMA = longMA[i - 1];

      // インデックスを調整
      const candleIdx = i + startIdx;

      // BUYシグナル
      if (prevShortMA < prevLongMA && currentShortMA > currentLongMA) {
        signals.push({
          type: "BUY",
          price: candles[candleIdx].close,
          time: candles[candleIdx].time,
          candleIndex: candleIdx,
        });
      }
      // SELLシグナル
      else if (prevShortMA > prevLongMA && currentShortMA < currentLongMA) {
        signals.push({
          type: "SELL",
          price: candles[candleIdx].close,
          time: candles[candleIdx].time,
          candleIndex: candleIdx,
        });
      }
    }

    return signals;
  }

  /**
   * 戦略のパラメータを取得
   * @returns {Object} - パラメータ
   */
  getParams() {
    return {
      shortPeriod: this.shortPeriod,
      longPeriod: this.longPeriod,
    };
  }

  /**
   * 戦略の情報を取得
   * @returns {Object} - 戦略情報
   */
  getInfo() {
    return {
      name: this.name,
      description: this.description,
      params: this.getParams(),
    };
  }
}

module.exports = MovingAverageCrossover;
