const logger = require("../utils/logger");
const technicalIndicators = require("../utils/technicalIndicators");

/**
 * 移動平均線クロスオーバー戦略
 * 短期移動平均線と長期移動平均線のクロスオーバーでシグナルを生成
 */
class MovingAverageCrossover {
  /**
   * コンストラクタ
   * @param {Object} params - 戦略パラメータ
   */
  constructor(params = {}) {
    // 移動平均線のパラメータ
    this.shortPeriod = params.shortPeriod || 9;
    this.longPeriod = params.longPeriod || 21;

    // 追加のテクニカル指標パラメータ
    this.useRsi = params.useRsi !== undefined ? params.useRsi : true;
    this.rsiPeriod = params.rsiPeriod || 14;
    this.rsiOverbought = params.rsiOverbought || 70;
    this.rsiOversold = params.rsiOversold || 30;

    this.useVolume = params.useVolume !== undefined ? params.useVolume : true;
    this.volumeThreshold = params.volumeThreshold || 1.5; // 平均ボリュームの何倍を閾値とするか
    this.volumeAvgPeriod = params.volumeAvgPeriod || 20;

    this.useTrend = params.useTrend !== undefined ? params.useTrend : true;
    this.trendMaPeriod = params.trendMaPeriod || 50;

    // フィルター強度設定
    this.filterStrength = params.filterStrength || "medium"; // 'weak', 'medium', 'strong'

    // 追加パラメータのバリデーション
    this.validateParams();
  }

  /**
   * パラメータのバリデーション
   */
  validateParams() {
    // 移動平均線パラメータのバリデーション
    if (this.shortPeriod <= 0 || this.longPeriod <= 0) {
      throw new Error("移動平均線の期間は正の数である必要があります");
    }

    if (this.shortPeriod >= this.longPeriod) {
      throw new Error(
        "短期移動平均線の期間は長期移動平均線の期間よりも短い必要があります"
      );
    }

    // RSIパラメータのバリデーション
    if (this.useRsi) {
      if (this.rsiPeriod <= 0) {
        throw new Error("RSI期間は正の数である必要があります");
      }
      if (this.rsiOverbought <= this.rsiOversold) {
        throw new Error(
          "RSIの買われすぎレベルは売られすぎレベルよりも高い必要があります"
        );
      }
    }

    // ボリュームパラメータのバリデーション
    if (this.useVolume) {
      if (this.volumeThreshold <= 0) {
        throw new Error("ボリューム閾値は正の数である必要があります");
      }
      if (this.volumeAvgPeriod <= 0) {
        throw new Error("ボリューム平均期間は正の数である必要があります");
      }
    }

    // トレンドパラメータのバリデーション
    if (this.useTrend) {
      if (this.trendMaPeriod <= 0) {
        throw new Error("トレンドMA期間は正の数である必要があります");
      }
      if (this.trendMaPeriod <= this.longPeriod) {
        throw new Error(
          "トレンドMA期間は長期移動平均線の期間よりも長い必要があります"
        );
      }
    }
  }

