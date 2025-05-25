// グローバル変数
let socket;
let priceChart;
let equityChart;
let backtestPriceChart;
let backtestEquityChart;
let currentPrice = 0;
let isConnected = false;
let isTrading = false;

// ページ読み込み時の初期化
document.addEventListener("DOMContentLoaded", () => {
  // Socket.IO接続
  initializeSocket();

  // チャート初期化
  initializeCharts();

  // イベントリスナー設定
  setupEventListeners();

  // 現在の価格を定期的に取得
  fetchPriceRegularly();
});

// Socket.IO接続の初期化
function initializeSocket() {
  socket = io();

  // 接続イベント
  socket.on("connect", () => {
    isConnected = true;
    updateConnectionStatus(true);
    console.log("サーバーに接続しました");
  });

  // 切断イベント
  socket.on("disconnect", () => {
    isConnected = false;
    updateConnectionStatus(false);
    console.log("サーバーから切断されました");
  });

  // 価格更新イベント
  socket.on("price_update", (data) => {
    updatePrice(data.price);
  });

  // 取引更新イベント
  socket.on("trade_update", (trade) => {
    addTradeToHistory(trade);
    updateDailyProfit();
  });

  // システム状態更新イベント
  socket.on("system_status", (status) => {
    updateSystemStatus(status);
  });
}

// 接続状態の表示を更新
function updateConnectionStatus(connected) {
  const statusElement = document.getElementById("connection-status");
  if (connected) {
    statusElement.innerHTML = '<span class="badge bg-success">接続中</span>';
  } else {
    statusElement.innerHTML = '<span class="badge bg-danger">未接続</span>';
  }
}

// 現在の価格表示を更新
function updatePrice(price) {
  currentPrice = price;
  const priceElement = document.getElementById("current-price");
  priceElement.innerHTML = `<span class="badge bg-primary">BTCUSDT: ${price.toFixed(
    2
  )} USD</span>`;

  // チャートにデータを追加
  if (priceChart) {
    addDataToChart(priceChart, new Date().toLocaleTimeString(), price);
  }
}

// チャートの初期化
function initializeCharts() {
  // 価格チャート
  const priceCtx = document.getElementById("price-chart").getContext("2d");
  priceChart = new Chart(priceCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "BTC価格 (USD)",
          data: [],
          borderColor: "rgb(54, 162, 235)",
          backgroundColor: "rgba(54, 162, 235, 0.2)",
          borderWidth: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "top",
        },
        tooltip: {
          mode: "index",
          intersect: false,
        },
      },
      scales: {
        x: {
          display: true,
          title: {
            display: true,
            text: "時間",
          },
        },
        y: {
          display: true,
          title: {
            display: true,
            text: "価格 (USD)",
          },
        },
      },
    },
  });

  // 資産チャート
  const equityCtx = document.getElementById("equity-chart").getContext("2d");
  equityChart = new Chart(equityCtx, {
    type: "line",
    data: {
      labels: [],
      datasets: [
        {
          label: "資産額 (USD)",
          data: [],
          borderColor: "rgb(75, 192, 192)",
          backgroundColor: "rgba(75, 192, 192, 0.2)",
          borderWidth: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        legend: {
          position: "top",
        },
      },
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    },
  });
}

// チャートにデータを追加
function addDataToChart(chart, label, data) {
  chart.data.labels.push(label);
  chart.data.datasets[0].data.push(data);

  // データが多すぎる場合は古いデータを削除
  if (chart.data.labels.length > 100) {
    chart.data.labels.shift();
    chart.data.datasets[0].data.shift();
  }

  chart.update();
}

