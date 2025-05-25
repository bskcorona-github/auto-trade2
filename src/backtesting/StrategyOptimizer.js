const BacktestEngine = require("./BacktestEngine");
const MovingAverageCrossover = require("../strategies/MovingAverageCrossover");
const logger = require("../utils/logger");

/**
 * 戦略パラメータ最適化クラス
 * バックテストデータを使用して戦略パラメータを最適化します
 */
class StrategyOptimizer {
  constructor(options = {}) {
    this.backtestEngine = new BacktestEngine(options);
    this.strategyName = options.strategyName || "MovingAverageCrossover";
    this.optimizationMetric = options.optimizationMetric || "profit"; // 最適化指標（profit, winRate, profitFactor）
    this.populationSize = options.populationSize || 20; // 各世代の個体数
    this.generations = options.generations || 5; // 世代数
    this.mutationRate = options.mutationRate || 0.1; // 突然変異率
  }

  /**
   * 戦略パラメータを最適化
   * @param {Array} candles - ローソク足データ
   * @param {Object} paramRanges - パラメータの範囲 {paramName: {min, max}}
   * @returns {Object} - 最適化結果
   */
  async optimize(candles, paramRanges) {
    if (!candles || candles.length === 0) {
      logger.error("最適化エラー: データがありません");
      return { success: false, error: "データがありません" };
    }

    try {
      logger.info("パラメータ最適化を開始します...");

      // 初期パラメータ集団を生成
      let population = this.generateInitialPopulation(paramRanges);
      let bestResult = null;
      let bestParams = null;
      let results = [];

      // 各世代で評価・進化
      for (let gen = 0; gen < this.generations; gen++) {
        logger.info(`世代 ${gen + 1}/${this.generations} の評価を開始...`);

        // 各パラメータセットを評価
        for (const params of population) {
          // 戦略を初期化
          const strategy = this.createStrategy(params);

          // バックテスト実行
          const result = this.backtestEngine.run(candles, strategy);

          if (result.success) {
            results.push({
              params,
              result: result.result,
              fitness: this.calculateFitness(result.result),
            });

            // 最良結果を更新
            if (
              !bestResult ||
              this.calculateFitness(result.result) >
                this.calculateFitness(bestResult)
            ) {
              bestResult = result.result;
              bestParams = params;
            }
          }
        }

        // 結果をソート
        results.sort((a, b) => b.fitness - a.fitness);

        // 上位50%を選択
        const topHalf = results.slice(0, Math.ceil(results.length / 2));

        // 次世代を生成
        if (gen < this.generations - 1) {
          population = this.generateNextGeneration(topHalf, paramRanges);
          results = [];
        }

        logger.info(
          `世代 ${gen + 1} 完了: 最良適合度=${topHalf[0].fitness.toFixed(2)}`
        );
      }

      return {
        success: true,
        bestParams,
        bestResult,
        allResults: results.map((r) => ({
          params: r.params,
          profit: r.result.profit,
          profitPercent: r.result.profitPercent,
          winRate: r.result.winRate,
          trades: r.result.totalTrades,
          profitFactor: r.result.profitFactor,
          fitness: r.fitness,
        })),
      };
    } catch (error) {
      logger.error(`最適化エラー: ${error.message}`);
      return { success: false, error: error.message };
    }
  }

  /**
   * 初期パラメータ集団を生成
   * @param {Object} paramRanges - パラメータの範囲
   * @returns {Array} - パラメータセットの配列
   */
  generateInitialPopulation(paramRanges) {
    const population = [];

    for (let i = 0; i < this.populationSize; i++) {
      const params = {};

      // 各パラメータについてランダム値を生成
      for (const [paramName, range] of Object.entries(paramRanges)) {
        if (typeof range.min === "number" && typeof range.max === "number") {
          if (Number.isInteger(range.min) && Number.isInteger(range.max)) {
            // 整数パラメータ
            params[paramName] =
              Math.floor(Math.random() * (range.max - range.min + 1)) +
              range.min;
          } else {
            // 小数パラメータ
            params[paramName] =
              Math.random() * (range.max - range.min) + range.min;
          }
        }
      }

      population.push(params);
    }

    return population;
  }

  /**
   * 適合度を計算
   * @param {Object} result - バックテスト結果
   * @returns {number} - 適合度スコア
   */
  calculateFitness(result) {
    switch (this.optimizationMetric) {
      case "profit":
        return result.profit;
      case "profitPercent":
        return result.profitPercent;
      case "winRate":
        return result.winRate;
      case "profitFactor":
        return result.profitFactor;
      case "combined":
        // 複合スコア: 利益率 * 勝率 * プロフィットファクター
        return (
          result.profitPercent * (result.winRate / 100) * result.profitFactor
        );
      default:
        return result.profit;
    }
  }

  /**
   * 次世代を生成
   * @param {Array} selectedResults - 選択された結果
   * @param {Object} paramRanges - パラメータの範囲
   * @returns {Array} - 新しいパラメータセット配列
   */
  generateNextGeneration(selectedResults, paramRanges) {
    const nextGeneration = [];
    const parents = selectedResults.map((r) => r.params);

    // エリート戦略：最良の2つをそのまま次世代に
    nextGeneration.push(parents[0]);
    if (parents.length > 1) {
      nextGeneration.push(parents[1]);
    }

    // 残りはクロスオーバーと突然変異で生成
    while (nextGeneration.length < this.populationSize) {
      // 親を2つランダムに選択
      const parent1 = parents[Math.floor(Math.random() * parents.length)];
      const parent2 = parents[Math.floor(Math.random() * parents.length)];

      // クロスオーバー
      const child = this.crossover(parent1, parent2);

      // 突然変異
      this.mutate(child, paramRanges);

      nextGeneration.push(child);
    }

    return nextGeneration;
  }

  /**
   * クロスオーバー操作
   * @param {Object} parent1 - 親1のパラメータ
   * @param {Object} parent2 - 親2のパラメータ
   * @returns {Object} - 子のパラメータ
   */
  crossover(parent1, parent2) {
    const child = {};

    for (const paramName in parent1) {
      // 50%の確率で親1か親2から値を取得
      child[paramName] =
        Math.random() < 0.5 ? parent1[paramName] : parent2[paramName];
    }

    return child;
  }

  /**
   * 突然変異操作
   * @param {Object} params - パラメータセット
   * @param {Object} paramRanges - パラメータの範囲
   */
  mutate(params, paramRanges) {
    for (const [paramName, range] of Object.entries(paramRanges)) {
      // 突然変異率に基づいて突然変異を適用
      if (Math.random() < this.mutationRate) {
        if (typeof range.min === "number" && typeof range.max === "number") {
          if (Number.isInteger(range.min) && Number.isInteger(range.max)) {
            // 整数パラメータ
            params[paramName] =
              Math.floor(Math.random() * (range.max - range.min + 1)) +
              range.min;
          } else {
            // 小数パラメータ
            params[paramName] =
              Math.random() * (range.max - range.min) + range.min;
          }
        }
      }
    }
  }

  /**
   * 戦略インスタンスを作成
   * @param {Object} params - 戦略パラメータ
   * @returns {Object} - 戦略インスタンス
   */
  createStrategy(params) {
    switch (this.strategyName) {
      case "MovingAverageCrossover":
        return new MovingAverageCrossover(params);
      default:
        throw new Error(`サポートされていない戦略: ${this.strategyName}`);
    }
  }
}

module.exports = StrategyOptimizer;
