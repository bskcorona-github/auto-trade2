# ビットコイン自動取引アプリ

## 概要

このアプリケーションは、バイナンス API を使用したビットコイン自動取引システムです。複数の取引戦略、バックテスト機能、リスク管理機能を備えています。

## 機能

- 複数の取引戦略の実装と自動選択
- バックテスト機能（グラフ表示付き）
- リスク管理（最大損失設定、ポジションサイジング）
- リアルタイム取引実行
- シンプルなダッシュボード UI

## インストール方法

```bash
# リポジトリのクローン
git clone [リポジトリURL]
cd bitcoin-auto-trading

# 依存パッケージのインストール
npm install

# 環境変数の設定
cp .env.example .env
# .envファイルを編集してAPI鍵などを設定

# 開発サーバーの起動
npm run dev
```

## 環境変数設定

アプリケーションの設定は`.env`ファイルで管理されます。以下の設定が必要です：

```
# Binance API設定
BINANCE_API_KEY=your_api_key_here
BINANCE_API_SECRET=your_api_secret_here

# 取引設定
MAX_DAILY_LOSS=100 # ドル
MAX_WEEKLY_LOSS=500 # ドル
MAX_MONTHLY_LOSS=1000 # ドル
POSITION_SIZE_PERCENT=1 # 資金の何%を1トレードに使用するか

# バックテスト設定
BACKTEST_START_DATE=2023-01-01
BACKTEST_END_DATE=2023-12-31

# システム設定
PORT=3000
NODE_ENV=development
```

※Web UI 上からも API 設定を行うことができます。

## 使用方法

1. バイナンスの API キーとシークレットを`.env`ファイルに設定
2. 取引戦略とリスク管理設定をカスタマイズ
3. バックテストで戦略の有効性を検証
4. 少額からテスト運用を開始

## 開発優先順位

1. バックテストシステム（グラフ機能付き）
2. 基本的な取引戦略実装
3. 資金保護・緊急停止機能
4. シンプルな UI・ダッシュボード
5. 戦略学習・最適化機能
