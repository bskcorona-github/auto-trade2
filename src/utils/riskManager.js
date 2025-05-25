const config = require("../config/config");
const logger = require("./logger");

class RiskManager {
  constructor() {
    this.trades = [];
    this.dailyLoss = 0;
    this.weeklyLoss = 0;
    this.monthlyLoss = 0;

    // 最大損失設定
    this.maxDailyLoss = config.riskManagement.maxDailyLoss;
    this.maxWeeklyLoss = config.riskManagement.maxWeeklyLoss;
    this.maxMonthlyLoss = config.riskManagement.maxMonthlyLoss;

    // ポジションサイズ設定
    this.positionSizePercent = config.riskManagement.positionSizePercent;
  }

  /**
   * 取引を記録
   * @param {Object} trade - 取引情報
   */
  recordTrade(trade) {
    this.trades.push({
      ...trade,
      timestamp: Date.now(),
    });

    // 損益計算の更新
    this.updateLosses();

    logger.info(`取引記録: ${JSON.stringify(trade)}`);
  }

  /**
   * 損失累計を更新
   */
  updateLosses() {
    const now = new Date();
    const dayStart = new Date(now);
    dayStart.setHours(0, 0, 0, 0);

    const weekStart = new Date(now);
    weekStart.setDate(now.getDate() - now.getDay());
    weekStart.setHours(0, 0, 0, 0);

    const monthStart = new Date(now);
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);

    // 期間ごとに損失を計算
    this.dailyLoss = this.calculateLossInPeriod(dayStart.getTime());
    this.weeklyLoss = this.calculateLossInPeriod(weekStart.getTime());
    this.monthlyLoss = this.calculateLossInPeriod(monthStart.getTime());
  }

  /**
   * 特定期間の損失を計算
   * @param {number} startTime - 期間の開始時間（ミリ秒）
   * @returns {number} - 損失額（正の値）
   */
  calculateLossInPeriod(startTime) {
    return this.trades
      .filter((trade) => trade.timestamp >= startTime && trade.profit < 0)
      .reduce((total, trade) => total + Math.abs(trade.profit), 0);
  }

  /**
   * 取引が損失制限を超えるかチェック
   * @returns {boolean} - 損失制限を超える場合はtrue
   */
  isLossLimitExceeded() {
    if (this.dailyLoss >= this.maxDailyLoss) {
      logger.warning(
        `日次損失制限(${this.maxDailyLoss})を超過: ${this.dailyLoss}`
      );
      return true;
    }

    if (this.weeklyLoss >= this.maxWeeklyLoss) {
      logger.warning(
        `週次損失制限(${this.maxWeeklyLoss})を超過: ${this.weeklyLoss}`
      );
      return true;
    }

    if (this.monthlyLoss >= this.maxMonthlyLoss) {
      logger.warning(
        `月次損失制限(${this.maxMonthlyLoss})を超過: ${this.monthlyLoss}`
      );
      return true;
    }

    return false;
  }

  /**
   * 適切なポジションサイズを計算
   * @param {number} accountBalance - アカウント残高
   * @returns {number} - 使用可能な金額
   */
  calculatePositionSize(accountBalance) {
    return accountBalance * (this.positionSizePercent / 100);
  }

  /**
   * リスク統計情報を取得
   * @returns {Object} - リスク統計情報
   */
  getRiskStats() {
    return {
      dailyLoss: this.dailyLoss,
      weeklyLoss: this.weeklyLoss,
      monthlyLoss: this.monthlyLoss,
      maxDailyLoss: this.maxDailyLoss,
      maxWeeklyLoss: this.maxWeeklyLoss,
      maxMonthlyLoss: this.maxMonthlyLoss,
      isLossLimitExceeded: this.isLossLimitExceeded(),
      totalTrades: this.trades.length,
    };
  }
}

module.exports = new RiskManager();
