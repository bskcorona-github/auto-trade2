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
    // リスク管理設定からポジションサイズの割合を取得
    this.positionSizePercent =
      options.positionSizePercent || config.riskManagement.positionSizePercent;
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

      // 各シグナルを処理
      for (const signal of signals) {
        this.processSignal(signal, candles);
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
   * シグナルを処理
   * @param {Object} signal - シグナル情報
   * @param {Array} candles - ローソク足データ
   */
  processSignal(signal, candles) {
    // 各シグナルでの現在価格でのドローダウンを更新
    this.updateMaxDrawdownWithCurrentPrice(signal.price);

    if (!this.position) {
      // ポジションがない場合は新規に開く
      if (signal.type === "BUY") {
        this.openPosition(signal, candles);
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

    // 資金推移を記録
    this.equity.push({
      time: signal.time,
      balance: this.currentBalance,
      equity: this.calculateEquity(signal.price, candles),
    });
  }

  /**
   * ポジションを開く
   * @param {Object} signal - シグナル情報
   * @param {Array} candles - ローソク足データ
   */
  openPosition(signal, candles) {
    const entryPrice = this.adjustPrice(signal.price, signal.type);
    const positionSize = this.calculatePositionSize();
    const units = positionSize / entryPrice;
    const fee = positionSize * this.fee;

    this.position = {
      type: signal.type,
      entryPrice,
      units,
      fee,
      entryTime: signal.time,
      entryCandleIndex: signal.candleIndex,
    };

    this.currentBalance -= fee;

    logger.debug(
      `ポジションオープン: ${signal.type}, 価格=${entryPrice}, サイズ=${positionSize}, 手数料=${fee}`
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
    const positionValue = this.position.units * exitPrice;
    const fee = positionValue * this.fee;
    let profit = 0;

    if (this.position.type === "BUY") {
      // ロングポジションの利益計算
      profit =
        positionValue -
        this.position.units * this.position.entryPrice -
        fee -
        this.position.fee;
    } else {
      // ショートポジションの利益計算（修正）
      // 利益 = (エントリー価格 - 決済価格) * 数量 - 手数料
      profit =
        (this.position.entryPrice - exitPrice) * this.position.units -
        fee -
        this.position.fee;
    }

    this.currentBalance += positionValue - fee;

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
      fee: this.position.fee + fee,
    });

    logger.debug(
      `ポジションクローズ: ${this.position.type}, 利益=${profit}, 残高=${this.currentBalance}`
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
    // 最も単純で安全な方法：常に初期資金に対する一定割合を使用
    const fixedPositionSize =
      this.initialBalance * (this.positionSizePercent / 100);

    // 資産増加に応じた段階的なポジションサイズ制限
    const balanceMultiple = this.currentBalance / this.initialBalance;

    // 資産増加率に応じたポジションサイズの調整係数
    let adjustmentFactor = 1.0;

    if (balanceMultiple > 10) {
      adjustmentFactor = 0.1; // 初期資金の10倍以上の場合、サイズを小さく
    } else if (balanceMultiple > 5) {
      adjustmentFactor = 0.2; // 初期資金の5倍以上の場合
    } else if (balanceMultiple > 2) {
      adjustmentFactor = 0.5; // 初期資金の2倍以上の場合
    }

    // 現在の残高に対するポジションサイズを調整
    const dynamicPositionSize =
      this.currentBalance * (this.positionSizePercent / 100) * adjustmentFactor;

    // 固定サイズと調整サイズの小さい方を採用（安全策）
    return Math.min(dynamicPositionSize, fixedPositionSize);
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

    const avgWin =
      winningTrades.length > 0
        ? winningTrades.reduce((sum, trade) => sum + trade.profit, 0) /
          winningTrades.length
        : 0;

    const avgLoss =
      losingTrades.length > 0
        ? losingTrades.reduce((sum, trade) => sum + trade.profit, 0) /
          losingTrades.length
        : 0;

    const profitFactor = Math.abs(avgLoss) > 0 ? Math.abs(avgWin / avgLoss) : 0;
    const maxDrawdownPercent = this.maxDrawdown * 100;

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
    };
  }
}

module.exports = BacktestEngine;
