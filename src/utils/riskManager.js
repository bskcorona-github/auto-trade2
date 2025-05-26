const fs = require("fs");
const path = require("path");
const logger = require("./logger");

/**
 * リスク管理クラス
 * トレードのリスクを管理し、損失制限を実施
 */
class RiskManager {
  constructor() {
    // デフォルト設定
    this.maxDailyLoss = process.env.MAX_DAILY_LOSS || 5; // 日次最大損失 (%)
    this.maxWeeklyLoss = process.env.MAX_WEEKLY_LOSS || 10; // 週次最大損失 (%)
    this.maxMonthlyLoss = process.env.MAX_MONTHLY_LOSS || 15; // 月次最大損失 (%)
    this.positionSizePercent = process.env.POSITION_SIZE_PERCENT || 1; // ポジションサイズ (%)

    // 取引統計
    this.resetStats();

    // ストレージパス
    this.storagePath = path.join(__dirname, "../../data/risk_stats.json");

    // データディレクトリを確保
    this.ensureDataDirectory();

    // 保存データがあれば読み込み
    this.loadStats();
  }

  /**
   * データディレクトリを確保
   */
  ensureDataDirectory() {
    const dataDir = path.dirname(this.storagePath);
    try {
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
        logger.info(`データディレクトリを作成しました: ${dataDir}`);
      }
    } catch (error) {
      logger.error(`データディレクトリ作成エラー: ${error.message}`);
    }
  }

  /**
   * 統計データをリセット
   */
  resetStats() {
    const now = new Date();

    this.stats = {
      dailyProfit: 0,
      weeklyProfit: 0,
      monthlyProfit: 0,

      lastDailyReset: now.toISOString(),
      lastWeeklyReset: now.toISOString(),
      lastMonthlyReset: now.toISOString(),

      trades: [],

      initialBalance: 0,
      currentBalance: 0,
    };
  }

  /**
   * 統計データをロード
   */
  loadStats() {
    try {
      if (fs.existsSync(this.storagePath)) {
        const data = fs.readFileSync(this.storagePath, "utf8");
        const savedStats = JSON.parse(data);

        // 基本的な検証
        if (savedStats && typeof savedStats === "object") {
          this.stats = {
            ...this.stats, // デフォルト値をベースに
            ...savedStats, // 保存データで上書き
          };
          logger.info("リスク統計データを読み込みました");

          // 日時ベースのリセットを確認
          this.checkTimeBasedReset();
        }
      }
    } catch (error) {
      logger.error(`リスク統計データ読み込みエラー: ${error.message}`);
    }
  }

  /**
   * 統計データを保存
   */
  saveStats() {
    try {
      const data = JSON.stringify(this.stats, null, 2);
      fs.writeFile(this.storagePath, data, "utf8", (err) => {
        if (err) {
          logger.error(`リスク統計データ保存エラー: ${err.message}`);
        }
      });
    } catch (error) {
      logger.error(`リスク統計データ保存エラー: ${error.message}`);
    }
  }

  /**
   * 時間ベースのリセットをチェック
   */
  checkTimeBasedReset() {
    const now = new Date();

    // 日次リセット
    const lastDailyReset = new Date(this.stats.lastDailyReset);
    if (
      now.getDate() !== lastDailyReset.getDate() ||
      now.getMonth() !== lastDailyReset.getMonth() ||
      now.getFullYear() !== lastDailyReset.getFullYear()
    ) {
      this.stats.dailyProfit = 0;
      this.stats.lastDailyReset = now.toISOString();
      logger.info("日次損益をリセットしました");
    }

    // 週次リセット
    const lastWeeklyReset = new Date(this.stats.lastWeeklyReset);
    const nowWeek = this.getWeekNumber(now);
    const lastWeek = this.getWeekNumber(lastWeeklyReset);

    if (
      nowWeek !== lastWeek ||
      now.getFullYear() !== lastWeeklyReset.getFullYear()
    ) {
      this.stats.weeklyProfit = 0;
      this.stats.lastWeeklyReset = now.toISOString();
      logger.info("週次損益をリセットしました");
    }

    // 月次リセット
    const lastMonthlyReset = new Date(this.stats.lastMonthlyReset);
    if (
      now.getMonth() !== lastMonthlyReset.getMonth() ||
      now.getFullYear() !== lastMonthlyReset.getFullYear()
    ) {
      this.stats.monthlyProfit = 0;
      this.stats.lastMonthlyReset = now.toISOString();
      logger.info("月次損益をリセットしました");
    }
  }

  /**
   * 週番号を取得
   * @param {Date} date - 日付
   * @returns {number} - 週番号
   */
  getWeekNumber(date) {
    const firstDayOfYear = new Date(date.getFullYear(), 0, 1);
    const pastDaysOfYear = (date - firstDayOfYear) / 86400000;
    return Math.ceil((pastDaysOfYear + firstDayOfYear.getDay() + 1) / 7);
  }

  /**
   * 取引結果を記録
   * @param {Object} trade - 取引情報
   * @returns {boolean} - 取引が許可されるかどうか
   */
  recordTrade(trade) {
    if (!trade || typeof trade !== "object") return false;

    // 時間ベースのリセットをチェック
    this.checkTimeBasedReset();

    const profit = trade.profit || 0;

    // 損益を記録
    this.stats.dailyProfit += profit;
    this.stats.weeklyProfit += profit;
    this.stats.monthlyProfit += profit;

    // 残高を更新
    if (trade.balance) {
      this.stats.currentBalance = trade.balance;
    }

    // 取引履歴に追加（最大100件まで）
    this.stats.trades.unshift({
      ...trade,
      timestamp: new Date().toISOString(),
    });

    if (this.stats.trades.length > 100) {
      this.stats.trades.pop();
    }

    // 統計を保存
    this.saveStats();

    // リスク違反をチェック
    const riskViolation = this.checkRiskViolation();

    return !riskViolation;
  }

  /**
   * リスク違反をチェック
   * @returns {boolean} - リスク違反があるかどうか
   */
  checkRiskViolation() {
    // 初期残高が設定されていない場合は計算不能
    if (!this.stats.initialBalance) return false;

    const initialBalance = this.stats.initialBalance;

    // 日次損失のチェック
    if (
      this.stats.dailyProfit < 0 &&
      (Math.abs(this.stats.dailyProfit) / initialBalance) * 100 >
        this.maxDailyLoss
    ) {
      logger.warning(
        `日次最大損失を超過しました: ${Math.abs(this.stats.dailyProfit)} (${
          this.maxDailyLoss
        }%制限)`
      );
      return true;
    }

    // 週次損失のチェック
    if (
      this.stats.weeklyProfit < 0 &&
      (Math.abs(this.stats.weeklyProfit) / initialBalance) * 100 >
        this.maxWeeklyLoss
    ) {
      logger.warning(
        `週次最大損失を超過しました: ${Math.abs(this.stats.weeklyProfit)} (${
          this.maxWeeklyLoss
        }%制限)`
      );
      return true;
    }

    // 月次損失のチェック
    if (
      this.stats.monthlyProfit < 0 &&
      (Math.abs(this.stats.monthlyProfit) / initialBalance) * 100 >
        this.maxMonthlyLoss
    ) {
      logger.warning(
        `月次最大損失を超過しました: ${Math.abs(this.stats.monthlyProfit)} (${
          this.maxMonthlyLoss
        }%制限)`
      );
      return true;
    }

    return false;
  }

  /**
   * 初期残高を設定
   * @param {number} balance - 初期残高
   */
  setInitialBalance(balance) {
    if (typeof balance === "number" && balance > 0) {
      this.stats.initialBalance = balance;

      // 初期設定時は現在残高も同じ値に
      if (!this.stats.currentBalance) {
        this.stats.currentBalance = balance;
      }

      this.saveStats();
      logger.info(`初期残高を設定しました: ${balance}`);
    }
  }

  /**
   * リスク統計情報を取得
   * @returns {Object} - リスク統計情報
   */
  getRiskStats() {
    // 時間ベースのリセットをチェック
    this.checkTimeBasedReset();

    // 統計情報を複製して返す（オブジェクトの変更を防ぐ）
    return { ...this.stats };
  }

  /**
   * リスク設定を更新
   * @param {Object} settings - リスク設定
   */
  updateSettings(settings) {
    if (!settings || typeof settings !== "object") return;

    // 各設定項目を更新
    if (
      typeof settings.maxDailyLoss === "number" &&
      settings.maxDailyLoss > 0
    ) {
      this.maxDailyLoss = settings.maxDailyLoss;
    }

    if (
      typeof settings.maxWeeklyLoss === "number" &&
      settings.maxWeeklyLoss > 0
    ) {
      this.maxWeeklyLoss = settings.maxWeeklyLoss;
    }

    if (
      typeof settings.maxMonthlyLoss === "number" &&
      settings.maxMonthlyLoss > 0
    ) {
      this.maxMonthlyLoss = settings.maxMonthlyLoss;
    }

    if (
      typeof settings.positionSizePercent === "number" &&
      settings.positionSizePercent > 0 &&
      settings.positionSizePercent <= 100
    ) {
      this.positionSizePercent = settings.positionSizePercent;
    }

    logger.info("リスク設定を更新しました");
  }

  /**
   * リスク設定情報を取得
   * @returns {Object} - リスク設定情報
   */
  getRiskSettings() {
    return {
      maxDailyLoss: this.maxDailyLoss,
      maxWeeklyLoss: this.maxWeeklyLoss,
      maxMonthlyLoss: this.maxMonthlyLoss,
      positionSizePercent: this.positionSizePercent,
    };
  }
}

// 設定済みのRiskManagerインスタンスをエクスポート
const riskManager = new RiskManager();

// インスタンスとクラスの両方をエクスポート
module.exports = riskManager;
module.exports.RiskManager = RiskManager;