  /**
   * バックテスト用のシグナルを生成
   * @param {Array} candles - ローソク足データ
   * @returns {Array} - シグナルの配列
   */
  generateBacktestSignals(candles) {
    if (!candles || candles.length === 0) {
      return [];
    }

    try {
      // 指標の計算に必要な価格データを準備
      const closes = candles.map((candle) => candle.close);
      const highs = candles.map((candle) => candle.high);
      const lows = candles.map((candle) => candle.low);
      const volumes = candles.map((candle) => candle.volume);

      // 移動平均線の計算
      const shortMa = technicalIndicators.sma(closes, this.shortPeriod);
      const longMa = technicalIndicators.sma(closes, this.longPeriod);

      // 追加指標の計算
      let rsiValues = [];
      if (this.useRsi) {
        rsiValues = technicalIndicators.rsi(closes, this.rsiPeriod);
      }

      let volumeAvg = [];
      if (this.useVolume) {
        volumeAvg = technicalIndicators.sma(volumes, this.volumeAvgPeriod);
      }

      let trendMa = [];
      if (this.useTrend) {
        trendMa = technicalIndicators.sma(closes, this.trendMaPeriod);
      }

      // シグナル生成
      const signals = [];

      // 最も長い期間を特定
      const maxPeriod = Math.max(
        this.longPeriod,
        this.useRsi ? this.rsiPeriod : 0,
        this.useVolume ? this.volumeAvgPeriod : 0,
        this.useTrend ? this.trendMaPeriod : 0
      );

      // 各ローソク足をチェック
      for (let i = maxPeriod; i < candles.length; i++) {
        // 移動平均クロスの確認
        const shortPrev = shortMa[i - 1];
        const longPrev = longMa[i - 1];
        const shortCurrent = shortMa[i];
        const longCurrent = longMa[i];

        // クロスの検出
        const isBullishCross =
          shortPrev <= longPrev && shortCurrent > longCurrent;
        const isBearishCross =
          shortPrev >= longPrev && shortCurrent < longCurrent;

        // 追加フィルターの適用
        if (isBullishCross || isBearishCross) {
          const signalType = isBullishCross ? "BUY" : "SELL";

          // フィルター結果
          const passedFilter = this.applyFilters(
            signalType,
            i,
            closes,
            rsiValues,
            volumes,
            volumeAvg,
            trendMa
          );

          if (passedFilter) {
            signals.push({
              type: signalType,
              price: candles[i].close,
              time: candles[i].time,
              candleIndex: i,
            });
          }
        }
      }

      return signals;
    } catch (error) {
      logger.error(`移動平均クロスオーバー戦略エラー: ${error.message}`);
      return [];
    }
  }

  /**
   * 追加フィルターを適用
   * @param {string} signalType - シグナルタイプ（BUY/SELL）
   * @param {number} index - 現在のインデックス
   * @param {Array} closes - 終値配列
   * @param {Array} rsiValues - RSI値配列
   * @param {Array} volumes - ボリューム配列
   * @param {Array} volumeAvg - 平均ボリューム配列
   * @param {Array} trendMa - トレンドMA配列
   * @returns {boolean} - フィルターに通過したかどうか
   */
  applyFilters(
    signalType,
    index,
    closes,
    rsiValues,
    volumes,
    volumeAvg,
    trendMa
  ) {
    // フィルター強度に基づいて適用するフィルター数を決定
    let requiredPassCount = 0;
    let totalFilters = 0;

    // フィルターの合計数を計算
    if (this.useRsi) totalFilters++;
    if (this.useVolume) totalFilters++;
    if (this.useTrend) totalFilters++;

    // 必要な通過フィルター数を設定
    switch (this.filterStrength) {
      case "weak":
        requiredPassCount = 1; // いずれか1つのフィルターに通過すれば良い
        break;
      case "medium":
        requiredPassCount = Math.ceil(totalFilters / 2); // 半分以上のフィルターに通過
        break;
      case "strong":
        requiredPassCount = totalFilters; // すべてのフィルターに通過
        break;
      default:
        requiredPassCount = Math.ceil(totalFilters / 2); // デフォルトはmedium
    }

    // フィルター通過数
    let passedCount = 0;

    // RSIフィルター
    if (this.useRsi) {
      const rsi = rsiValues[index];
      // 買いシグナルの場合は売られすぎ、売りシグナルの場合は買われすぎの状態を確認
      if (
        (signalType === "BUY" && rsi <= this.rsiOversold) ||
        (signalType === "SELL" && rsi >= this.rsiOverbought)
      ) {
        passedCount++;
      }
    }

    // ボリュームフィルター
    if (this.useVolume) {
      const volume = volumes[index];
      const avgVolume = volumeAvg[index];
      // ボリュームが平均より大きいか確認
      if (volume >= avgVolume * this.volumeThreshold) {
        passedCount++;
      }
    }

    // トレンドフィルター
    if (this.useTrend) {
      const price = closes[index];
      const trend = trendMa[index];
      // トレンドの方向と一致するか確認
      if (
        (signalType === "BUY" && price > trend) ||
        (signalType === "SELL" && price < trend)
      ) {
        passedCount++;
      }
    }

    // 必要な通過数を満たしているか確認
    return passedCount >= requiredPassCount;
  }
}

module.exports = MovingAverageCrossover;
