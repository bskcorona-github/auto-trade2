const technicalIndicators = require("technicalindicators");
const logger = require("../utils/logger");

/**
 * 移動平均線クロスオーバー戦略
 * 短期移動平均線が長期移動平均線を上から下に抜けたらSELL
 * 短期移動平均線が長期移動平均線を下から上に抜けたらBUY
 */
class MovingAverageCrossover {
  constructor(params = {}) {
    // パラメータのバリデーション
    this.validateParams(params);

    // デフォルトパラメータ
    this.shortPeriod = params.shortPeriod || 9;
    this.longPeriod = params.longPeriod || 21;
    this.name = "MovingAverageCrossover";
    this.description = `移動平均線クロスオーバー戦略 (短期: ${this.shortPeriod}, 長期: ${this.longPeriod})`;
  }

  /**
   * パラメータのバリデーション
   * @param {Object} params - 戦略パラメータ
   */
  validateParams(params) {
    // 短期MAと長期MAの妥当性チェック
    if (params.shortPeriod && params.longPeriod) {
      if (params.shortPeriod >= params.longPeriod) {
        throw new Error(
          `無効なパラメータ: 短期期間(${params.shortPeriod})は長期期間(${params.longPeriod})より小さい必要があります`
        );
      }
    }

    // 数値チェック
    if (
      params.shortPeriod &&
      (typeof params.shortPeriod !== "number" || params.shortPeriod <= 1)
    ) {
      throw new Error(
        `無効な短期期間: ${params.shortPeriod}. 2以上の整数である必要があります`
      );
    }

    if (
      params.longPeriod &&
      (typeof params.longPeriod !== "number" || params.longPeriod <= 2)
    ) {
      throw new Error(
        `無効な長期期間: ${params.longPeriod}. 3以上の整数である必要があります`
      );
    }
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
      const shortMAAligned = shortMA.slice(diff);

      // 配列長のバリデーション
      if (shortMAAligned.length !== longMA.length) {
        logger.error(
          `移動平均線配列長不一致: shortMA=${shortMAAligned.length}, longMA=${longMA.length}`
        );
        return { signal: "ERROR", reason: "計算エラー: 配列長不一致" };
      }

      // インデックスの安全性チェック
      if (shortMAAligned.length < 2 || longMA.length < 2) {
        logger.warning("移動平均線データ不足");
        return { signal: "NEUTRAL", reason: "データ不足" };
      }

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
      logger.warning("バックテスト: データ不足");
      return [];
    }

    try {
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

      // インデックスを調整して整合性を確保
      // 短期MAと長期MAの開始インデックスを計算
      const longMAStartIndex = this.longPeriod - 1; // 長期MAが計算可能になる最初のインデックス
      const shortMAStartIndex = this.shortPeriod - 1; // 短期MAが計算可能になる最初のインデックス
      const signalStartIndex = longMAStartIndex; // シグナル生成開始インデックス（長い方に合わせる）

      // 短期MAと長期MAのインデックス差分
      const indexOffset = longMAStartIndex - shortMAStartIndex;

      // 短期MAと長期MAの配列長の差分
      const shortMAOffset = shortMA.length - longMA.length;

      if (shortMA.length === 0 || longMA.length === 0) {
        logger.error("移動平均線計算エラー: 空の配列");
        return [];
      }

      // すべてのデータを走査
      for (let i = 1; i < longMA.length; i++) {
        // 配列のインデックスを注意深く計算
        const shortMAIndex = i + shortMAOffset;

        // インデックスの範囲チェック
        if (shortMAIndex >= shortMA.length || shortMAIndex - 1 < 0) {
          logger.debug(
            `インデックス範囲外: shortMAIndex=${shortMAIndex}, shortMA.length=${shortMA.length}`
          );
          continue;
        }

        const currentShortMA = shortMA[shortMAIndex];
        const currentLongMA = longMA[i];
        const prevShortMA = shortMA[shortMAIndex - 1];
        const prevLongMA = longMA[i - 1];

        // インデックスを調整
        const candleIndex = i + signalStartIndex;

        // インデックスが範囲内かチェック
        if (candleIndex >= candles.length) {
          logger.debug(
            `キャンドル配列範囲外: candleIndex=${candleIndex}, candles.length=${candles.length}`
          );
          continue;
        }

        // BUYシグナル
        if (prevShortMA < prevLongMA && currentShortMA > currentLongMA) {
          signals.push({
            type: "BUY",
            price: candles[candleIndex].close,
            time: candles[candleIndex].time,
            candleIndex: candleIndex,
          });
        }
        // SELLシグナル
        else if (prevShortMA > prevLongMA && currentShortMA < currentLongMA) {
          signals.push({
            type: "SELL",
            price: candles[candleIndex].close,
            time: candles[candleIndex].time,
            candleIndex: candleIndex,
          });
        }
      }

      logger.info(`バックテスト: ${signals.length}件のシグナルを生成しました`);
      return signals;
    } catch (error) {
      logger.error(`バックテストシグナル生成エラー: ${error.message}`);
      return [];
    }
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