// イベントリスナーのセットアップ
function setupEventListeners() {
  // バックテストフォーム
  const backtestForm = document.getElementById("backtest-form");
  if (backtestForm) {
    backtestForm.addEventListener("submit", handleBacktestSubmit);
  }

  // 最適化フォーム
  const optimizeForm = document.getElementById("optimize-form");
  if (optimizeForm) {
    optimizeForm.addEventListener("submit", handleOptimizeSubmit);
  }

  // 最適パラメータ適用ボタン
  const applyBestParamsBtn = document.getElementById("apply-best-params");
  if (applyBestParamsBtn) {
    applyBestParamsBtn.addEventListener("click", applyBestParams);
  }

  // 戦略設定フォーム
  const strategyForm = document.getElementById("strategy-form");
  if (strategyForm) {
    strategyForm.addEventListener("submit", handleStrategySubmit);
  }

  // リスク設定フォーム
  const riskForm = document.getElementById("risk-form");
  if (riskForm) {
    riskForm.addEventListener("submit", handleRiskSubmit);
  }

  // API設定フォーム
  const apiForm = document.getElementById("api-form");
  if (apiForm) {
    apiForm.addEventListener("submit", handleApiSubmit);
  }

  // 取引開始ボタン
  const startTradingBtn = document.getElementById("start-trading");
  if (startTradingBtn) {
    startTradingBtn.addEventListener("click", startTrading);
  }

  // 取引停止ボタン
  const stopTradingBtn = document.getElementById("stop-trading");
  if (stopTradingBtn) {
    stopTradingBtn.addEventListener("click", stopTrading);
  }

  // 緊急停止ボタン
  const emergencyStopBtn = document.getElementById("emergency-stop");
  if (emergencyStopBtn) {
    emergencyStopBtn.addEventListener("click", emergencyStop);
  }

  // テストモードボタン
  const testModeBtn = document.getElementById("test-mode");
  if (testModeBtn) {
    testModeBtn.addEventListener("click", toggleTestMode);
  }
}

// 定期的に価格を取得
function fetchPriceRegularly() {
  fetchCurrentPrice();
  setInterval(fetchCurrentPrice, 5000); // 5秒ごとに更新
}

// 現在の価格を取得
async function fetchCurrentPrice() {
  try {
    const response = await fetch("/api/price?symbol=BTCUSDT");
    const data = await response.json();

    if (data.success) {
      updatePrice(data.price);
    }
  } catch (error) {
    console.error("価格取得エラー:", error);
  }
}

// バックテスト実行
async function handleBacktestSubmit(event) {
  event.preventDefault();

  const symbol = document.getElementById("backtest-symbol").value;
  const timeframe = document.getElementById("backtest-timeframe").value;
  const strategy = document.getElementById("backtest-strategy").value;
  const startDate = document.getElementById("backtest-start-date").value;
  const endDate = document.getElementById("backtest-end-date").value;
  const initialBalance = parseFloat(
    document.getElementById("backtest-initial-balance").value
  );
  const positionSizePercent = parseFloat(
    document.getElementById("backtest-position-size").value
  );
  const shortPeriod = parseInt(
    document.getElementById("param-short-period").value
  );
  const longPeriod = parseInt(
    document.getElementById("param-long-period").value
  );

  // バリデーション
  if (!startDate || !endDate) {
    alert("開始日と終了日を入力してください");
    return;
  }

  if (isNaN(initialBalance) || initialBalance <= 0) {
    alert("初期資金は正の数値を入力してください");
    return;
  }

  if (
    isNaN(positionSizePercent) ||
    positionSizePercent <= 0 ||
    positionSizePercent > 100
  ) {
    alert("ポジションサイズは0より大きく100以下の値を入力してください");
    return;
  }

  try {
    // ローディング表示
    showLoading("バックテスト実行中...");

    // バックテストAPIを呼び出し
    const response = await fetch("/api/backtest", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        strategyName: strategy,
        strategyParams: {
          shortPeriod,
          longPeriod,
        },
        startDate,
        endDate,
        initialBalance,
        positionSizePercent,
      }),
    });

    const result = await response.json();

    // ローディング非表示
    hideLoading();

    if (result.success) {
      displayBacktestResults(result);
    } else {
      alert(`バックテストエラー: ${result.error}`);
    }
  } catch (error) {
    hideLoading();
    console.error("バックテストエラー:", error);
    alert("バックテスト実行中にエラーが発生しました");
  }
}

// API設定フォームの送信処理
async function handleApiSubmit(event) {
  event.preventDefault();

  const apiKey = document.getElementById("api-key").value;
  const apiSecret = document.getElementById("api-secret").value;
  const useTestnet = document.getElementById("use-testnet").checked;

  if (!apiKey || !apiSecret) {
    alert("APIキーとシークレットを入力してください");
    return;
  }

  try {
    const response = await fetch("/api/settings/api", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        BINANCE_API_KEY: apiKey,
        BINANCE_API_SECRET: apiSecret,
        useTestnet,
      }),
    });

    const result = await response.json();

    if (result.success) {
      alert("API設定を保存しました");
    } else {
      alert(`API設定エラー: ${result.error}`);
    }
  } catch (error) {
    console.error("API設定エラー:", error);
    alert("API設定の保存中にエラーが発生しました");
  }
}

