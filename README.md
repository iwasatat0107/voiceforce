# VoiceForce — Salesforce Voice Assistant

Chrome拡張機能（Manifest V3）でSalesforceを音声操作するOSSプロジェクト。

## 概要

- `Ctrl+Shift+V`（Mac: `Cmd+Shift+V`）でPush-to-Talk音声入力を開始
- 発話テキストを **二段階処理**（正規表現ルールエンジン → LLM意図解析）で解析
- 解析結果をもとに **Salesforce REST API** へ直接OAuth通信でCRUD操作を実行
- **Salesforceの顧客データは自前サーバーを一切経由しない**（発話テキストとメタデータのみ送信）
- バックエンドは **Cloudflare Workers**、LLMは **Claude Haiku**（第一候補）

## 技術スタック

| 領域 | 技術 |
|------|------|
| Chrome拡張 | Manifest V3、Content Scripts、Service Worker |
| 音声入力 | Web Speech API（`webkitSpeechRecognition`、`lang: 'ja-JP'`） |
| 認証 | OAuth 2.0 Authorization Code Flow |
| トークン管理 | AES-256暗号化、`chrome.storage.local` |
| テスト | Jest（jsdom環境） |
| バックエンド | Cloudflare Workers |
| LLM | Claude Haiku |
| CI/CD | GitHub Actions |

## 開発コマンド

```bash
# 依存関係インストール
npm install

# テスト
npm test                  # 全テスト実行（カバレッジ付き）
npm run test:unit         # ユニットテストのみ
npm run test:watch        # ウォッチモード

# Lint
npm run lint              # ESLintチェック
npm run lint:fix          # 自動修正

# ビルド
npm run build             # dist/ にビルド
npm run package           # Chrome Web Store用ZIP生成
```

## ディレクトリ構成

```
/
├── manifest.json         # Chrome拡張MV3設定
├── background.js         # Service Worker
├── content.js            # Content Script
├── lib/                  # コアロジック
│   ├── auth.js
│   ├── ruleEngine.js
│   ├── intentResolver.js
│   ├── salesforceApi.js
│   └── ...
├── ui/                   # UIコンポーネント
├── worker/               # Cloudflare Workers
└── __tests__/            # テスト
```

## ライセンス

MIT
