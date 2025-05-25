require("dotenv").config();

module.exports = {
  // サーバー設定
  port: process.env.PORT || 3000,
  nodeEnv: process.env.NODE_ENV || "development",

  // Binance API設定
  binance: {
    apiKey: process.env.BINANCE_API_KEY,
    apiSecret: process.env.BINANCE_API_SECRET,
    testnet: process.env.NODE_ENV !== "production", // 本番環境以外ではテストネットを使用
  },

  // リスク管理設定
  riskManagement: {
    maxDailyLoss: parseFloat(process.env.MAX_DAILY_LOSS) || 100,
    maxWeeklyLoss: parseFloat(process.env.MAX_WEEKLY_LOSS) || 500,
    maxMonthlyLoss: parseFloat(process.env.MAX_MONTHLY_LOSS) || 1000,
    positionSizePercent: parseFloat(process.env.POSITION_SIZE_PERCENT) || 1,
  },

  // バックテスト設定
  backtest: {
    startDate: process.env.BACKTEST_START_DATE || "2023-01-01",
    endDate: process.env.BACKTEST_END_DATE || "2023-12-31",
    symbol: "BTCUSDT",
    timeframe: "1h", // 1時間足
  },

  // 取引設定
  trading: {
    defaultSymbol: "BTCUSDT",
    supportedTimeframes: ["1m", "5m", "15m", "1h", "4h", "1d"],
    defaultTimeframe: "1h",
  },
};