// 戦略設定フォームの送信処理
async function handleStrategySubmit(event) {
  event.preventDefault();

  const shortPeriod = parseInt(
    document.getElementById("strategy-short-period").value
  );
  const longPeriod = parseInt(
    document.getElementById("strategy-long-period").value
  );

  try {
    const response = await fetch("/api/settings/strategy", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        strategyName: "MovingAverageCrossover",
        params: {
          shortPeriod,
          longPeriod,
        },
      }),
    });

    const result = await response.json();

    if (result.success) {
      alert("戦略設定を保存しました");
    } else {
      alert(`戦略設定エラー: ${result.error}`);
    }
  } catch (error) {
    console.error("戦略設定エラー:", error);
    alert("戦略設定の保存中にエラーが発生しました");
  }
}

// リスク設定フォームの送信処理
async function handleRiskSubmit(event) {
  event.preventDefault();

  const maxDailyLoss = parseFloat(
    document.getElementById("max-daily-loss").value
  );
  const maxWeeklyLoss = parseFloat(
    document.getElementById("max-weekly-loss").value
  );
  const maxMonthlyLoss = parseFloat(
    document.getElementById("max-monthly-loss").value
  );
  const positionSizePercent = parseFloat(
    document.getElementById("position-size-percent").value
  );

  try {
    const response = await fetch("/api/settings/risk", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        maxDailyLoss,
        maxWeeklyLoss,
        maxMonthlyLoss,
        positionSizePercent,
      }),
    });

    const result = await response.json();

    if (result.success) {
      alert("リスク設定を保存しました");
    } else {
      alert(`リスク設定エラー: ${result.error}`);
    }
  } catch (error) {
    console.error("リスク設定エラー:", error);
    alert("リスク設定の保存中にエラーが発生しました");
  }
}

// バックテスト結果の表示
function displayBacktestResults(data) {
  // 結果カードを表示
  const resultsCard = document.getElementById("backtest-results-card");
  resultsCard.classList.remove("d-none");

  // 実際に処理された期間情報を取得
  let actualStartDate = "データなし";
  let actualEndDate = "データなし";
  let candleCount = 0;

  if (data.equity && data.equity.length > 0) {
    // 最初と最後のデータポイントから期間を取得
    actualStartDate = new Date(data.equity[0].time).toLocaleDateString();
    actualEndDate = new Date(
      data.equity[data.equity.length - 1].time
    ).toLocaleDateString();
  }

  if (data.candles) {
    candleCount = data.candles.length;
    if (candleCount > 0) {
      actualStartDate = new Date(data.candles[0].time).toLocaleDateString();
      actualEndDate = new Date(
        data.candles[data.candles.length - 1].time
      ).toLocaleDateString();
    }
  }

  // サマリーテーブルを更新
  const summaryTable = document.getElementById("backtest-summary");
  summaryTable.innerHTML = `
    <tr><td>実際の期間:</td><td>${actualStartDate} 〜 ${actualEndDate}</td></tr>
    <tr><td>処理したデータ数:</td><td>${candleCount} 件</td></tr>
    <tr><td>初期資金:</td><td>${data.result.initialBalance.toFixed(
      2
    )} USD</td></tr>
    <tr><td>最終資金:</td><td>${data.result.finalBalance.toFixed(
      2
    )} USD</td></tr>
    <tr><td>利益:</td><td class="${
      data.result.profit > 0 ? "text-success" : "text-danger"
    }">${data.result.profit.toFixed(
    2
  )} USD (${data.result.profitPercent.toFixed(2)}%)</td></tr>
    <tr><td>取引回数:</td><td>${data.result.totalTrades}</td></tr>
    <tr><td>勝率:</td><td>${data.result.winRate.toFixed(2)}%</td></tr>
    <tr><td>最大ドローダウン:</td><td>${data.result.maxDrawdownPercent.toFixed(
      2
    )}%</td></tr>
    <tr><td>プロフィットファクター:</td><td>${data.result.profitFactor.toFixed(
      2
    )}</td></tr>
  `;

  // バックテスト資産チャートを更新
  updateBacktestEquityChart(data.equity);

  // バックテスト価格・シグナルチャートを更新
  updateBacktestPriceChart(data.signals, data.trades, data.candles);

  // 結果までスクロール
  resultsCard.scrollIntoView({ behavior: "smooth" });
}

