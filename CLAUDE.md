# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

---

## プロジェクト概要

**VoiceForce**（Salesforce Voice Assistant）は、Salesforceをブラウザ上で音声操作する **Chrome拡張機能（Manifest V3）**。

- `Ctrl+Shift+V`（Mac: `Cmd+Shift+V`）でPush-to-Talk音声入力を開始
- 発話テキストを **二段階処理**（正規表現ルールエンジン → LLM意図解析）で解析
- 解析結果をもとに **Salesforce REST API** へ直接OAuth通信でCRUD操作を実行
- **Salesforceの顧客データは自前サーバーを一切経由しない**（発話テキストとメタデータのみ送信）
- バックエンドは **Cloudflare Workers**、LLMは **Claude Haiku**（第一候補）

詳細仕様は `DESIGN_DOC.md` に記載。**実装は DESIGN_DOC.md の Step 1〜16 の順に TDD で進める。**

GitHub リポジトリ: **https://github.com/iwasatat0107/voiceforce**（Public）

---

## GitHub MCP での開発方針

**このプロジェクトは GitHub MCP を使って開発する。**

コンテキスト節約のため、以下の操作は GitHub MCP のツールで行う（`gh` CLI や Bash は使わない）。

| 操作 | 使用するツール |
|------|-------------|
| リポジトリ作成・設定 | `mcp__github__create_repository` |
| Issue 作成・参照 | `mcp__github__create_issue` / `mcp__github__get_issue` |
| PR 作成・マージ | `mcp__github__create_pull_request` / `mcp__github__merge_pull_request` |
| ファイルのコミット・プッシュ | `mcp__github__push_files` / `mcp__github__create_or_update_file` |
| ブランチ作成 | `mcp__github__create_branch` |
| CI ステータス確認 | `mcp__github__get_pull_request` / `mcp__github__list_workflow_runs` |

**各 Step の完了時フロー（GitHub MCP）:**
1. feature ブランチに push（`mcp__github__push_files`）
2. PR を作成（`mcp__github__create_pull_request`）
3. CI 通過を確認
4. develop にマージ（`mcp__github__merge_pull_request`）

---

## CI/CD 絶対原則（必ず守ること）

### ルール一覧

| # | ルール | 理由 |
|---|-------|------|
| **R1** | **CI が赤の状態では新しい作業を始めない** | 赤の上に赤を重ねると根本原因が見えなくなる |
| **R2** | **PR は CI 全ジョブ（Lint・Test・Build）PASS を確認してからマージする** | 失敗中の PR をマージすると develop が壊れ、全員がブロックされる |
| **R3** | **セッション開始時に develop の CI 状態を確認する** | 前回セッションで CI が壊れたまま終わっていないかチェック |
| **R4** | **Lint エラーは発生したその PR で即修正する。次の PR に持ち越さない** | 今回の失敗の根本原因（13件のエラーが長期間放置された） |
| **R5** | **テストを「パスするように」書き換えることは禁止** | バグを隠すことになる。コード本体を修正すること |
| **R6** | **`git push --no-verify` は緊急時のみ。必ず直後に CI PASS を確認すること** | フックを無効化する場合はその責任を負う |

### セッション開始チェックリスト

```bash
# 1. develop の最新状態を取得
git fetch origin && git reset --hard origin/develop

# 2. ローカルで lint + test が通ることを確認
npm run lint    # エラー 0件であること（warning は許容）
npm test        # 全テスト PASS であること

# 3. GitHub の develop ブランチの CI が緑であることをブラウザで確認
#    https://github.com/iwasatat0107/voiceforce/commits/develop
```

もし手順 2 または 3 で失敗していたら、**新しい作業より先に修正する。**

### pre-push フック（自動安全装置）

`npm install`（または `npm run prepare`）を実行すると `.githooks/pre-push` が有効になり、
**lint エラーまたはテスト失敗がある状態ではプッシュ自体がブロックされる。**

```
git push → .githooks/pre-push 実行
             ├─ npm run lint  → エラーあり → プッシュ中断
             ├─ npm test      → 失敗あり   → プッシュ中断
             └─ 両方 OK       → プッシュ実行
```

