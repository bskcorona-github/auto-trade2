const logger = require("../utils/logger");
const config = require("../config/config");

class BacktestEngine {
  constructor(options = {}) {
    this.initialBalance = options.initialBalance || 10000; // 初期資金（USD）
    this.symbol = options.symbol || config.backtest.symbol;
    this.fee = options.fee || 0.001; // 取引手数料（0.1%）
    this.slippage = options.slippage || 0.001; // スリッページ（0.1%）
    this.trades = [];
    this.equity = [];
    this.maxDrawdown = 0;
    this.currentBalance = this.initialBalance;
    this.position = null; // 現在のポジション

    // リスク管理設定
    this.positionSizePercent =
      options.positionSizePercent || config.riskManagement.positionSizePercent;

    // ストップロスとテイクプロフィットの設定
    this.stopLossPercent = options.stopLossPercent || 2.0; // デフォルト2%
    this.takeProfitPercent = options.takeProfitPercent || 4.0; // デフォルト4%

    // ATRベースのポジションサイジングのための設定
    this.useAtrPositionSizing = options.useAtrPositionSizing || false;
    this.atrPeriod = options.atrPeriod || 14;
    this.atrMultiplier = options.atrMultiplier || 2.0;
    this.maxRiskPerTradePercent = options.maxRiskPerTradePercent || 1.0; // 1回のトレードの最大リスク（資金の%）
  }