// バックテスト資産チャートの更新
function updateBacktestEquityChart(equityData) {
  const ctx = document.getElementById("backtest-equity-chart").getContext("2d");

  if (backtestEquityChart) {
    backtestEquityChart.destroy();
  }

  const labels = equityData.map((data) => {
    const date = new Date(data.time);
    return date.toLocaleDateString();
  });

  const values = equityData.map((data) => data.equity);

  backtestEquityChart = new Chart(ctx, {
    type: "line",
    data: {
      labels,
      datasets: [
        {
          label: "資産推移",
          data: values,
          borderColor: "rgb(75, 192, 192)",
          backgroundColor: "rgba(75, 192, 192, 0.2)",
          borderWidth: 2,
          tension: 0.1,
        },
      ],
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "資産推移",
        },
      },
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    },
  });
}

// バックテスト価格チャートの更新
function updateBacktestPriceChart(signals, trades, candles) {
  const ctx = document.getElementById("backtest-price-chart").getContext("2d");

  if (backtestPriceChart) {
    backtestPriceChart.destroy();
  }

  // データポイントの準備
  let labels = [];
  let priceData = [];

  // ローソク足データが提供されている場合はそれを使用
  if (candles && candles.length > 0) {
    labels = candles.map((candle) =>
      new Date(candle.time).toLocaleDateString()
    );
    priceData = candles.map((candle) => candle.close);
  }
  // ローソク足データがない場合はシグナルから推測
  else if (signals && signals.length > 0) {
    labels = signals.map((signal) =>
      new Date(signal.time).toLocaleDateString()
    );
    priceData = signals.map((signal) => signal.price);
  }

  // シグナルデータの準備
  let buySignalData = [];
  let sellSignalData = [];

  if (signals && signals.length > 0) {
    // シグナルの時間とローソク足の時間をマッピング
    const timeMap = {};

    if (candles && candles.length > 0) {
      candles.forEach((candle, index) => {
        timeMap[candle.time] = index;
      });

      // シグナルの位置を特定
      signals.forEach((signal) => {
        const closestIndex = findClosestCandleIndex(signal.time, candles);

        if (closestIndex !== -1) {
          if (signal.type === "BUY") {
            const signalPoint = new Array(priceData.length).fill(null);
            signalPoint[closestIndex] = priceData[closestIndex];
            buySignalData.push(signalPoint);
          } else if (signal.type === "SELL") {
            const signalPoint = new Array(priceData.length).fill(null);
            signalPoint[closestIndex] = priceData[closestIndex];
            sellSignalData.push(signalPoint);
          }
        }
      });
    } else {
      // ローソク足データがない場合は単純化
      buySignalData = signals.map((signal) =>
        signal.type === "BUY" ? signal.price : null
      );
      sellSignalData = signals.map((signal) =>
        signal.type === "SELL" ? signal.price : null
      );
    }
  }

  // チャートデータセットの作成
  const datasets = [
    {
      label: "価格",
      data: priceData,
      borderColor: "rgb(54, 162, 235)",
      backgroundColor: "rgba(54, 162, 235, 0.2)",
      borderWidth: 2,
      tension: 0.1,
      fill: false,
    },
  ];

  // 買いシグナルと売りシグナルのデータセット
  if (buySignalData.length > 0) {
    if (Array.isArray(buySignalData[0])) {
      // 複数のシグナルポイント配列がある場合
      buySignalData.forEach((points, index) => {
        datasets.push({
          label: index === 0 ? "買いシグナル" : "",
          data: points,
          pointBackgroundColor: "green",
          pointBorderColor: "green",
          pointRadius: 5,
          pointHoverRadius: 7,
          showLine: false,
          hidden: false,
        });
      });
    } else {
      // 単一の配列の場合
      datasets.push({
        label: "買いシグナル",
        data: buySignalData,
        pointBackgroundColor: "green",
        pointBorderColor: "green",
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
      });
    }
  }

  if (sellSignalData.length > 0) {
    if (Array.isArray(sellSignalData[0])) {
      // 複数のシグナルポイント配列がある場合
      sellSignalData.forEach((points, index) => {
        datasets.push({
          label: index === 0 ? "売りシグナル" : "",
          data: points,
          pointBackgroundColor: "red",
          pointBorderColor: "red",
          pointRadius: 5,
          pointHoverRadius: 7,
          showLine: false,
          hidden: false,
        });
      });
    } else {
      // 単一の配列の場合
      datasets.push({
        label: "売りシグナル",
        data: sellSignalData,
        pointBackgroundColor: "red",
        pointBorderColor: "red",
        pointRadius: 5,
        pointHoverRadius: 7,
        showLine: false,
      });
    }
  }

  backtestPriceChart = new Chart(ctx, {
    type: "line",
    data: {
      labels: labels,
      datasets: datasets,
    },
    options: {
      responsive: true,
      plugins: {
        title: {
          display: true,
          text: "価格とシグナル",
        },
        tooltip: {
          mode: "index",
          intersect: false,
        },
        legend: {
          labels: {
            filter: function (legendItem, chartData) {
              // 空文字列のラベルを凡例から除外
              return legendItem.text !== "";
            },
          },
        },
      },
      scales: {
        y: {
          beginAtZero: false,
        },
      },
    },
  });
}

