# Changelog

全ての注目すべき変更はこのファイルに記載されます。
フォーマットは [Keep a Changelog](https://keepachangelog.com/ja/1.0.0/) に基づき、バージョニングは [Semantic Versioning](https://semver.org/lang/ja/) に従います。

---

## [0.1.0] - 2026-02-21

### 概要

VoiceForce の初回リリース。Salesforce を音声で操作する Chrome 拡張機能（Manifest V3）。

### 追加機能

#### 音声入力
- `Alt+V` による Push-to-Talk 音声入力（Web Speech API、`ja-JP`）
- 3秒無音タイムアウトで自動停止
- 中間テキストのリアルタイム表示

#### 認識・意図解析
- **QUICK_PATTERNS ルールエンジン**：正規表現パターンによる高速マッチング（LLM 呼び出しの 30–40% をバイパス）
- **LLM 意図解析**：Claude Haiku を第一候補とした意図解析（Cloudflare Workers バックエンド経由）
- LLM 出力 JSON のホワイトリスト検証（action / object / fields / confidence）

#### Salesforce 操作
- **検索**：SOSL / SOQL によるレコード検索
- **ナビゲーション**：一覧・レコード・新規作成ページへの長履URL遷移、前画面に戻る
- **CRUD**：レコードの作成・更新・削除（`LastModifiedDate` 競合検知付き）
- **候補リスト**：複数件ヒット時の音声番号選択対応

#### 認証・セキュリティ
- OAuth 2.0 Authorization Code Flow (`chrome.identity.launchWebAuthFlow`)
- アクセストークン・リフレッシュトークンの AES-256-GCM 暗号化保存
- `innerHTML` 禁止（XSS 防止）、DOM API のみ使用

#### UI
- フローティングウィジェット：待機 / リスニング / 処理中 / 確認 / 完了 / エラーの 6 状態
- 候補リスト UI（音声番号選択対応）
- 日本語 UI ローカライゼーション

#### エラーハンドリング
- ネットワーク / Salesforce API / Worker / 音声認識エラーの統一分類
- 日本語ユーザーメッセージ
- 無料プラン利用制限通知

#### バックエンド
- Cloudflare Workers：`POST /api/v1/analyze`、`GET /api/v1/usage`
- 利用回数カウンタ（Cloudflare KV）

#### その他
- Salesforce メタデータの日次キャッシュ
- アンドスタック（最大 10 件、LIFO）による更新旧値保存
- プライバシーポリシー（GitHub Pages 公開）

### 制限・既知の問題

- 音声認識は Chrome / Edge（Chromium ベース）のみ対応
- Salesforce Classic は未対応（Lightning Experience のみ）
- LLM 意図解析の精度指標：プロンプトテスト 50 件中 45 件以上正解目標

---

## リンク

- [GitHub Repository](https://github.com/iwasatat0107/voiceforce)
- [プライバシーポリシー](https://iwasatat0107.github.io/voiceforce/privacy-policy.html)
