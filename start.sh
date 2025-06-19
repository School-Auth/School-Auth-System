#!/bin/bash

# school-auth-systemの依存関係をインストールし、アプリケーションを起動するスクリプト

# エラーが発生した場合にスクリプトを終了する
set -e

echo "---"
echo "school-auth-systemのセットアップを開始します。"
echo "---"

# Node.jsのバージョンチェック
REQUIRED_NODE_VERSION="18"
CURRENT_NODE_VERSION=$(node -v | cut -d 'v' -f 2 | cut -d '.' -f 1)

if [ "$CURRENT_NODE_VERSION" -lt "$REQUIRED_NODE_VERSION" ]; then
  echo "エラー: Node.jsのバージョンが ${REQUIRED_NODE_VERSION}.0.0 以上である必要があります。"
  echo "現在のバージョン: $(node -v)"
  echo "Node.jsをアップグレードしてから再度実行してください。"
  exit 1
fi

echo "Node.jsのバージョンは要件を満たしています。（現在のバージョン: $(node -v)）"

# 依存関係のインストール
echo "---"
echo "npm依存関係をインストールしています..."
npm install

if [ $? -ne 0 ]; then
  echo "エラー: npm依存関係のインストールに失敗しました。"
  exit 1
fi
echo "npm依存関係のインストールが完了しました。"

# アプリケーションの起動
echo "---"
echo "school-auth-systemを起動します..."
echo "アプリケーションを停止するには、Ctrl+Cを押してください。"
npm start

if [ $? -ne 0 ]; then
  echo "エラー: school-auth-systemの起動に失敗しました。"
  exit 1
fi

echo "---"
echo "school-auth-systemが正常に実行されています。"
echo "---"
