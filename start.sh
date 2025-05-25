#!/bin/bash

# 必要なディレクトリを作成
mkdir -p logs

# パッケージをインストール
npm install

# アプリケーションを起動
echo "ビットコイン自動取引アプリを起動しています..."
npm run dev 