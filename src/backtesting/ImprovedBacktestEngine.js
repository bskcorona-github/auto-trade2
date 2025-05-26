const logger = require("../utils/logger");
const config = require("../config/config");
const BacktestEngine = require("./BacktestEngine");
const technicalIndicators = require("../utils/technicalIndicators");

/**
 * 拡張バックテストエンジン
 * 標準のBacktestEngineの機能に加えて、以下の機能を提供:
 * - マルチタイムフレーム分析
 * - モンテカルロシミュレーション
 * - 市場状況に応じた動的パラメータ調整
 * - 詳細なパフォーマンス指標
 */
class ImprovedBacktestEngine extends BacktestEngine {
  constructor(options = {}) {
    super(options);

    // マルチタイムフレーム設定
    this.useMultiTimeframe = options.useMultiTimeframe || false;
    this.timeframes = options.timeframes || ["1h", "4h", "1d"];
    this.timeframeWeights = options.timeframeWeights || {
      "1h": 0.3,
      "4h": 0.3,
      "1d": 0.4,
    };

    // モンテカルロシミュレーション設定
    this.monteCarloSimulations = options.monteCarloSimulations || 1000;
    this.confidenceInterval = options.confidenceInterval || 0.95;

    // 動的パラメータ調整設定
    this.useDynamicParameters = options.useDynamicParameters || false;
    this.volatilityLookback = options.volatilityLookback || 20;
    this.marketRegimeDetection = options.marketRegimeDetection || false;

    // パフォーマンス分析
    this.detailedMetrics = options.detailedMetrics || true;
    this.benchmarkSymbol = options.benchmarkSymbol || "BTC/USDT";

    // トレード分析
    this.tradeStatistics = [];
    this.monthlyPerformance = {};
    this.drawdownPeriods = [];
    this.volatilityAdjustedReturns = [];
  }