フックが正しく設定されているか確認:
```bash
git config core.hooksPath   # → .githooks と表示されればOK
```

### CI が赤になったとき（インシデント対応）

```
1. 原因を特定する（gh run view でログを確認）
2. hotfix/fix-xxx ブランチを作成して修正
3. PR を作成 → CI PASS を確認 → develop にマージ
4. feature ブランチが進行中であれば develop を取り込む（git merge origin/develop）
5. 再発防止策を CLAUDE.md または テストに追加する
```

---

## 開発コマンド

```bash
# テスト
npm test                            # 全テスト実行（カバレッジ付き）
npm run test:unit                   # ユニットテストのみ
npm run test:integration            # 統合テストのみ
npm run test:e2e                    # E2Eテストのみ
npm run test:watch                  # ウォッチモード
npm run test:prompt                 # LLMプロンプト精度テスト（CIでは非実行・手動のみ）

# 単一ファイル実行
npx jest __tests__/unit/ruleEngine.test.js
npx jest --testNamePattern="「商談一覧」"

# Lint
npm run lint                        # ESLintチェック
npm run lint:fix                    # 自動修正

# ビルド・パッケージ
npm run build                       # dist/ にビルド
npm run package                     # Chrome Web Store用ZIP生成
```

---

## 技術スタック

| 領域 | 技術・バージョン |
|------|----------------|
| Chrome拡張 | Manifest V3、Content Scripts、Service Worker |
| 音声入力 | Web Speech API（`webkitSpeechRecognition`、`lang: 'ja-JP'`） |
| 認証 | OAuth 2.0 Authorization Code Flow、`chrome.identity.launchWebAuthFlow` |
| トークン管理 | AES-256暗号化、`chrome.storage.local`（暗号化保存）、`chrome.storage.session`（暗号化キー） |
| テスト | Jest（jsdom環境）、カバレッジ目標 branches:70% / functions・lines・statements:80% |
| Lint | ESLint（ES2021、browser + jest + webextensions） |
| バックエンド | Cloudflare Workers + Wrangler CLI、KV Storage（利用回数カウント） |
| LLM | Claude Haiku（第一候補）/ GPT-4o-mini（第二候補） |
| CI/CD | GitHub Actions（lint → test → build → package） |

---

## ディレクトリ構成

```
/
├── manifest.json                     # Chrome拡張MV3設定（permissions, commands, host_permissions）
├── background.js                     # Service Worker：認証ハブ、メッセージルーティング、トークンリフレッシュ
├── content.js                        # Content Script：音声認識、UIオーバーレイ、Salesforce操作
├── content.css                       # フローティングウィジェットCSS
├── popup.html                        # 設定ポップアップUI
├── popup.js                          # ポップアップロジック（接続状態・設定）
│
├── lib/                              # コアロジック（テスト対象：カバレッジ80%以上）
│   ├── auth.js                       # OAuthフロー、AES-256暗号化、トークンリフレッシュ
│   ├── speechRecognition.js          # Web Speech APIラッパー（Push-to-Talk、ja-JP）
│   ├── ruleEngine.js                 # QUICK_PATTERNSによる正規表現マッチング（LLMバイパス30-40%）
│   ├── intentResolver.js             # LLMリクエスト・レスポンスのホワイトリスト検証
│   ├── salesforceApi.js              # SOQL/SOSL検索、CRUD、エラーハンドリング
│   ├── recordResolver.js             # 検索結果件数（0/1/2-5/6+件）による分岐ロジック
│   ├── undoStack.js                  # update前の値を最大10件LIFO保持・復元
│   └── metadataManager.js            # SFオブジェクト/項目定義取得・日次キャッシュ
│
├── ui/                               # UIコンポーネント（テスト対象：カバレッジ80%以上）
│   ├── widget.js                     # フローティングウィジェット（待機/リスニング/処理中/確認/完了/エラーの6状態）
│   └── candidateList.js              # 音声番号選択対応の候補リストUI
│
├── icons/                            # 拡張機能アイコン（16px, 48px, 128px）
├── _locales/ja/messages.json         # i18n日本語リソース
│
├── __tests__/                        # テスト（Jestで実行）
│   ├── unit/                         # モジュール単体テスト
│   │   ├── ruleEngine.test.js
│   │   ├── intentResolver.test.js
│   │   ├── recordResolver.test.js
│   │   ├── undoStack.test.js
│   │   ├── metadataManager.test.js
│   │   ├── salesforceApi.test.js
│   │   ├── auth.test.js
│   │   └── speechRecognition.test.js
│   ├── integration/                  # クロスモジュール統合テスト
│   │   ├── voiceToAction.test.js
│   │   ├── updateSafety.test.js
│   │   └── freePlanLimit.test.js
│   ├── e2e/                          # E2Eテスト（URLパターン解析など）
│   │   ├── urlParsing.test.js
│   │   └── navigation.test.js
│   ├── prompt/                       # LLMプロンプト精度テスト（CIでは除外・手動実行）
│   │   └── intentClassification.test.js
│   ├── mocks/                        # テスト用モック
│   │   ├── chrome.js                 # chrome.* グローバルAPIモック
│   │   ├── salesforceResponses.js    # Salesforce APIレスポンスモック
│   │   └── llmResponses.js           # LLM APIレスポンスモック
│   └── setup.js                      # グローバルセットアップ（chrome globalの設定）
│
├── scripts/
│   ├── build.js                      # lib/・ui/・popup・content・background → dist/ にコピー
│   └── package.js                    # dist/ をZIPに圧縮
│
├── worker/                           # Cloudflare Workersバックエンド
│   └── index.js                      # POST /api/v1/analyze, GET /api/v1/usage
│
├── .github/workflows/
│   ├── ci.yml                        # lint → test → build → package（mainのみ）
│   └── deploy-worker.yml             # server/ 変更時にCloudflare Workersへデプロイ
│
├── jest.config.js
├── .eslintrc.js
├── package.json
└── .gitignore
```

