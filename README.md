# VoiceForce — Salesforce Voice Assistant

Salesforce を**音声だけで操作**できる Chrome 拡張機能（Manifest V3）。

キーボードショートカット一つで音声入力を開始し、「商談一覧を開いて」「田中商事の金額を500万に更新して」といった自然な日本語で、画面遷移・検索・レコード作成・更新などを実行できます。

> **Disclaimer:** 本ソフトウェアは現状有姿（as-is）で提供されます。利用に起因するいかなる損害についても作者は責任を負いません。バグ報告や改善提案は [Issues](https://github.com/iwasatat0107/voiceforce/issues) にて歓迎しています。

---

## デモ

<!-- TODO: スクリーンショットまたはGIFを追加 -->

```
ユーザー: 「商談一覧を開いて」
  ↓ 正規表現ルールエンジンで即座にマッチ（LLM不要）
  ↓ Salesforce Lightning の商談一覧ページへ遷移

ユーザー: 「田中商事の商談の金額を500万にして」
  ↓ Cloudflare Workers 経由で Claude Haiku が意図解析
  ↓ Salesforce REST API で該当レコードを検索
  ↓ 「田中商事_商談 の金額を 5,000,000 に更新しますか？」と確認
  ↓ 「はい」で更新実行（undo 対応）
```

---

## 特徴

- **二段階の意図解析** — 正規表現ルールエンジンが30〜40%の発話を即座に処理。残りのみ LLM（Claude Haiku）へ送信し、コスト削減とレイテンシ改善を両立
- **顧客データの安全性** — Salesforce REST API へ Chrome 拡張から直接 OAuth 通信。自前サーバーに顧客データは一切経由しない
- **AES-256-GCM トークン暗号化** — アクセストークン/リフレッシュトークンを暗号化して `chrome.storage.local` に保存。暗号化鍵は `chrome.storage.session`（揮発性）に保持
- **音声による候補選択** — 検索結果が複数件の場合、候補リストを表示し「2番」と音声で選択可能
- **更新の安全機構** — `LastModifiedDate` による楽観的排他制御 + undo スタック（最大10件）で誤操作を防止

---

## アーキテクチャ

```
Chrome 拡張 (Manifest V3)
┌──────────────────────────────────────────────────────┐
│                                                      │
│  音声入力 (Web Speech API)                            │
│       ↓                                              │
│  ルールエンジン (正規表現)  ── 一致 → 即時実行          │
│       ↓ 不一致                                       │
│  Cloudflare Workers ── Claude Haiku で意図解析        │
│       ↓                                              │
│  レコード解決 (0件/1件/2-5件/6件+)                    │
│       ↓                                              │
│  Salesforce REST API (OAuth 2.0 直接通信)             │
│                                                      │
└──────────────────────────────────────────────────────┘
```

**ポイント:** 発話テキストとオブジェクトメタデータのみ Cloudflare Workers へ送信。顧客の実データ（レコード名、金額等）はブラウザ ↔ Salesforce 間で直接やり取りされ、外部サーバーを経由しません。

---

## 技術スタック

| 領域 | 技術 | 選定理由 |
|------|------|----------|
| **Chrome 拡張** | Manifest V3 / Service Worker | 最新の拡張機能仕様。MV2 は 2024年に廃止 |
| **音声認識** | Web Speech API (`ja-JP`) | ブラウザネイティブ、追加ライブラリ不要 |
| **認証** | OAuth 2.0 Authorization Code Flow | Salesforce 標準。`chrome.identity.launchWebAuthFlow` で安全に実装 |
| **トークン暗号化** | AES-256-GCM (`crypto.subtle`) | ブラウザ標準 API。外部暗号ライブラリ不要 |
| **バックエンド** | Cloudflare Workers + KV | エッジ実行で低レイテンシ。レート制限と利用回数管理に KV を活用 |
| **LLM** | Claude Haiku (Anthropic API) | 高速・低コスト。日本語の意図解析に優れる |
| **テスト** | Jest (jsdom + node) | ユニット/統合/E2E テスト。カバレッジ branches 87%+, lines 99%+ |
| **Lint** | ESLint (ES2021) | セキュリティルール強制（`innerHTML` 禁止、`eval` 禁止等） |
| **CI/CD** | GitHub Actions | lint → test → build → package の自動パイプライン |

---

## プロジェクト構成

```
voiceforce/
├── manifest.json              # Chrome 拡張設定 (MV3)
├── background.js              # Service Worker: 認証・メッセージルーティング
├── content.js                 # Content Script: 音声認識・UI・Salesforce操作
├── content.css                # フローティングウィジェット CSS
├── popup.html / popup.js      # 設定ポップアップ UI
│
├── lib/                       # コアロジック層
│   ├── auth.js                #   OAuth + AES-256-GCM トークン暗号化
│   ├── speechRecognition.js   #   Web Speech API ラッパー (トグル音声入力)
│   ├── ruleEngine.js          #   正規表現パターンマッチング
│   ├── intentResolver.js      #   LLM レスポンスのホワイトリスト検証
│   ├── salesforceApi.js       #   SOQL/SOSL 検索・CRUD 操作
│   ├── recordResolver.js      #   検索結果の件数分岐 (0/1/2-5/6+件)
│   ├── undoStack.js           #   更新前の値を LIFO 保持・復元
│   ├── navigator.js           #   Lightning URL 構築・画面遷移
│   └── metadataManager.js     #   SF オブジェクト定義の取得・キャッシュ
│
├── ui/                        # UI コンポーネント
│   ├── widget.js              #   6状態フローティングウィジェット
│   └── candidateList.js       #   音声番号選択対応の候補リスト
│
├── worker/                    # Cloudflare Workers バックエンド
│   └── index.js               #   POST /api/v1/analyze, GET /api/v1/usage
│
├── __tests__/                 # テスト (582件)
│   ├── unit/                  #   モジュール単体テスト
│   ├── integration/           #   音声→アクション統合テスト
│   ├── e2e/                   #   URL パターン解析テスト
│   └── prompt/                #   LLM プロンプト精度テスト (手動実行)
│
├── scripts/                   # ビルド・パッケージスクリプト
├── docs/                      # プライバシーポリシー (GitHub Pages)
└── .github/workflows/         # CI/CD パイプライン
```

---

## セキュリティ対策

Chrome Web Store 公開に向けて実施したセキュリティ強化:

| 対策 | 内容 |
|------|------|
| **送信者検証** | `chrome.runtime.onMessage` で `sender.id` を検証し、自拡張以外からのメッセージを拒否 |
| **OAuth CSRF 防止** | `state` パラメータを生成・検証し、リダイレクト改竄を防止 |
| **instanceUrl 検証** | OAuth リダイレクト先を Salesforce 公式ドメインのみに制限 |
| **CORS ホワイトリスト** | Worker の `Access-Control-Allow-Origin` を環境変数で制御 |
| **LLM 出力検証** | アクション・オブジェクト・フィールドをホワイトリストで検証後に実行 |
| **XSS 防止** | `innerHTML` 完全禁止（ESLint で強制）。全 UI は `textContent` / DOM API のみ |
| **入力サイズ制限** | text: 5,000字、metadata: 100,000字の上限で DoS を防止 |
| **プロンプトインジェクション対策** | メタデータをサニタイズし、`<metadata>` タグで構造的に分離 |
| **明示的 CSP** | `script-src 'self'; object-src 'self'` で外部スクリプト実行を禁止 |
| **トークン暗号化** | AES-256-GCM で暗号化保存。鍵は揮発性ストレージに保持 |

---

## 開発方法

### 必要環境

- Node.js 20 以上
- npm

### セットアップ

```bash
git clone https://github.com/iwasatat0107/voiceforce.git
cd voiceforce
npm install
```

### コマンド一覧

```bash
npm test                 # 全テスト実行（カバレッジ付き）
npm run test:unit        # ユニットテストのみ
npm run test:integration # 統合テストのみ
npm run test:watch       # ウォッチモード
npm run lint             # ESLint チェック
npm run lint:fix         # ESLint 自動修正
npm run build            # dist/ にビルド
npm run package          # Chrome Web Store 用 ZIP 生成
```

### Chrome にインストール（開発用）

1. `npm run build` で `dist/` を生成
2. Chrome で `chrome://extensions` を開く
3. 「デベロッパーモード」を有効化
4. 「パッケージ化されていない拡張機能を読み込む」→ `dist/` フォルダを選択

---

## テスト

**582 テスト** がユニット・統合・E2E の3層で構成されています。

```
カバレッジ:
  Branches:   87.74%
  Functions:  100%
  Lines:      99.04%
  Statements: 98.96%
```

TDD（テスト駆動開発）で全ステップを実装。テストを先に書いてから本体コードを実装しています。

---

## 開発プロセス

Git Flow ベースのブランチ戦略で、16 ステップ + セキュリティ強化を段階的に実装:

| Phase | 内容 |
|-------|------|
| **1-A** | 基盤構築・OAuth 認証・メタデータ管理 |
| **1-B** | 音声認識・ウィジェット UI・ルールエンジン・Salesforce API |
| **1-C** | Cloudflare Workers・LLM 意図解析 |
| **1-D** | レコード解決・更新安全機構・画面遷移 |
| **1-E** | エラーハンドリング・テスト検証・プライバシーポリシー・リリース |
| **Security** | Chrome Web Store 公開前セキュリティ強化（11件） |

全ステップで PR ベースのコードレビューと CI パイプライン通過を徹底しています。

---

## ライセンス

本リポジトリはオープンソースとして公開しています。ソースコードの閲覧・学習目的での参照は自由ですが、複製・再配布・商用利用は許可していません。

利用は自己責任でお願いいたします。本ソフトウェアの利用に起因するいかなる損害についても、作者は責任を負いません。

バグ報告・改善提案・ご意見等は [Issues](https://github.com/iwasatat0107/voiceforce/issues) にて大歓迎です。

Copyright (c) 2026 iwasatat0107. All rights reserved.