// 最も近いローソク足のインデックスを探す補助関数
function findClosestCandleIndex(targetTime, candles) {
  if (!candles || candles.length === 0) return -1;

  let closestIndex = 0;
  let minDiff = Math.abs(targetTime - candles[0].time);

  for (let i = 1; i < candles.length; i++) {
    const diff = Math.abs(targetTime - candles[i].time);
    if (diff < minDiff) {
      minDiff = diff;
      closestIndex = i;
    }
  }

  return closestIndex;
}

// システム状態の更新
function updateSystemStatus(status) {
  const statusElement = document.getElementById("system-status");
  const strategyElement = document.getElementById("current-strategy");

  // システム状態を更新
  if (status.isRunning) {
    statusElement.className = "badge bg-success";
    statusElement.textContent = "稼働中";
    isTrading = true;
  } else {
    statusElement.className = "badge bg-secondary";
    statusElement.textContent = "停止中";
    isTrading = false;
  }

  // 現在の戦略を更新
  if (status.currentStrategy) {
    strategyElement.textContent = status.currentStrategy;
  } else {
    strategyElement.textContent = "選択なし";
  }
}

// 取引履歴に取引を追加
function addTradeToHistory(trade) {
  const tradeHistory = document.getElementById("trade-history");

  // 「データなし」行を削除
  const noDataRow = tradeHistory.querySelector('tr td[colspan="5"]');
  if (noDataRow) {
    noDataRow.parentElement.remove();
  }

  // 取引行を作成
  const row = document.createElement("tr");
  row.className = trade.profit > 0 ? "profit" : "loss";

  // 日時フォーマット
  const date = new Date(trade.exitTime);
  const dateStr = date.toLocaleDateString() + " " + date.toLocaleTimeString();

  // 行の内容を設定
  row.innerHTML = `
    <td>${dateStr}</td>
    <td>${trade.type}</td>
    <td>${trade.exitPrice.toFixed(2)}</td>
    <td>${trade.units.toFixed(5)}</td>
    <td class="${trade.profit > 0 ? "text-success" : "text-danger"}">
      ${trade.profit.toFixed(2)} USD
    </td>
  `;

  // 履歴の先頭に追加
  tradeHistory.insertBefore(row, tradeHistory.firstChild);

  // 最大10件まで表示
  if (tradeHistory.children.length > 10) {
    tradeHistory.removeChild(tradeHistory.lastChild);
  }
}

// 日次損益の更新
function updateDailyProfit() {
  fetch("/api/daily-profit")
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        const profitElement = document.getElementById("daily-profit");
        const profit = data.profit.toFixed(2);
        const className = data.profit >= 0 ? "text-success" : "text-danger";
        profitElement.className = className;
        profitElement.textContent = `${profit} USD`;
      }
    })
    .catch((error) => console.error("日次損益取得エラー:", error));
}

