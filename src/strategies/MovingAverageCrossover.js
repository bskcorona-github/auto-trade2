const logger = require("../utils/logger");
const technicalIndicators = require("../utils/technicalIndicators");

/**
 * 拡張版移動平均線クロスオーバー戦略
 * 短期移動平均線と長期移動平均線のクロスオーバーでシグナルを生成
 * MACD、ボリンジャーバンド、RSIなどの複数指標を組み合わせることができます
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

    // RSIパラメータ
    this.useRsi = params.useRsi !== undefined ? params.useRsi : true;
    this.rsiPeriod = params.rsiPeriod || 14;
    this.rsiOverbought = params.rsiOverbought || 70;
    this.rsiOversold = params.rsiOversold || 30;

    // ボリュームパラメータ
    this.useVolume = params.useVolume !== undefined ? params.useVolume : true;
    this.volumeThreshold = params.volumeThreshold || 1.5; // 平均ボリュームの何倍を閾値とするか
    this.volumeAvgPeriod = params.volumeAvgPeriod || 20;

    // トレンドパラメータ
    this.useTrend = params.useTrend !== undefined ? params.useTrend : true;
    this.trendMaPeriod = params.trendMaPeriod || 50;

    // MACDパラメータ
    this.useMacd = params.useMacd !== undefined ? params.useMacd : false;
    this.macdFastPeriod = params.macdFastPeriod || 12;
    this.macdSlowPeriod = params.macdSlowPeriod || 26;
    this.macdSignalPeriod = params.macdSignalPeriod || 9;

    // ボリンジャーバンドパラメータ
    this.useBollingerBands =
      params.useBollingerBands !== undefined ? params.useBollingerBands : false;
    this.bollingerPeriod = params.bollingerPeriod || 20;
    this.bollingerStdDev = params.bollingerStdDev || 2;

    // プライスアクションパラメータ
    this.usePriceAction =
      params.usePriceAction !== undefined ? params.usePriceAction : false;
    this.candlePatternStrength = params.candlePatternStrength || 1.5; // ローソク足パターンの強度係数

    // 追加シグナル生成オプション
    this.generateAdditionalSignals =
      params.generateAdditionalSignals !== undefined
        ? params.generateAdditionalSignals
        : false;

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

    // MACDパラメータのバリデーション
    if (this.useMacd) {
      if (
        this.macdFastPeriod <= 0 ||
        this.macdSlowPeriod <= 0 ||
        this.macdSignalPeriod <= 0
      ) {
        throw new Error("MACD期間は正の数である必要があります");
      }
      if (this.macdFastPeriod >= this.macdSlowPeriod) {
        throw new Error("MACDの短期期間は長期期間よりも短い必要があります");
      }
    }

    // ボリンジャーバンドのバリデーション
    if (this.useBollingerBands) {
      if (this.bollingerPeriod <= 0) {
        throw new Error("ボリンジャーバンド期間は正の数である必要があります");
      }
      if (this.bollingerStdDev <= 0) {
        throw new Error(
          "ボリンジャーバンド標準偏差は正の数である必要があります"
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

      // MACD計算
      let macdData = { macd: [], signal: [], histogram: [] };
      if (this.useMacd) {
        macdData = technicalIndicators.macd(
          closes,
          this.macdFastPeriod,
          this.macdSlowPeriod,
          this.macdSignalPeriod
        );
      }

      // ボリンジャーバンド計算
      let bbands = { upper: [], middle: [], lower: [] };
      if (this.useBollingerBands) {
        bbands = technicalIndicators.bollingerBands(
          closes,
          this.bollingerPeriod,
          this.bollingerStdDev
        );
      }

      // シグナル生成
      const signals = [];

      // 最も長い期間を特定
      const maxPeriod = Math.max(
        this.longPeriod,
        this.useRsi ? this.rsiPeriod : 0,
        this.useVolume ? this.volumeAvgPeriod : 0,
        this.useTrend ? this.trendMaPeriod : 0,
        this.useMacd ? Math.max(this.macdSlowPeriod, this.macdSignalPeriod) : 0,
        this.useBollingerBands ? this.bollingerPeriod : 0
      );

      // 各ローソク足をチェック
      for (let i = maxPeriod; i < candles.length; i++) {
        // 基本シグナル: 移動平均クロスの確認
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
            trendMa,
            macdData,
            bbands,
            candles
          );

          if (passedFilter) {
            signals.push({
              type: signalType,
              price: candles[i].close,
              time: candles[i].time,
              candleIndex: i,
              source: "MA_CROSS",
            });
          }
        }

        // 追加シグナル生成（オプション）
        if (this.generateAdditionalSignals) {
          const additionalSignals = this.generateAlternativeSignals(
            i,
            closes,
            rsiValues,
            macdData,
            bbands,
            candles
          );

          if (additionalSignals.length > 0) {
            additionalSignals.forEach((signal) => {
              signals.push({
                ...signal,
                time: candles[i].time,
                candleIndex: i,
              });
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
   * 代替シグナルを生成（移動平均クロスオーバー以外のシグナル）
   * @param {number} index - 現在のインデックス
   * @param {Array} closes - 終値配列
   * @param {Array} rsiValues - RSI値配列
   * @param {Object} macdData - MACDデータ
   * @param {Object} bbands - ボリンジャーバンドデータ
   * @param {Array} candles - ローソク足データ
   * @returns {Array} - 追加シグナルの配列
   */
  generateAlternativeSignals(
    index,
    closes,
    rsiValues,
    macdData,
    bbands,
    candles
  ) {
    const additionalSignals = [];
    const currentPrice = closes[index];

    // RSIシグナル
    if (this.useRsi && rsiValues[index] !== undefined) {
      const rsi = rsiValues[index];

      // 極端な値でのRSIシグナル
      if (rsi <= this.rsiOversold - 10) {
        // 極端な売られすぎ
        additionalSignals.push({
          type: "BUY",
          price: currentPrice,
          source: "RSI_EXTREME_OVERSOLD",
        });
      } else if (rsi >= this.rsiOverbought + 10) {
        // 極端な買われすぎ
        additionalSignals.push({
          type: "SELL",
          price: currentPrice,
          source: "RSI_EXTREME_OVERBOUGHT",
        });
      }
    }

    // MACDシグナル
    if (
      this.useMacd &&
      index > 1 &&
      macdData.macd[index] !== undefined &&
      macdData.signal[index] !== undefined
    ) {
      // MACDクロスオーバー
      const macdCurrent = macdData.macd[index];
      const signalCurrent = macdData.signal[index];
      const macdPrev = macdData.macd[index - 1];
      const signalPrev = macdData.signal[index - 1];

      // MACDがシグナルラインを上に交差（買いシグナル）
      if (macdPrev < signalPrev && macdCurrent > signalCurrent) {
        additionalSignals.push({
          type: "BUY",
          price: currentPrice,
          source: "MACD_BULLISH_CROSS",
        });
      }
      // MACDがシグナルラインを下に交差（売りシグナル）
      else if (macdPrev > signalPrev && macdCurrent < signalCurrent) {
        additionalSignals.push({
          type: "SELL",
          price: currentPrice,
          source: "MACD_BEARISH_CROSS",
        });
      }
    }

    // ボリンジャーバンドシグナル
    if (
      this.useBollingerBands &&
      bbands.upper[index] !== undefined &&
      bbands.lower[index] !== undefined
    ) {
      const upperBand = bbands.upper[index];
      const lowerBand = bbands.lower[index];

      // 価格がバンドを突き抜けた時の反転シグナル
      if (currentPrice < lowerBand * 0.99) {
        // 下バンド突破（買いシグナル）
        additionalSignals.push({
          type: "BUY",
          price: currentPrice,
          source: "BB_LOWER_BREAK",
        });
      } else if (currentPrice > upperBand * 1.01) {
        // 上バンド突破（売りシグナル）
        additionalSignals.push({
          type: "SELL",
          price: currentPrice,
          source: "BB_UPPER_BREAK",
        });
      }
    }

    return additionalSignals;
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
   * @param {Object} macdData - MACDデータ
   * @param {Object} bbands - ボリンジャーバンドデータ
   * @param {Array} candles - ローソク足データ
   * @returns {boolean} - フィルターに通過したかどうか
   */
  applyFilters(
    signalType,
    index,
    closes,
    rsiValues,
    volumes,
    volumeAvg,
    trendMa,
    macdData,
    bbands,
    candles
  ) {
    // フィルター強度に基づいて適用するフィルター数を決定
    let requiredPassCount = 0;
    let totalFilters = 0;

    // フィルターの合計数を計算
    if (this.useRsi) totalFilters++;
    if (this.useVolume) totalFilters++;
    if (this.useTrend) totalFilters++;
    if (this.useMacd) totalFilters++;
    if (this.useBollingerBands) totalFilters++;
    if (this.usePriceAction) totalFilters++;

    // 必要な通過フィルター数を設定
    switch (this.filterStrength) {
      case "weak":
        // フィルターが1つ以上ある場合は少なくとも1つ、なければ通過
        requiredPassCount = totalFilters > 0 ? 1 : 0;
        break;
      case "medium":
        // 半分以上のフィルターに通過
        requiredPassCount = Math.max(1, Math.ceil(totalFilters / 2));
        break;
      case "strong":
        // すべてのフィルターに通過
        requiredPassCount = totalFilters;
        break;
      default:
        requiredPassCount = Math.ceil(totalFilters / 2); // デフォルトはmedium
    }

    // フィルター通過数
    let passedCount = 0;

    // RSIフィルター
    if (this.useRsi && rsiValues[index] !== undefined) {
      const rsi = rsiValues[index];
      // フィルター強度に応じてRSIの条件を緩和
      const oversoldThreshold =
        this.filterStrength === "weak"
          ? this.rsiOversold + 10
          : this.rsiOversold;
      const overboughtThreshold =
        this.filterStrength === "weak"
          ? this.rsiOverbought - 10
          : this.rsiOverbought;

      // 買いシグナルの場合は売られすぎ、売りシグナルの場合は買われすぎの状態を確認
      if (
        (signalType === "BUY" && rsi <= oversoldThreshold) ||
        (signalType === "SELL" && rsi >= overboughtThreshold)
      ) {
        passedCount++;
      }
    }

    // ボリュームフィルター
    if (
      this.useVolume &&
      volumes[index] !== undefined &&
      volumeAvg[index] !== undefined
    ) {
      const volume = volumes[index];
      const avgVolume = volumeAvg[index];

      // フィルター強度に応じてボリューム条件を調整
      const volumeMultiplier =
        this.filterStrength === "weak"
          ? this.volumeThreshold * 0.7
          : this.volumeThreshold;

      // ボリュームが平均より大きいか確認
      if (volume >= avgVolume * volumeMultiplier) {
        passedCount++;
      }
    }

    // トレンドフィルター
    if (this.useTrend && trendMa[index] !== undefined) {
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

    // MACDフィルター
    if (
      this.useMacd &&
      macdData.macd[index] !== undefined &&
      macdData.signal[index] !== undefined &&
      macdData.histogram[index] !== undefined
    ) {
      const macd = macdData.macd[index];
      const signal = macdData.signal[index];
      const histogram = macdData.histogram[index];

      // 買いシグナルの場合はMACDが上昇、売りシグナルの場合はMACDが下降
      if (
        (signalType === "BUY" && macd > signal && histogram > 0) ||
        (signalType === "SELL" && macd < signal && histogram < 0)
      ) {
        passedCount++;
      }
    }

    // ボリンジャーバンドフィルター
    if (
      this.useBollingerBands &&
      bbands.upper[index] !== undefined &&
      bbands.middle[index] !== undefined &&
      bbands.lower[index] !== undefined
    ) {
      const price = closes[index];
      const middle = bbands.middle[index];
      const upper = bbands.upper[index];
      const lower = bbands.lower[index];

      // 買いシグナルの場合は価格が下バンドに近い、売りシグナルの場合は上バンドに近い
      if (
        (signalType === "BUY" && price < middle && price > lower) ||
        (signalType === "SELL" && price > middle && price < upper)
      ) {
        passedCount++;
      }
    }

    // プライスアクションフィルター
    if (this.usePriceAction && index > 0) {
      const currentCandle = candles[index];
      const prevCandle = candles[index - 1];

      // ローソク足パターンの検出
      if (signalType === "BUY") {
        // 陽線（始値 < 終値）
        if (currentCandle.open < currentCandle.close) {
          // 長い陽線（実体が平均実体よりも大きい）
          const bodySize = currentCandle.close - currentCandle.open;
          if (bodySize > (currentCandle.high - currentCandle.low) * 0.6) {
            passedCount++;
          }
        }
      } else if (signalType === "SELL") {
        // 陰線（始値 > 終値）
        if (currentCandle.open > currentCandle.close) {
          // 長い陰線
          const bodySize = currentCandle.open - currentCandle.close;
          if (bodySize > (currentCandle.high - currentCandle.low) * 0.6) {
            passedCount++;
          }
        }
      }
    }

    // 必要な通過数を満たしているか確認
    return passedCount >= requiredPassCount;
  }
}

module.exports = MovingAverageCrossover;