  /**
   * 拡張バックテストを実行
   * @param {Array} candles - ローソク足データ
   * @param {Object} strategy - 戦略インスタンス
   * @param {Object} additionalOptions - 追加オプション
   * @returns {Object} - バックテスト結果
   */
  run(candles, strategy, additionalOptions = {}) {
    if (!candles || candles.length === 0) {
      logger.error("拡張バックテストエラー: データがありません");
      return { success: false, error: "データがありません" };
    }

    try {
      logger.info("拡張バックテスト開始...");

      // 市場レジーム（トレンド/レンジ）の検出
      if (this.marketRegimeDetection) {
        this.detectMarketRegimes(candles);
      }

      // 動的パラメータ調整
      if (this.useDynamicParameters) {
        this.adjustParametersBasedOnVolatility(candles, strategy);
      }

      // 通常のバックテスト実行
      const baseResult = super.run(candles, strategy);

      if (!baseResult.success) {
        return baseResult;
      }

      // 詳細なメトリクスを計算
      if (this.detailedMetrics) {
        this.calculateDetailedMetrics(baseResult, candles);
      }

      // モンテカルロシミュレーション実行
      let monteCarloResults = null;
      if (additionalOptions.runMonteCarloSimulation) {
        monteCarloResults = this.runMonteCarloSimulation(baseResult.trades);
      }

      return {
        ...baseResult,
        detailedMetrics: this.detailedMetrics
          ? this.getDetailedMetrics()
          : null,
        monteCarloResults,
      };
    } catch (error) {
      logger.error(`拡張バックテストエラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 市場レジーム（トレンド/レンジ）を検出
   * @param {Array} candles - ローソク足データ
   */
  detectMarketRegimes(candles) {
    logger.debug("市場レジーム検出中...");

    const closes = candles.map((candle) => candle.close);
    const marketRegimes = [];

    // ADXを使用してトレンド強度を測定
    const adxPeriod = 14;
    const adxValues = technicalIndicators.adx(
      candles.map((c) => c.high),
      candles.map((c) => c.low),
      closes,
      adxPeriod
    );

    // ボラティリティ測定のためのATR
    const atrPeriod = 14;
    const atrValues = this.calculateAtr(candles, atrPeriod);

    // 各ローソク足に市場レジームを割り当て
    for (let i = adxPeriod; i < candles.length; i++) {
      const adx = adxValues[i];
      const atr = atrValues[i];
      const avgAtr =
        atrValues.slice(i - 10, i).reduce((sum, val) => sum + val, 0) / 10;
      const normalizedAtr = atr / avgAtr;

      let regime;
      if (adx > 25) {
        // 強いトレンド
        regime = "STRONG_TREND";
      } else if (adx > 20) {
        // 弱いトレンド
        regime = "WEAK_TREND";
      } else {
        // レンジ相場
        regime = "RANGE";
      }

      marketRegimes.push({
        time: candles[i].time,
        regime,
        adx,
        normalizedVolatility: normalizedAtr,
      });
    }

    this.marketRegimes = marketRegimes;
    logger.debug(`市場レジーム検出完了: ${marketRegimes.length}ポイント分析`);
  }

  /**
   * ボラティリティに基づいて戦略パラメータを動的に調整
   * @param {Array} candles - ローソク足データ
   * @param {Object} strategy - 戦略インスタンス
   */
  adjustParametersBasedOnVolatility(candles, strategy) {
    if (!candles || candles.length < this.volatilityLookback) {
      return;
    }

    logger.debug("ボラティリティに基づくパラメータ調整中...");

    // 直近のボラティリティを計算
    const recentCandles = candles.slice(-this.volatilityLookback);
    const closes = recentCandles.map((candle) => candle.close);

    // 標準偏差をボラティリティの指標として使用
    const mean = closes.reduce((sum, close) => sum + close, 0) / closes.length;
    const variance =
      closes.reduce((sum, close) => sum + Math.pow(close - mean, 2), 0) /
      closes.length;
    const volatility = Math.sqrt(variance) / mean; // 変動係数

    // ボラティリティに基づいてパラメータを調整
    if (volatility > 0.05) {
      // 高ボラティリティ
      this.stopLossPercent = this.stopLossPercent * 1.5;
      this.takeProfitPercent = this.takeProfitPercent * 1.2;
      this.positionSizePercent = this.positionSizePercent * 0.7;

      // 戦略パラメータの調整（MovingAverageCrossoverの場合）
      if (strategy.constructor.name === "MovingAverageCrossover") {
        strategy.filterStrength = "strong";
      }
    } else if (volatility < 0.02) {
      // 低ボラティリティ
      this.stopLossPercent = this.stopLossPercent * 0.8;
      this.takeProfitPercent = this.takeProfitPercent * 0.9;
      this.positionSizePercent = this.positionSizePercent * 1.2;

      // 戦略パラメータの調整
      if (strategy.constructor.name === "MovingAverageCrossover") {
        strategy.filterStrength = "weak";
      }
    }

    logger.debug(`パラメータ調整完了: ボラティリティ=${volatility.toFixed(4)}`);
  }

  /**
   * モンテカルロシミュレーションを実行
   * @param {Array} trades - 実際のトレード履歴
   * @returns {Object} - シミュレーション結果
   */
  runMonteCarloSimulation(trades) {
    logger.info(
      `モンテカルロシミュレーション開始: ${this.monteCarloSimulations}回`
    );

    if (!trades || trades.length === 0) {
      return {
        success: false,
        error: "シミュレーション用のトレードがありません",
      };
    }

    // 各トレードの収益率を計算
    const returns = trades.map((trade) => trade.profitPercentage / 100);

    // シミュレーション結果
    const simulationResults = [];
    const finalEquities = [];

    // モンテカルロシミュレーションを実行
    for (let i = 0; i < this.monteCarloSimulations; i++) {
      const shuffledReturns = this.shuffleArray([...returns]);
      let equity = this.initialBalance;
      const equityCurve = [equity];

      // トレードをシミュレート
      for (const returnRate of shuffledReturns) {
        equity = equity * (1 + returnRate);
        equityCurve.push(equity);
      }

      simulationResults.push(equityCurve);
      finalEquities.push(equity);
    }

    // 結果を信頼区間でソート
    finalEquities.sort((a, b) => a - b);

    // 信頼区間を計算
    const lowerIndex = Math.floor(
      ((1 - this.confidenceInterval) / 2) * this.monteCarloSimulations
    );
    const upperIndex = Math.floor(
      ((1 + this.confidenceInterval) / 2) * this.monteCarloSimulations
    );

    const worstCase = finalEquities[0];
    const bestCase = finalEquities[finalEquities.length - 1];
    const medianCase = finalEquities[Math.floor(finalEquities.length / 2)];
    const lowerBound = finalEquities[lowerIndex];
    const upperBound = finalEquities[upperIndex];

    logger.info(
      `モンテカルロシミュレーション完了: 中央値=${medianCase.toFixed(2)}`
    );

    return {
      success: true,
      worstCase,
      bestCase,
      medianCase,
      confidenceInterval: {
        lower: lowerBound,
        upper: upperBound,
        percentage: this.confidenceInterval * 100,
      },
      simulationResults: simulationResults.slice(0, 10), // 最初の10シミュレーションのみ返す
    };
  }

  /**
   * 詳細なメトリクスを計算
   * @param {Object} baseResult - 基本バックテスト結果
   * @param {Array} candles - ローソク足データ
   */
  calculateDetailedMetrics(baseResult, candles) {
    logger.debug("詳細なパフォーマンス指標を計算中...");

    const { trades, equity } = baseResult;

    // 月次パフォーマンス
    this.calculateMonthlyPerformance(equity);

    // ドローダウン期間の分析
    this.analyzeDrawdownPeriods(equity);

    // トレード統計
    this.analyzeTradeStatistics(trades);

    // ボラティリティ調整済みリターン
    this.calculateVolatilityAdjustedReturns(equity);

    logger.debug("詳細指標計算完了");
  }

  /**
   * 月次パフォーマンスを計算
   * @param {Array} equity - 資産推移データ
   */
  calculateMonthlyPerformance(equity) {
    const monthlyPerformance = {};

    if (!equity || equity.length === 0) return;

    // 各月のパフォーマンスを計算
    for (let i = 1; i < equity.length; i++) {
      const current = equity[i];
      const previous = equity[i - 1];

      const date = new Date(current.time);
      const yearMonth = `${date.getFullYear()}-${String(
        date.getMonth() + 1
      ).padStart(2, "0")}`;

      if (!monthlyPerformance[yearMonth]) {
        monthlyPerformance[yearMonth] = {
          startEquity: previous.equity,
          endEquity: current.equity,
          return: 0,
        };
      } else {
        monthlyPerformance[yearMonth].endEquity = current.equity;
      }
    }

    // 月次リターンを計算
    for (const month in monthlyPerformance) {
      const data = monthlyPerformance[month];
      data.return =
        ((data.endEquity - data.startEquity) / data.startEquity) * 100;
    }

    this.monthlyPerformance = monthlyPerformance;
  }

  /**
   * ドローダウン期間を分析
   * @param {Array} equity - 資産推移データ
   */
  analyzeDrawdownPeriods(equity) {
    const drawdownPeriods = [];

    if (!equity || equity.length === 0) return;

    let inDrawdown = false;
    let drawdownStart = null;
    let peakValue = equity[0].equity;
    let currentDrawdown = {
      start: null,
      end: null,
      maxDrawdown: 0,
      duration: 0,
      recovery: false,
    };

    // ドローダウン期間を特定
    for (let i = 1; i < equity.length; i++) {
      const current = equity[i].equity;

      if (current > peakValue) {
        // 新しいピーク
        peakValue = current;

        // ドローダウンからの回復
        if (inDrawdown) {
          inDrawdown = false;
          currentDrawdown.end = equity[i].time;
          currentDrawdown.duration =
            (new Date(currentDrawdown.end) - new Date(currentDrawdown.start)) /
            (1000 * 60 * 60 * 24);
          currentDrawdown.recovery = true;

          drawdownPeriods.push({ ...currentDrawdown });
          currentDrawdown = {
            start: null,
            end: null,
            maxDrawdown: 0,
            duration: 0,
            recovery: false,
          };
        }
      } else if (current < peakValue) {
        // ドローダウン計算
        const drawdown = ((peakValue - current) / peakValue) * 100;

        if (!inDrawdown) {
          // ドローダウン開始
          inDrawdown = true;
          currentDrawdown.start = equity[i].time;
          currentDrawdown.maxDrawdown = drawdown;
        } else if (drawdown > currentDrawdown.maxDrawdown) {
          // ドローダウン拡大
          currentDrawdown.maxDrawdown = drawdown;
        }
      }
    }

    // 最後のドローダウンが終了していない場合
    if (inDrawdown) {
      currentDrawdown.end = equity[equity.length - 1].time;
      currentDrawdown.duration =
        (new Date(currentDrawdown.end) - new Date(currentDrawdown.start)) /
        (1000 * 60 * 60 * 24);
      currentDrawdown.recovery = false;
      drawdownPeriods.push({ ...currentDrawdown });
    }

    this.drawdownPeriods = drawdownPeriods;
  }

  /**
   * トレード統計を分析
   * @param {Array} trades - トレード履歴
   */
  analyzeTradeStatistics(trades) {
    if (!trades || trades.length === 0) return;

    // 時間帯別の成績
    const hourlyPerformance = Array(24)
      .fill(0)
      .map(() => ({ count: 0, wins: 0, profit: 0 }));

    // 曜日別の成績
    const dailyPerformance = Array(7)
      .fill(0)
      .map(() => ({ count: 0, wins: 0, profit: 0 }));

    // 連続勝敗
    let currentStreak = 0;
    let maxWinStreak = 0;
    let maxLossStreak = 0;

    // 統計を計算
    for (const trade of trades) {
      // 時間帯別統計
      const entryDate = new Date(trade.entryTime);
      const hour = entryDate.getHours();
      const day = entryDate.getDay();

      hourlyPerformance[hour].count++;
      dailyPerformance[day].count++;

      if (trade.profit > 0) {
        hourlyPerformance[hour].wins++;
        dailyPerformance[day].wins++;
        hourlyPerformance[hour].profit += trade.profit;
        dailyPerformance[day].profit += trade.profit;

        // 勝ちストリーク
        if (currentStreak >= 0) {
          currentStreak++;
        } else {
          currentStreak = 1;
        }

        maxWinStreak = Math.max(maxWinStreak, currentStreak);
      } else {
        // 負けストリーク
        if (currentStreak <= 0) {
          currentStreak--;
        } else {
          currentStreak = -1;
        }

        maxLossStreak = Math.max(maxLossStreak, -currentStreak);
      }
    }

    this.tradeStatistics = {
      hourlyPerformance,
      dailyPerformance,
      maxWinStreak,
      maxLossStreak,
    };
  }

  /**
   * ボラティリティ調整済みリターンを計算
   * @param {Array} equity - 資産推移データ
   */
  calculateVolatilityAdjustedReturns(equity) {
    if (!equity || equity.length < 2) return;

    const returns = [];

    // 日次リターンを計算
    for (let i = 1; i < equity.length; i++) {
      const current = equity[i].equity;
      const previous = equity[i - 1].equity;

      const dailyReturn = (current - previous) / previous;
      returns.push(dailyReturn);
    }

    // 平均リターンとボラティリティを計算
    const avgReturn =
      returns.reduce((sum, ret) => sum + ret, 0) / returns.length;
    const variance =
      returns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) /
      returns.length;
    const volatility = Math.sqrt(variance);

    // シャープレシオ（無リスク金利は0と仮定）
    const sharpeRatio = avgReturn / volatility;

    // ソルティノレシオ（下方リスクのみ考慮）
    const negativeReturns = returns.filter((ret) => ret < 0);
    const downDeviation = Math.sqrt(
      negativeReturns.reduce((sum, ret) => sum + Math.pow(ret, 2), 0) /
        negativeReturns.length
    );
    const sortinoRatio = avgReturn / downDeviation;

    this.volatilityAdjustedReturns = {
      avgDailyReturn: avgReturn,
      dailyVolatility: volatility,
      annualizedReturn: avgReturn * 365,
      annualizedVolatility: volatility * Math.sqrt(365),
      sharpeRatio,
      sortinoRatio,
    };
  }

  /**
   * 詳細なメトリクスを取得
   * @returns {Object} - 詳細なパフォーマンス指標
   */
  getDetailedMetrics() {
    return {
      monthlyPerformance: this.monthlyPerformance,
      drawdownPeriods: this.drawdownPeriods,
      tradeStatistics: this.tradeStatistics,
      volatilityAdjustedReturns: this.volatilityAdjustedReturns,
    };
  }

  /**
   * 配列をシャッフル（Fisher-Yates アルゴリズム）
   * @param {Array} array - シャッフルする配列
   * @returns {Array} - シャッフルされた配列
   */
  shuffleArray(array) {
    for (let i = array.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [array[i], array[j]] = [array[j], array[i]];
    }
    return array;
  }
}

module.exports = ImprovedBacktestEngine;