// 取引開始
function startTrading() {
  if (!isConnected) {
    alert("サーバーに接続されていません");
    return;
  }

  fetch("/api/trading/start", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("取引を開始しました");
        updateSystemStatus({ isRunning: true, currentStrategy: data.strategy });
      } else {
        alert(`取引開始エラー: ${data.error}`);
      }
    })
    .catch((error) => {
      console.error("取引開始エラー:", error);
      alert("取引開始中にエラーが発生しました");
    });
}

// 取引停止
function stopTrading() {
  fetch("/api/trading/stop", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("取引を停止しました");
        updateSystemStatus({ isRunning: false });
      } else {
        alert(`取引停止エラー: ${data.error}`);
      }
    })
    .catch((error) => {
      console.error("取引停止エラー:", error);
      alert("取引停止中にエラーが発生しました");
    });
}

// 緊急停止
function emergencyStop() {
  fetch("/api/trading/emergency-stop", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert("緊急停止しました。すべてのポジションが決済されました");
        updateSystemStatus({ isRunning: false });
      } else {
        alert(`緊急停止エラー: ${data.error}`);
      }
    })
    .catch((error) => {
      console.error("緊急停止エラー:", error);
      alert("緊急停止中にエラーが発生しました");
    });
}

// テストモード切り替え
function toggleTestMode() {
  fetch("/api/trading/test-mode", { method: "POST" })
    .then((response) => response.json())
    .then((data) => {
      if (data.success) {
        alert(`テストモード: ${data.testMode ? "ON" : "OFF"}`);
      } else {
        alert(`テストモード切り替えエラー: ${data.error}`);
      }
    })
    .catch((error) => {
      console.error("テストモード切り替えエラー:", error);
      alert("テストモード切り替え中にエラーが発生しました");
    });
}

// ローディング表示
function showLoading(message) {
  const loadingDiv = document.createElement("div");
  loadingDiv.id = "loading-overlay";
  loadingDiv.innerHTML = `
    <div class="spinner-border text-primary" role="status">
      <span class="visually-hidden">Loading...</span>
    </div>
    <p>${message || "Loading..."}</p>
  `;

  loadingDiv.style.cssText = `
    position: fixed;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background-color: rgba(0, 0, 0, 0.5);
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    z-index: 9999;
    color: white;
  `;

  document.body.appendChild(loadingDiv);
}

// ローディング非表示
function hideLoading() {
  const loadingDiv = document.getElementById("loading-overlay");
  if (loadingDiv) {
    loadingDiv.remove();
  }
}

// パラメータ最適化実行
async function handleOptimizeSubmit(event) {
  event.preventDefault();

  const symbol = document.getElementById("optimize-symbol").value;
  const timeframe = document.getElementById("optimize-timeframe").value;
  const strategy = document.getElementById("optimize-strategy").value;
  const startDate = document.getElementById("optimize-start-date").value;
  const endDate = document.getElementById("optimize-end-date").value;
  const initialBalance = parseFloat(
    document.getElementById("optimize-initial-balance").value
  );
  const positionSizePercent = parseFloat(
    document.getElementById("optimize-position-size").value
  );
  const optimizationMetric = document.getElementById(
    "optimization-metric"
  ).value;
  const populationSize = parseInt(
    document.getElementById("population-size").value
  );
  const generations = parseInt(document.getElementById("generations").value);

  // パラメータ範囲を取得
  const shortPeriodMin = parseInt(
    document.getElementById("param-short-period-min").value
  );
  const shortPeriodMax = parseInt(
    document.getElementById("param-short-period-max").value
  );
  const longPeriodMin = parseInt(
    document.getElementById("param-long-period-min").value
  );
  const longPeriodMax = parseInt(
    document.getElementById("param-long-period-max").value
  );

  // バリデーション
  if (!startDate || !endDate) {
    alert("開始日と終了日を入力してください");
    return;
  }

  if (isNaN(initialBalance) || initialBalance <= 0) {
    alert("初期資金は正の数値を入力してください");
    return;
  }

  if (
    isNaN(positionSizePercent) ||
    positionSizePercent <= 0 ||
    positionSizePercent > 100
  ) {
    alert("ポジションサイズは0より大きく100以下の値を入力してください");
    return;
  }

  if (shortPeriodMax <= shortPeriodMin) {
    alert("短期MA最大値は最小値より大きくする必要があります");
    return;
  }

  if (longPeriodMax <= longPeriodMin) {
    alert("長期MA最大値は最小値より大きくする必要があります");
    return;
  }

  if (shortPeriodMax >= longPeriodMin) {
    alert("短期MA最大値は長期MA最小値より小さくする必要があります");
    return;
  }

  try {
    // ローディング表示
    showLoading("パラメータ最適化中...<br>時間がかかる場合があります");

    // 最適化APIを呼び出し
    const response = await fetch("/api/optimize", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        symbol,
        timeframe,
        strategyName: strategy,
        paramRanges: {
          shortPeriod: { min: shortPeriodMin, max: shortPeriodMax },
          longPeriod: { min: longPeriodMin, max: longPeriodMax },
        },
        startDate,
        endDate,
        initialBalance,
        positionSizePercent,
        optimizationMetric,
        populationSize,
        generations,
      }),
    });

    const result = await response.json();

    // ローディング非表示
    hideLoading();

    if (result.success) {
      displayOptimizationResults(result);
    } else {
      alert(`最適化エラー: ${result.error}`);
    }
  } catch (error) {
    hideLoading();
    console.error("最適化エラー:", error);
    alert("パラメータ最適化中にエラーが発生しました");
  }
}