  /**
   * バックテストを実行
   * @param {Array} candles - ローソク足データ
   * @param {Object} strategy - 戦略インスタンス
   * @returns {Object} - バックテスト結果
   */
  run(candles, strategy) {
    if (!candles || candles.length === 0) {
      logger.error("バックテストエラー: データがありません");
      return { success: false, error: "データがありません" };
    }

    if (!strategy || typeof strategy.generateBacktestSignals !== "function") {
      logger.error("バックテストエラー: 無効な戦略");
      return { success: false, error: "無効な戦略" };
    }

    try {
      // 初期化
      this.currentBalance = this.initialBalance;
      this.trades = [];
      this.equity = [];
      this.maxDrawdown = 0;
      this.position = null;

      // ATR計算用のデータを準備（ATRベースのポジションサイジングを使用する場合）
      let atrValues = [];
      if (this.useAtrPositionSizing) {
        atrValues = this.calculateAtr(candles, this.atrPeriod);
      }

      // 戦略からシグナルを生成
      const signals = strategy.generateBacktestSignals(candles);

      if (signals.length === 0) {
        logger.warning("バックテスト警告: シグナルが生成されませんでした");
        return {
          success: true,
          result: this.generateSummary(),
          trades: [],
          signals: [],
        };
      }

      // 各キャンドルを処理
      for (let i = 0; i < candles.length; i++) {
        const candle = candles[i];

        // 現在のポジションがある場合、ストップロスとテイクプロフィットをチェック
        if (this.position) {
          this.checkStopLossAndTakeProfit(candle, i, candles);
        }

        // 当日のシグナルを取得
        const currentSignals = signals.filter((s) => s.candleIndex === i);

        // シグナルを処理
        for (const signal of currentSignals) {
          this.processSignal(signal, candles, atrValues[i]);
        }

        // 資金推移を記録
        this.equity.push({
          time: candle.time,
          balance: this.currentBalance,
          equity: this.calculateEquity(candle.close, candles),
        });
      }

      // 最後のポジションを決済
      if (this.position) {
        const lastCandle = candles[candles.length - 1];
        this.closePosition(
          {
            type: this.position.type === "BUY" ? "SELL" : "BUY",
            price: lastCandle.close,
            time: lastCandle.time,
            candleIndex: candles.length - 1,
          },
          candles
        );
      }

      // 結果を集計
      const summary = this.generateSummary();
      logger.info(
        `バックテスト完了: 最終残高=${summary.finalBalance}, 収益=${summary.profit}, 勝率=${summary.winRate}%`
      );

      return {
        success: true,
        result: summary,
        trades: this.trades,
        signals: signals,
        equity: this.equity,
      };
    } catch (error) {
      logger.error(`バックテストエラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * ストップロスとテイクプロフィットをチェック
   * @param {Object} candle - 現在のローソク足
   * @param {number} candleIndex - ローソク足のインデックス
   * @param {Array} candles - ローソク足データ配列
   */
  checkStopLossAndTakeProfit(candle, candleIndex, candles) {
    if (!this.position) return;

    const { high, low, close } = candle;

    // ストップロスとテイクプロフィットの価格を計算
    const stopLossPrice = this.position.stopLossPrice;
    const takeProfitPrice = this.position.takeProfitPrice;

    // ストップロスのヒットをチェック
    if (this.position.type === "BUY" && low <= stopLossPrice) {
      // ロングポジションのストップロス
      this.closePosition(
        {
          type: "SELL",
          price: stopLossPrice,
          time: candle.time,
          candleIndex: candleIndex,
          reason: "STOP_LOSS",
        },
        candles
      );
      logger.debug(
        `ストップロス発動: 価格=${stopLossPrice}, 時間=${new Date(
          candle.time
        ).toISOString()}`
      );
    } else if (this.position.type === "SELL" && high >= stopLossPrice) {
      // ショートポジションのストップロス
      this.closePosition(
        {
          type: "BUY",
          price: stopLossPrice,
          time: candle.time,
          candleIndex: candleIndex,
          reason: "STOP_LOSS",
        },
        candles
      );
      logger.debug(
        `ストップロス発動: 価格=${stopLossPrice}, 時間=${new Date(
          candle.time
        ).toISOString()}`
      );
    }
    // テイクプロフィットのヒットをチェック
    else if (this.position.type === "BUY" && high >= takeProfitPrice) {
      // ロングポジションのテイクプロフィット
      this.closePosition(
        {
          type: "SELL",
          price: takeProfitPrice,
          time: candle.time,
          candleIndex: candleIndex,
          reason: "TAKE_PROFIT",
        },
        candles
      );
      logger.debug(
        `テイクプロフィット発動: 価格=${takeProfitPrice}, 時間=${new Date(
          candle.time
        ).toISOString()}`
      );
    } else if (this.position.type === "SELL" && low <= takeProfitPrice) {
      // ショートポジションのテイクプロフィット
      this.closePosition(
        {
          type: "BUY",
          price: takeProfitPrice,
          time: candle.time,
          candleIndex: candleIndex,
          reason: "TAKE_PROFIT",
        },
        candles
      );
      logger.debug(
        `テイクプロフィット発動: 価格=${takeProfitPrice}, 時間=${new Date(
          candle.time
        ).toISOString()}`
      );
    }
  }

  /**
   * シグナルを処理
   * @param {Object} signal - シグナル情報
   * @param {Array} candles - ローソク足データ
   * @param {number} atrValue - 現在のATR値（オプション）
   */
  processSignal(signal, candles, atrValue) {
    // 各シグナルでの現在価格でのドローダウンを更新
    this.updateMaxDrawdownWithCurrentPrice(signal.price);

    if (!this.position) {
      // ポジションがない場合は新規に開く
      if (signal.type === "BUY" || signal.type === "SELL") {
        this.openPosition(signal, candles, atrValue);
      }
    } else {
      // ポジションがある場合は決済するかどうか判断
      if (
        (this.position.type === "BUY" && signal.type === "SELL") ||
        (this.position.type === "SELL" && signal.type === "BUY")
      ) {
        this.closePosition(signal, candles);
      }
    }
  }

  /**
   * ポジションを開く
   * @param {Object} signal - シグナル情報
   * @param {Array} candles - ローソク足データ
   * @param {number} atrValue - 現在のATR値（オプション）
   */
  openPosition(signal, candles, atrValue) {
    const entryPrice = this.adjustPrice(signal.price, signal.type);

    // ポジションサイズを計算
    let positionSize;
    let stopLossPrice;

    if (this.useAtrPositionSizing && atrValue) {
      // ATRベースのポジションサイジング
      const atrStopDistance = atrValue * this.atrMultiplier;

      if (signal.type === "BUY") {
        stopLossPrice = entryPrice - atrStopDistance;
      } else {
        stopLossPrice = entryPrice + atrStopDistance;
      }

      // リスクに基づくポジションサイズ計算
      const riskAmount =
        this.currentBalance * (this.maxRiskPerTradePercent / 100);
      const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
      positionSize = riskAmount / riskPerUnit;
    } else {
      // パーセントベースのストップロスとポジションサイジング
      positionSize = this.calculatePositionSize();

      if (signal.type === "BUY") {
        stopLossPrice = entryPrice * (1 - this.stopLossPercent / 100);
      } else {
        stopLossPrice = entryPrice * (1 + this.stopLossPercent / 100);
      }
    }

    // テイクプロフィット価格を計算
    let takeProfitPrice;
    if (signal.type === "BUY") {
      takeProfitPrice = entryPrice * (1 + this.takeProfitPercent / 100);
    } else {
      takeProfitPrice = entryPrice * (1 - this.takeProfitPercent / 100);
    }

    const units = positionSize / entryPrice;
    const fee = positionSize * this.fee;

    this.position = {
      type: signal.type,
      entryPrice,
      units,
      fee,
      entryTime: signal.time,
      entryCandleIndex: signal.candleIndex,
      stopLossPrice,
      takeProfitPrice,
    };

    this.currentBalance -= fee;

    logger.debug(
      `ポジションオープン: ${signal.type}, 価格=${entryPrice}, サイズ=${positionSize}, 手数料=${fee}, SL=${stopLossPrice}, TP=${takeProfitPrice}`
    );
  }

  /**
   * ポジションを閉じる
   * @param {Object} signal - シグナル情報
   * @param {Array} candles - ローソク足データ
   */
  closePosition(signal, candles) {
    if (!this.position) return;

    const exitPrice = this.adjustPrice(signal.price, signal.type);
    let profit = 0;
    let positionValue = 0;

    if (this.position.type === "BUY") {
      // ロングポジションの場合
      positionValue = this.position.units * exitPrice;
      const fee = positionValue * this.fee;

      // ロングポジションの利益計算: 売却価値 - 購入コスト - 手数料
      profit =
        positionValue -
        this.position.units * this.position.entryPrice -
        fee -
        this.position.fee;

      // 残高を更新
      this.currentBalance += positionValue - fee;
    } else {
      // ショートポジションの場合
      // 証拠金取引なので、実際に売却する株式はない
      // 利益は (エントリー価格 - 決済価格) * 数量 - 手数料
      const entryValue = this.position.units * this.position.entryPrice;
      const exitValue = this.position.units * exitPrice;
      const fee = exitValue * this.fee;

      profit = entryValue - exitValue - fee - this.position.fee;
      positionValue = entryValue; // 参照用の値

      // 残高を更新
      this.currentBalance += entryValue - exitValue - fee;
    }

    // 取引を記録
    this.trades.push({
      type: this.position.type,
      entryPrice: this.position.entryPrice,
      exitPrice,
      units: this.position.units,
      entryTime: this.position.entryTime,
      exitTime: signal.time,
      entryCandleIndex: this.position.entryCandleIndex,
      exitCandleIndex: signal.candleIndex,
      profit,
      fee: this.position.fee + positionValue * this.fee,
      exitReason: signal.reason || "SIGNAL",
    });

    logger.debug(
      `ポジションクローズ: ${this.position.type}, 利益=${profit.toFixed(
        2
      )}, 残高=${this.currentBalance.toFixed(2)}`
    );

    // 最大ドローダウンを更新
    this.updateMaxDrawdown();

    // ポジションをリセット
    this.position = null;
  }

  /**
   * スリッページを考慮した価格調整
   * @param {number} price - 元の価格
   * @param {string} type - 取引タイプ（BUY/SELL）
   * @returns {number} - 調整後の価格
   */
  adjustPrice(price, type) {
    if (type === "BUY") {
      return price * (1 + this.slippage);
    } else {
      return price * (1 - this.slippage);
    }
  }

  /**
   * ポジションサイズを計算
   * @returns {number} - ポジションサイズ
   */
  calculatePositionSize() {
    // 基本的なポジションサイズ計算（資金の一定割合）
    const basePositionSize =
      this.currentBalance * (this.positionSizePercent / 100);

    // 資産増加に応じた段階的な調整係数
    // 過度なレバレッジを防ぐための安全策
    const balanceMultiple = this.currentBalance / this.initialBalance;
    let adjustmentFactor = 1.0;

    if (balanceMultiple > 10) {
      // 初期資金の10倍以上の場合、過度なリスクを抑制
      adjustmentFactor = 0.5;
    } else if (balanceMultiple > 5) {
      // 初期資金の5倍以上の場合
      adjustmentFactor = 0.7;
    } else if (balanceMultiple > 2) {
      // 初期資金の2倍以上の場合
      adjustmentFactor = 0.9;
    }

    // Kelly Criterionの計算
    // 直近の取引履歴からwinRateとwin/lossの比率を計算
    const kellyFactor = this.calculateKellyCriterion();

    // 最終的なポジションサイズ = 基本サイズ × 調整係数 × Kelly係数
    return basePositionSize * adjustmentFactor * kellyFactor;
  }

  /**
   * Kelly Criterionを計算
   * @returns {number} - Kelly係数（0〜1の値）
   */
  calculateKellyCriterion() {
    // 取引履歴が少ない場合はデフォルト値を返す
    if (this.trades.length < 10) {
      return 0.5; // 十分なデータがない場合は保守的な値を返す
    }

    // 直近の取引履歴から計算（最大30件）
    const recentTrades = this.trades.slice(-30);

    // 勝率を計算
    const winningTrades = recentTrades.filter((trade) => trade.profit > 0);
    const winRate = winningTrades.length / recentTrades.length;

    // 平均利益と平均損失を計算
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, trade) => sum + trade.profit, 0) /
          winningTrades.length
        : 0;

    const losingTrades = recentTrades.filter((trade) => trade.profit <= 0);
    const avgLoss =
      losingTrades.length > 0
        ? Math.abs(losingTrades.reduce((sum, trade) => sum + trade.profit, 0)) /
          losingTrades.length
        : 1; // 損失がない場合のデフォルト値

    // Kelly計算式: K = W - (1-W)/(R)
    // W = 勝率, R = 平均利益/平均損失
    const payoffRatio = avgWin / avgLoss;
    let kelly = winRate - (1 - winRate) / payoffRatio;

    // 安全対策: Kellyの半分を使用（ハーフケリー）
    kelly = kelly / 2;

    // 範囲を0.1〜1.0に制限（過度に小さな値や負の値を防ぐ）
    return Math.min(Math.max(kelly, 0.1), 1.0);
  }

  /**
   * 現在の純資産を計算
   * @param {number} currentPrice - 現在価格
   * @param {Array} candles - ローソク足データ
   * @returns {number} - 純資産
   */
  calculateEquity(currentPrice, candles) {
    if (!this.position) {
      return this.currentBalance;
    }

    let positionValue = 0;
    if (this.position.type === "BUY") {
      // ロングポジションの評価
      positionValue = this.position.units * currentPrice;
    } else {
      // ショートポジションの評価（修正）
      // 旧: this.position.units * this.position.entryPrice * 2 - this.position.units * currentPrice;
      // ショートポジションの利益/損失は (エントリー価格 - 現在価格) * 数量
      const profitLoss =
        (this.position.entryPrice - currentPrice) * this.position.units;
      positionValue =
        this.position.units * this.position.entryPrice + profitLoss;
    }

    return this.currentBalance + positionValue;
  }

  /**
   * 最大ドローダウンを更新
   */
  updateMaxDrawdown() {
    if (this.equity.length < 2) return;

    let peak = this.initialBalance;
    let maxDrawdown = 0;

    for (const point of this.equity) {
      if (point.equity > peak) {
        peak = point.equity;
      }

      const drawdown = (peak - point.equity) / peak;
      if (drawdown > maxDrawdown) {
        maxDrawdown = drawdown;
      }
    }

    this.maxDrawdown = maxDrawdown;
  }

  /**
   * ポジションの含み損益を考慮した最大ドローダウンを更新
   * @param {number} currentPrice - 現在の価格
   */
  updateMaxDrawdownWithCurrentPrice(currentPrice) {
    // 現在の純資産を計算
    const currentEquity = this.calculateEquity(currentPrice);

    // 過去の最高純資産を特定
    let peak = this.initialBalance;
    for (const point of this.equity) {
      if (point.equity > peak) {
        peak = point.equity;
      }
    }

    // 現在の純資産が新しいピークなら更新
    if (currentEquity > peak) {
      peak = currentEquity;
    }

    // ドローダウンを計算
    const drawdown = (peak - currentEquity) / peak;
    if (drawdown > this.maxDrawdown) {
      this.maxDrawdown = drawdown;
    }
  }

  /**
   * ATR（Average True Range）を計算
   * @param {Array} candles - ローソク足データ
   * @param {number} period - ATR期間
   * @returns {Array} - ATR値の配列
   */
  calculateAtr(candles, period) {
    const trValues = [];
    const atrValues = [];

    // True Range計算
    for (let i = 0; i < candles.length; i++) {
      let tr;
      if (i === 0) {
        // 最初のローソク足では高値と安値の差
        tr = candles[i].high - candles[i].low;
      } else {
        // それ以降は3つの値の最大値:
        // 1. 当日の高値 - 当日の安値
        // 2. |当日の高値 - 前日の終値|
        // 3. |当日の安値 - 前日の終値|
        const highLow = candles[i].high - candles[i].low;
        const highPrevClose = Math.abs(candles[i].high - candles[i - 1].close);
        const lowPrevClose = Math.abs(candles[i].low - candles[i - 1].close);
        tr = Math.max(highLow, highPrevClose, lowPrevClose);
      }
      trValues.push(tr);

      // ATR計算（単純移動平均）
      if (i < period - 1) {
        // 期間に満たない場合はTRをそのまま使用
        atrValues.push(tr);
      } else if (i === period - 1) {
        // 最初のATRは単純移動平均
        const initialAtr =
          trValues.slice(0, period).reduce((sum, value) => sum + value, 0) /
          period;
        atrValues.push(initialAtr);
      } else {
        // それ以降は指数移動平均: ATR(i) = (ATR(i-1) * (period-1) + TR(i)) / period
        const previousAtr = atrValues[i - 1];
        const currentAtr = (previousAtr * (period - 1) + tr) / period;
        atrValues.push(currentAtr);
      }
    }

    return atrValues;
  }

  /**
   * バックテスト結果のサマリーを生成
   * @returns {Object} - サマリー情報
   */
  generateSummary() {
    const initialBalance = this.initialBalance;
    const finalBalance = this.currentBalance;
    const profit = finalBalance - initialBalance;
    const profitPercent = (profit / initialBalance) * 100;

    const winningTrades = this.trades.filter((trade) => trade.profit > 0);
    const losingTrades = this.trades.filter((trade) => trade.profit <= 0);

    const totalTrades = this.trades.length;
    const winRate =
      totalTrades > 0 ? (winningTrades.length / totalTrades) * 100 : 0;

    // 勝ちトレードの平均利益
    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, trade) => sum + trade.profit, 0) /
          winningTrades.length
        : 0;

    // 負けトレードの平均損失
    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, trade) => sum + trade.profit, 0) /
          losingTrades.length
        : 0;

    // 安全なプロフィットファクター計算
    let profitFactor = 0;

    if (winningTrades.length > 0) {
      const totalWinnings = winningTrades.reduce(
        (sum, trade) => sum + trade.profit,
        0
      );

      if (losingTrades.length > 0) {
        const totalLosses = Math.abs(
          losingTrades.reduce((sum, trade) => sum + trade.profit, 0)
        );

        // 損失がゼロでなければ計算、そうでなければ無限大（技術的には大きな数値）
        profitFactor =
          totalLosses > 0
            ? totalWinnings / totalLosses
            : Number.MAX_SAFE_INTEGER;
      } else {
        // 負けトレードがない場合は理論上無限大
        profitFactor = Number.MAX_SAFE_INTEGER;
      }
    }

    const maxDrawdownPercent = this.maxDrawdown * 100;

    // 追加の統計情報
    // シャープレシオ計算
    const sharpRatio = this.calculateSharpRatio();

    // 平均保有期間
    const avgHoldingPeriod = this.calculateAverageHoldingPeriod();

    // リスク調整後リターン
    const raroc =
      profitPercent / (maxDrawdownPercent > 0 ? maxDrawdownPercent : 1);

    // ストップロスとテイクプロフィットのヒット率を計算
    const stopLossHits = this.trades.filter(
      (trade) => trade.exitReason === "STOP_LOSS"
    ).length;
    const takeProfitHits = this.trades.filter(
      (trade) => trade.exitReason === "TAKE_PROFIT"
    ).length;

    const stopLossRate =
      totalTrades > 0 ? (stopLossHits / totalTrades) * 100 : 0;
    const takeProfitRate =
      totalTrades > 0 ? (takeProfitHits / totalTrades) * 100 : 0;

    return {
      initialBalance,
      finalBalance,
      profit,
      profitPercent,
      totalTrades,
      winningTrades: winningTrades.length,
      losingTrades: losingTrades.length,
      winRate,
      avgWin,
      avgLoss,
      profitFactor,
      maxDrawdownPercent,
      sharpRatio,
      avgHoldingPeriod,
      raroc,
      stopLossRate,
      takeProfitRate,
    };
  }

  /**
   * シャープレシオを計算
   * @returns {number} - シャープレシオ
   */
  calculateSharpRatio() {
    if (this.equity.length < 2) {
      return 0;
    }

    // 日次リターンを計算
    const dailyReturns = [];
    for (let i = 1; i < this.equity.length; i++) {
      const prevEquity = this.equity[i - 1].equity;
      const currentEquity = this.equity[i].equity;
      const dailyReturn = (currentEquity - prevEquity) / prevEquity;
      dailyReturns.push(dailyReturn);
    }

    // リターンの平均値を計算
    const avgReturn =
      dailyReturns.reduce((sum, ret) => sum + ret, 0) / dailyReturns.length;

    // リターンの標準偏差を計算
    const variance =
      dailyReturns.reduce((sum, ret) => sum + Math.pow(ret - avgReturn, 2), 0) /
      dailyReturns.length;
    const stdDev = Math.sqrt(variance);

    // リスクフリーレート（ここでは0%と仮定）
    const riskFreeRate = 0;

    // シャープレシオ = (平均リターン - リスクフリーレート) / 標準偏差
    // 年間換算（取引日数252日を仮定）
    const annualizedSharpRatio =
      stdDev !== 0 ? ((avgReturn - riskFreeRate) / stdDev) * Math.sqrt(252) : 0;

    return annualizedSharpRatio;
  }

  /**
   * 平均保有期間を計算
   * @returns {number} - 平均保有期間（ローソク足の数）
   */
  calculateAverageHoldingPeriod() {
    if (this.trades.length === 0) {
      return 0;
    }

    const totalHoldingPeriods = this.trades.reduce(
      (sum, trade) => sum + (trade.exitCandleIndex - trade.entryCandleIndex),
      0
    );

    return totalHoldingPeriods / this.trades.length;
  }
}

module.exports = BacktestEngine;