---

## コーディング規約

### 基本方針

- **ES2021**、`const` / `let` のみ（`var` 禁止）
- `===` のみ（`==` 禁止）
- `async/await` を使用（`Promise.then` チェーンは避ける）
- モジュール単位で責務を分離し、`lib/` 配下は純粋なロジック層として実装

### セキュリティ必須ルール（ESLintで強制）

| ルール | 理由 |
|-------|------|
| `innerHTML` **禁止** → `textContent` / DOM API のみ | XSS防止（Content Script） |
| `eval` / `new Function()` / `no-script-url` **禁止** | 動的コード実行防止 |
| ユーザー入力は必ずエスケープしてからDOM操作 | XSS防止 |
| LLM出力JSONは必ずホワイトリスト検証後に実行 | プロンプトインジェクション防止 |
| update前に `LastModifiedDate` を確認して競合検知 | 同時編集による意図しない上書き防止 |

### LLMアウトプット検証（必須パターン）

```javascript
const VALID_ACTIONS = ['navigate', 'search', 'create', 'update', 'summary', 'unknown'];

function validateLLMOutput(json, metadata) {
  if (!VALID_ACTIONS.includes(json.action)) return false;          // actionホワイトリスト
  if (json.object && !metadata.objects.includes(json.object)) return false;  // object存在確認
  if (json.fields) {                                               // fieldsホワイトリスト
    const validFields = metadata.getFields(json.object);
    for (const key of Object.keys(json.fields)) {
      if (!validFields.includes(key)) return false;
    }
  }
  if (json.confidence < 0 || json.confidence > 1) return false;   // confidence範囲確認
  return true;
}
```

### ESLint設定（`.eslintrc.js`）

```javascript
module.exports = {
  env: { browser: true, es2021: true, jest: true, webextensions: true },
  extends: ['eslint:recommended'],
  parserOptions: { ecmaVersion: 'latest', sourceType: 'module' },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'eqeqeq': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error',
  },
  globals: { chrome: 'readonly', webkitSpeechRecognition: 'readonly' }
};
```

### コミットメッセージ規約

```
<type>(<scope>): <subject>

type: feat / fix / test / refactor / docs / chore / ci
scope: auth, metadata, speech, rule-engine, intent, record-resolver,
       undo, salesforce-api, widget, worker, ci

例:
  feat(auth): OAuth認証フローを実装
  test(rule-engine): navigateパターンのテストを追加
  fix(intent): confidence範囲外のバリデーション修正
```