// 最適化結果の表示
function displayOptimizationResults(data) {
  // 結果カードを表示
  const resultsCard = document.getElementById("optimization-results-card");
  resultsCard.classList.remove("d-none");

  // 最適パラメータを表示
  const bestParamsTable = document.getElementById("optimization-best-params");
  bestParamsTable.innerHTML = `
    <tr><td>短期移動平均線期間:</td><td>${data.bestParams.shortPeriod}</td></tr>
    <tr><td>長期移動平均線期間:</td><td>${data.bestParams.longPeriod}</td></tr>
  `;

  // パフォーマンスを表示
  const performanceTable = document.getElementById("optimization-performance");
  performanceTable.innerHTML = `
    <tr><td>利益率:</td><td class="${
      data.bestResult.profitPercent > 0 ? "text-success" : "text-danger"
    }">${data.bestResult.profitPercent.toFixed(2)}%</td></tr>
    <tr><td>利益額:</td><td>${data.bestResult.profit.toFixed(2)} USD</td></tr>
    <tr><td>取引回数:</td><td>${data.bestResult.totalTrades}</td></tr>
    <tr><td>勝率:</td><td>${data.bestResult.winRate.toFixed(2)}%</td></tr>
    <tr><td>最大ドローダウン:</td><td>${data.bestResult.maxDrawdownPercent.toFixed(
      2
    )}%</td></tr>
    <tr><td>プロフィットファクター:</td><td>${data.bestResult.profitFactor.toFixed(
      2
    )}</td></tr>
  `;

  // 結果テーブルを更新
  const resultsTable = document.getElementById("optimization-results-table");
  resultsTable.innerHTML = "";

  // 上位10件の結果を表示
  const topResults = data.allResults.slice(0, 10);
  for (const result of topResults) {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${result.params.shortPeriod}</td>
      <td>${result.params.longPeriod}</td>
      <td class="${
        result.profitPercent > 0 ? "text-success" : "text-danger"
      }">${result.profitPercent.toFixed(2)}%</td>
      <td>${result.winRate.toFixed(2)}%</td>
      <td>${result.trades}</td>
      <td>${result.profitFactor.toFixed(2)}</td>
      <td>${result.fitness.toFixed(2)}</td>
    `;
    resultsTable.appendChild(row);
  }

  // 結果までスクロール
  resultsCard.scrollIntoView({ behavior: "smooth" });
}

// 最適パラメータを適用
function applyBestParams() {
  const bestParamsTable = document.getElementById("optimization-best-params");
  if (!bestParamsTable) return;

  // テーブルから最適パラメータを取得
  const rows = bestParamsTable.getElementsByTagName("tr");
  if (rows.length < 2) return;

  const shortPeriod = rows[0].cells[1].textContent;
  const longPeriod = rows[1].cells[1].textContent;

  // バックテストタブに値を設定
  document.getElementById("param-short-period").value = shortPeriod;
  document.getElementById("param-long-period").value = longPeriod;

  // バックテストタブに切り替え
  const backtestTab = document.getElementById("backtest-tab");
  if (backtestTab) {
    backtestTab.click();
  }

  // 成功メッセージを表示
  alert(
    "最適パラメータを適用しました。バックテストを実行して結果を確認できます。"
  );
}