---

## TDD方針

**全ての実装はテストを先に書いてから本体コードを書く（Red → Green → Refactor）。**

- テストフレームワーク：Jest（jsdom環境）
- カバレッジ目標：`lib/` と `ui/` 配下で branches:70% / functions・lines・statements:80% 以上
- `__tests__/prompt/` はCIでは除外し、ローカルで `npm run test:prompt` を手動実行
- LLMプロンプト精度目標：50件中45件以上正解（90%）

---

## Gitワークフロー（Git Flow）

```
main          ← Chrome Web Store公開版（release/* からのみマージ）
  ↑
develop       ← 開発統合ブランチ
  ↑
feature/*     ← 各Step実装（developから作成）
hotfix/*      ← 緊急修正（main + developにマージ）
release/*     ← リリース準備（develop → main）
```

### develop → main マージタイミング

**develop を main にマージするのは以下の2回のみ。**

| タイミング | ブランチ | 条件 | 目的 |
|-----------|---------|------|------|
| **Step 9 完了後** | `release/v0.0.1-beta` | Phase 1-A〜1-C 完了（音声→LLM→Salesforce の基本フローが動く） | 限定テスト配布・社内確認 |
| **Step 16 完了後** | `release/v0.1.0` | 全Step完了・プライバシーポリシー公開済み | Chrome Web Store 正式提出 |

**release ブランチのフロー（GitHub MCP）:**
```
1. develop から release/vX.X.X を作成（mcp__github__create_branch）
2. release/vX.X.X → main への PR を作成（mcp__github__create_pull_request）
3. CI 通過を確認
4. main にマージ（mcp__github__merge_pull_request）
5. release/vX.X.X → develop にも逆マージ（差分がある場合）
6. main に tag vX.X.X を打つ
```

### ブランチ命名

```
feature/step01-project-init      feature/step09-intent-resolver
feature/step02-oauth             feature/step10-record-resolver
feature/step03-metadata          feature/step11-update-safety
feature/step04-speech-recognition feature/step12-navigation
feature/step05-widget-ui         feature/step13-error-handling
feature/step06-rule-engine       feature/step14-test-verification
feature/step07-salesforce-api    feature/step15-privacy-policy
feature/step08-cloudflare-worker feature/step16-store-release
release/v0.0.1-beta
release/v0.1.0
```

---

## 実装順序（Step 1〜16）

DESIGN_DOC.md §22 に詳細な実装手順が記載されている。各Stepは TDD で実装し、PRを develop にマージしてから次のStepに進む。

| Phase | Step | ブランチ | 主な実装 |
|-------|------|---------|--------|
| 1-A | 1 | step01-project-init | 基盤構築、manifest.json、CI |
| 1-A | 2 | step02-oauth | `lib/auth.js`（OAuth + AES-256） |
| 1-A | 3 | step03-metadata | `lib/metadataManager.js` |
| 1-B | 4 | step04-speech-recognition | `lib/speechRecognition.js` |
| 1-B | 5 | step05-widget-ui | `ui/widget.js`, `content.css` |
| 1-B | 6 | step06-rule-engine | `lib/ruleEngine.js` |
| 1-B | 7 | step07-salesforce-api | `lib/salesforceApi.js` |
| 1-C | 8 | step08-cloudflare-worker | `worker/index.js` |
| 1-C | 9 | step09-intent-resolver | `lib/intentResolver.js` |
| 1-D | 10 | step10-record-resolver | `lib/recordResolver.js`, `ui/candidateList.js` |
| 1-D | 11 | step11-update-safety | `lib/undoStack.js`、確認フロー |
| 1-D | 12 | step12-navigation | navigate/backアクション実装 |
| 1-E | 13 | step13-error-handling | エラーハンドリング統合 |
| 1-E | 14 | step14-test-verification | 50件テストケース検証 |
| 1-E | 15 | step15-privacy-policy | プライバシーポリシー |
| 1-E | 16 | step16-store-release | Chrome Web Storeリリース |
