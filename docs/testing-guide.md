# VoiceForce テストガイド

> **このドキュメントの目的**: VoiceForce の開発・改善を担う人が「何をどうテストするか」を迷わないための指針。音声入力はこのプロダクトの肝であり、テストの設計もそれを中心に据える。

---

## 目次

1. [テスト戦略の全体像](#1-テスト戦略の全体像)
2. [音声テストの設計方針（最重要）](#2-音声テストの設計方針最重要)
3. [テスト層ごとの詳細](#3-テスト層ごとの詳細)
4. [TDD ワークフロー](#4-tdd-ワークフロー)
5. [テストコマンド早見表](#5-テストコマンド早見表)
6. [既知のパターンと落とし穴](#6-既知のパターンと落とし穴)
7. [バグ修正履歴から学んだこと](#7-バグ修正履歴から学んだこと)
8. [音声認識精度の継続的改善](#8-音声認識精度の継続的改善)

---

## 1. テスト戦略の全体像

### テストピラミッド

```
          ┌─────────────────────────┐
          │    手動テスト（実機）     │  ← 音声 → テキスト変換の精度確認
          │  (Salesforce + マイク)   │     リリース前のみ
          ├─────────────────────────┤
          │  Playwright（55件）      │  ← 発話テキスト → action → widget
          │  Chrome拡張 E2E テスト   │     モック注入で CI 自動化
          ├─────────────────────────┤
          │  Jest（582件）           │  ← 全ビジネスロジック
          │  Unit / Integration / E2E│     決定論的・高速・CI自動化
          └─────────────────────────┘
```

### 各層の責任範囲

| 層 | ツール | 件数 | カバー範囲 | CI |
|---|---|---|---|---|
| Unit / Integration | Jest | 582件 | ruleEngine・intent・auth・CRUD・undo | ✅ 自動 |
| Chrome 拡張 E2E | Playwright | 55件 | 音声モック→widget・popup UI | ✅ 自動 |
| 音声認識精度 | 手動 / 録音WAV | 14件 | マイク → Google API → テキスト | ❌ 手動のみ |

### なぜこの構成か

音声プロダクトのテスト自動化には根本的な制約がある（詳細は [§2](#2-音声テストの設計方針最重要)）。
この制約を踏まえ「自動化できる部分を完全に自動化し、できない部分を最小化する」方針をとる。

---

## 2. 音声テストの設計方針（最重要）

### 2.1 webkitSpeechRecognition のテスト可能範囲

音声入力パイプライン全体を以下のように分解する：

```
[マイク入力]
    ↓
[webkitSpeechRecognition]  ← Chrome が Google Speech API にリアルタイム通信
    ↓
[transcript（テキスト）]   ← ここより下はすべて自動テスト可能
    ↓
[ruleEngine.match()]       ← Jest + Playwright でカバー
    ↓
[intent（action オブジェクト）]
    ↓
[Salesforce 操作 / ナビゲーション]
```

**結論: 「マイク → テキスト変換」のみ自動化不可。それ以外は完全に自動テストできる。**

### 2.2 音声ファイルを使ったテストは使えないか？

試した結果：**Chrome の `--use-file-for-fake-audio-capture` フラグは webkitSpeechRecognition に効かない。**

```
# 検証結果（2026-02）
getUserMedia（MediaRecorder 等）: ✅ fake audio が届く
webkitSpeechRecognition:          ❌ タイムアウト（Chrome 内部の別パスを使用）
```

Chrome の `webkitSpeechRecognition` は `getUserMedia` とは独立した内部音声キャプチャパスを使っており、`--use-file-for-fake-audio-capture` フラグの影響を受けない。

**仮想オーディオデバイスを使う方法（macOS: BlackHole）は理論上可能だが：**
- OS レベルのセットアップが必要
- CI 環境での再現が困難
- Google Speech API への実通信が必要でテスト結果が非決定的

→ 現時点では採用しない。手動テストで代替。

### 2.3 モック注入による音声テスト（採用方式）

```javascript
// webkitSpeechRecognition をモックに差し替える
window.webkitSpeechRecognition = MockSpeechRecognition;

// テストから「発話テキスト」を直接注入
window.__triggerSpeech('商談一覧を開いて');

// 以降の全パイプラインを実際の Chrome 拡張上で検証
expect(result.action).toBe('navigate');
expect(result.object).toBe('Opportunity');
```

この方式で「テキスト以降のロジック全体」を Chrome 拡張の実環境上で自動検証できる。
ruleEngine のパターン追加・変更は必ずこのテストで検証する。

### 2.4 録音 WAV ファイルの活用

`__tests__/audio/` に 14 件の WAV ファイルが保存されている。
自動テストには使えないが、**手動スモークテスト時の参考発話として活用する**。

```bash
# 音声ファイルを再生して認識精度を耳で確認
afplay __tests__/audio/navigate-opportunity-list.wav
# → Chrome で同じように発話して一致するか確認

# WAV ファイルを再生成する場合（macOS のみ）
node scripts/generate-test-audio.js
```

収録フレーズ一覧：

| ファイル | 発話 | 期待 action |
|---|---|---|
| `navigate-opportunity-list.wav` | 商談一覧を開いて | navigate Opportunity |
| `navigate-account-list.wav` | 取引先一覧を開いて | navigate Account |
| `navigate-lead-list.wav` | リード一覧を開いて | navigate Lead |
| `navigate-contact-list.wav` | 取引先責任者一覧を開いて | navigate Contact |
| `navigate-opportunity-all.wav` | すべての商談を開いて | navigate Opportunity (All) |
| `navigate-opportunity-recent.wav` | 最近参照した商談を開いて | navigate Opportunity (RecentlyViewed) |
| `navigate-opportunity-mine.wav` | 自分の商談を開いて | navigate Opportunity (MyOpportunities) |
| `command-back.wav` | 戻って | back |
| `command-yes.wav` | はい | confirm true |
| `command-no.wav` | いいえ | confirm false |
| `command-undo.wav` | 元に戻して | undo |
| `command-stop.wav` | 止めて | stop |
| `command-select-1.wav` | 1番 | select index:1 |
| `command-select-3.wav` | 3番 | select index:3 |

---

## 3. テスト層ごとの詳細

### 3.1 Jest ユニットテスト（`__tests__/unit/`）

各モジュールの責務を独立して検証する。

```bash
npm test                              # 全テスト
npx jest __tests__/unit/ruleEngine.test.js   # 単一ファイル
npx jest --testNamePattern="商談"           # 名前でフィルター
```

**重要モジュールとテスト観点:**

| モジュール | 主なテスト観点 |
|---|---|
| `ruleEngine.js` | 全パターンマッチング・誤認識語・null返却 |
| `intentResolver.js` | LLM出力のホワイトリスト検証・不正JSON拒否 |
| `auth.js` | PKCE生成・AES-256暗号化・トークンリフレッシュ |
| `salesforceApi.js` | SOQL実行・CRUD・エラーハンドリング・レート制限 |
| `recordResolver.js` | 0件/1件/2-5件/6+件の分岐ロジック |
| `undoStack.js` | LIFO 10件保持・restore・LastModifiedDate競合検知 |
| `navigator.js` | URL生成・URL解析・buildListUrl の filterId |
| `widget.js` | 6状態遷移の合法/違法パターン |

### 3.2 Jest 統合テスト（`__tests__/integration/`）

複数モジュールをまたぐシナリオを検証する。

| ファイル | テスト内容 |
|---|---|
| `voiceToAction.test.js` | 発話 → ruleEngine → Salesforce API の End-to-End |
| `updateSafety.test.js` | update 前の LastModifiedDate 確認・競合検知 |
| `freePlanLimit.test.js` | 月次利用上限・カウンターロジック |

### 3.3 Playwright Chrome 拡張テスト（`__tests__/playwright/`）

実際の Chrome 拡張環境で動作を検証する。

```bash
npx playwright test                   # 全 Playwright テスト
npx playwright test voice.test.js     # 音声モックテストのみ
npx playwright test --headed          # ブラウザを表示しながら実行
npx playwright test --debug           # デバッグモード（ステップ実行）
```

**テストファイルと内容:**

| ファイル | 件数 | テスト内容 |
|---|---|---|
| `voice.test.js` | 37件 | 音声モック注入・ruleEngine パターン（navigate/command/unknown）・widget 状態遷移 |
| `popup.test.js` | 10件 | ポップアップ表示・接続フォーム・エラー表示・切断 |
| `widget.test.js` | 8件 | ruleEngine パターン・buildListUrl・confirmパターン |

**モック注入の仕組み（`voice.test.js` の `MOCK_SPEECH_SCRIPT`）:**

```javascript
// addInitScript でページ初期化時に注入
// webkitSpeechRecognition を MockSpeechRecognition で置き換え
// 3つのヘルパー関数を提供:
window.__triggerSpeech(transcript, isFinal)  // onresult を発火
window.__triggerSpeechError(errorType)        // onerror を発火
window.__triggerSpeechEnd()                   // onend を発火
```

### 3.4 LLM プロンプト精度テスト（`__tests__/prompt/`）

```bash
npm run test:prompt    # 手動のみ・CI 除外
```

- 実際に Claude Haiku API を呼び出す
- 50件テストケース中 45件以上正解（90%）が目標
- コスト・時間がかかるため PR ごとには実行しない

### 3.5 手動テスト（`docs/manual-test-guide.md`）

実機（Salesforce + マイク）でしか確認できない項目：

1. 音声 → テキスト変換の認識精度
2. マイク権限ダイアログの挙動
3. Salesforce 上での実際のナビゲーション
4. OAuth フロー（PKCE）の完全動作

---

## 4. TDD ワークフロー

### 基本サイクル

```
1. Red:    テストを書く（失敗することを確認）
2. Green:  最小限の実装でテストを通す
3. Refactor: コードを整理（テストは通ったまま）
```

### 音声機能を追加するときの手順

例: 「商談を検索して」という新しい発話パターンを追加する場合

**Step 1: ruleEngine のテストを先に書く（Red）**

```javascript
// __tests__/unit/ruleEngine.test.js に追加
test('「商談を検索して」→ search Opportunity', () => {
  const result = match('商談を検索して');
  expect(result).not.toBeNull();
  expect(result.action).toBe('search');
  expect(result.object).toBe('Opportunity');
});
```

```bash
npx jest ruleEngine.test.js  # → 失敗することを確認
```

**Step 2: ruleEngine.js に実装する（Green）**

```javascript
// lib/ruleEngine.js の QUICK_PATTERNS に追加
{
  patterns: [
    new RegExp(`^(${OBJECT_NAMES})(を)?検索(して|する|してください)?$`),
  ],
  resolve: (m) => ({
    action: 'search',
    object: LABEL_TO_API_EXTENDED[m[1]],
    confidence: 1.0,
  }),
},
```

```bash
npx jest ruleEngine.test.js  # → 通ることを確認
```

**Step 3: Playwright テストにも追加する（実機確認）**

```javascript
// __tests__/playwright/voice.test.js に追加
test('音声→ruleEngine: 「商談を検索して」→ search Opportunity', async () => {
  const page = await setupPage();
  const result = await page.evaluate(async (p) => {
    return new Promise((resolve) => {
      const sr = createSpeechRecognition({
        onResult: (t) => resolve(window.match(t)),
      });
      sr.start();
      window.__triggerSpeech(p);
    });
  }, '商談を検索して');
  expect(result.action).toBe('search');
  await page.close();
});
```

**Step 4: 手動で実際に発話して確認する**

```
Option+V → 「商談を検索して」
→ ウィジェットが「処理中」になるか確認
→ 意図した動作が行われるか確認
```

### ruleEngine パターン追加チェックリスト

新しい発話パターンを追加するたびに必ず確認：

- [ ] `__tests__/unit/ruleEngine.test.js` にテスト追加（先に書く）
- [ ] 類似パターンとの競合チェック（既存テストが壊れていないか）
- [ ] `__tests__/playwright/voice.test.js` の `NAVIGATE_CASES` または `COMMAND_CASES` に追加
- [ ] WAV ファイルを生成（`scripts/generate-test-audio.js` に追記 → 再実行）
- [ ] 手動で実際に発話して認識精度を確認
- [ ] 誤認識パターンも `LABEL_TO_API_EXTENDED` に追加

---

## 5. テストコマンド早見表

```bash
# ── Jest ──────────────────────────────────────────────────────
npm test                              # 全テスト（カバレッジ付き）
npm run test:unit                     # ユニットテストのみ
npm run test:integration              # 統合テストのみ
npm run test:watch                    # ウォッチモード（開発中）
npx jest --testNamePattern="商談"     # 名前でフィルター
npx jest --coverage                   # カバレッジ詳細

# ── Playwright ────────────────────────────────────────────────
npx playwright test                   # 全 Playwright テスト
npx playwright test voice.test.js     # 音声モックテストのみ
npx playwright test popup.test.js     # popup テストのみ
npx playwright test --headed          # ブラウザ表示
npx playwright test --debug           # ステップ実行
npx playwright show-report            # HTML レポート表示

# ── 音声ファイル ──────────────────────────────────────────────
node scripts/generate-test-audio.js  # WAV ファイル再生成（macOS）
afplay __tests__/audio/navigate-opportunity-list.wav  # 再生して確認

# ── ビルド・パッケージ ────────────────────────────────────────
npm run build                         # dist/ に出力
npm run lint                          # ESLint チェック
npm run package                       # Chrome Web Store 用 ZIP
```

---

## 6. 既知のパターンと落とし穴

### 6.1 Chrome 拡張テスト環境の制約

**問題**: Playwright テストは headless 不可。

```javascript
// playwright.config.js
use: { headless: false }  // Chrome 拡張は headless では動作しない
```

**問題**: 拡張機能スクリプトは `chrome-extension://` スキームから読み込む必要がある。

```javascript
// popup.html を開いてから拡張機能の JS を動的ロード
await page.goto(`chrome-extension://${extensionId}/popup.html`);
await page.evaluate(async (id) => {
  const s = document.createElement('script');
  s.src = `chrome-extension://${id}/lib/ruleEngine.js`;
  document.head.appendChild(s);
  await new Promise(r => s.addEventListener('load', r));
}, extensionId);
```

### 6.2 CSS transition と getComputedStyle

**問題**: CSS に `transition: border-color 0.15s` があると、`getComputedStyle` がトランジション前の値を返す。

```javascript
// ❌ NG: トランジション中は期待値と異なる
const color = await el.evaluate(el => window.getComputedStyle(el).borderColor);

// ✅ OK: インラインスタイルを直接読む（トランジション影響なし）
const color = await el.evaluate(el => el.style.borderColor);
```

### 6.3 Jest から Playwright テストを除外する

**問題**: Jest は `__tests__/playwright/` も走らせようとして失敗する（`@playwright/test` は Jest 環境で動かない）。

```javascript
// jest.config.js
testPathIgnorePatterns: [
  '/node_modules/',
  '__tests__/prompt/',    // LLM テスト（手動のみ）
  '__tests__/playwright/' // ← 必須: Playwright テストは npx playwright test で実行
],
```

### 6.4 jsdom 環境の制限

Jest は jsdom 環境で動くが、以下は提供されない：

```javascript
// __tests__/setup.js で補完が必要
import { webcrypto } from 'node:crypto';
import { TextEncoder, TextDecoder } from 'node:util';

// crypto.subtle が必要（AES-256 テスト）
Object.defineProperty(globalThis, 'crypto', { value: webcrypto });

// TextEncoder/TextDecoder が必要
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder;
```

**Cloudflare Worker テスト** は `Request`/`Response` が必要なため jsdom では動かない：

```javascript
// worker テストファイルの先頭に書く
/** @jest-environment node */  // Node.js 18+ はネイティブ Fetch API を持つ
```

### 6.5 ruleEngine パターンのキャプチャグループ番号

`resolve(m)` の中で参照する `m[n]` のインデックスはパターンによって変わる。

```javascript
// 例: ^(すべて|全て|全部)(の)?(${OBJECT_NAMES})(を)?...
// m[1] = "すべて"|"全て"|"全部"
// m[2] = "の" | undefined
// m[3] = オブジェクト名（"商談" など）
const obj = LABEL_TO_API_EXTENDED[m[3]] || LABEL_TO_API_EXTENDED[m[1]];
```

パターンを変更したときはキャプチャグループ番号のズレに注意。テストを先に書いてから実装すれば確実に気づける。

### 6.6 lib/ モジュールのエクスポートパターン

`lib/` の関数は Service Worker（`importScripts`）とブラウザと Node.js（Jest）の3環境で動く必要がある。

```javascript
// ファイル末尾に必ず書く
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { match, QUICK_PATTERNS, LABEL_TO_API };
}
```

関数はアロー関数ではなく通常の `function` 宣言で書く（`importScripts` 環境でグローバルに公開されるため）。

---

## 7. バグ修正履歴から学んだこと

テストを書いたことで発見・修正されたバグの記録。

### 7.1 ruleEngine: `私の商談一覧` がマッチしなかった（PR #50）

**原因**: `^(私の)(商談)(を)?${VERB}?${SUFFIX}$` のパターンが「一覧」を消化できなかった。

```javascript
// 修正前
new RegExp(`^(自分|私|自分の|私の)(${OBJECT_NAMES})(を)?${VERB}?${SUFFIX}$`),

// 修正後: (一覧|リスト)? を追加
new RegExp(`^(自分|私|自分の|私の)(${OBJECT_NAMES})(一覧|リスト)?(を)?${VERB}?${SUFFIX}$`),
```

**教訓**: 「商談一覧を開いて」と「私の商談一覧」の両方を NAVIGATE_CASES に含めること。ユーザーは「一覧」を末尾につけたりつけなかったりする。

### 7.2 navigator.js: `buildListUrl` が filterId を無視していた（PR #50）

**原因**: 第3引数が実装されていなかった。

```javascript
// 修正前
function buildListUrl(instanceUrl, objectName) {
  return `${instanceUrl}/lightning/o/${objectName}/list`;
}

// 修正後
function buildListUrl(instanceUrl, objectName, filterId) {
  const base = `${instanceUrl}/lightning/o/${objectName}/list`;
  return filterId ? `${base}?filterName=${filterId}` : base;
}
```

**教訓**: URL 生成関数のテストには引数ありとなし両方のケースを含める。

### 7.3 background.test.js: `startOAuth` の引数不一致（PR #49）

**原因**: `background.js` が `startOAuth(clientId, instanceUrl, clientSecret)` と3引数で呼ぶのに対し、テストが2引数しか期待していなかった。

```javascript
// 修正後（メッセージに clientSecret がない場合は undefined）
expect(global.startOAuth).toHaveBeenCalledWith(
  'test_client',
  'https://login.salesforce.com',
  undefined  // ← 追加
);
```

**教訓**: 関数シグネチャが変わったときは関連するすべてのテストを確認する。特に省略可能な引数は `undefined` も明示してテストする。

### 7.4 content_scripts の読み込み順序（PR #46）

**原因**: `manifest.json` の `content_scripts` で依存 JS（ruleEngine.js 等）が後から読み込まれていた。

**修正**: 依存関係順に並べる。

```json
"content_scripts": [{
  "js": [
    "lib/ruleEngine.js",      // 先に読む
    "lib/navigator.js",
    "lib/speechRecognition.js",
    "ui/widget.js",
    "content.js"              // 最後に読む
  ]
}]
```

**教訓**: Chrome 拡張の content_scripts は宣言順に読み込まれる。依存関係のあるファイルは先に書く。

### 7.5 OAuth PKCE + body secret（PR #44）

**原因**: Salesforce External Client App は Basic Auth ではなく `client_secret` を POST body に含める必要がある。

**教訓**: 外部 API の認証方式が変わったらテストのモックも同期的に更新する。認証フローは `auth.test.js` で必ず統合テストを書く。

---

## 8. 音声認識精度の継続的改善

### 8.1 誤認識パターンの管理

Google Speech API は同音異義語を間違えることがある。よくある誤認識は `LABEL_TO_API_EXTENDED` で吸収する。

```javascript
// lib/ruleEngine.js
const LABEL_TO_API_EXTENDED = {
  ...LABEL_TO_API,
  '相談': 'Opportunity',  // 「商談」→「相談」の誤認識対応
  // 新しい誤認識が見つかったらここに追加する
};
```

**新しい誤認識を発見したときの対応手順:**

1. `ruleEngine.test.js` に誤認識パターンのテストを書く（先に書く）
2. `LABEL_TO_API_EXTENDED` または `QUICK_PATTERNS` に追加
3. テストが通ることを確認
4. WAV ファイルを追加（`scripts/generate-test-audio.js` に追記）
5. 手動で実際に発話して確認

### 8.2 精度目標

| 対象 | 目標 | 測定方法 |
|---|---|---|
| ruleEngine マッチング | 対応発話の 100% | Jest（自動） |
| LLM intent 解析 | 50件中 45件以上（90%） | `npm run test:prompt`（手動） |
| 手動テスト発話 | 10件中 9件以上 | `manual-test-guide.md` |

### 8.3 新しい Salesforce オブジェクトへの対応

新しいオブジェクト（例: ケース、商品、見積）を追加するときは必ず以下を更新：

- [ ] `lib/ruleEngine.js` の `OBJECT_NAMES` と `LABEL_TO_API`
- [ ] `__tests__/unit/ruleEngine.test.js` に新オブジェクトのテスト追加
- [ ] `__tests__/playwright/voice.test.js` の `NAVIGATE_CASES` に追加
- [ ] `scripts/generate-test-audio.js` に WAV 生成エントリを追加
- [ ] `docs/manual-test-guide.md` の手動テスト項目に追加

---

## 付録: テスト環境セットアップ

```bash
# 依存関係インストール
npm install

# Playwright ブラウザインストール
npx playwright install chromium

# 音声ファイル生成（macOS のみ）
node scripts/generate-test-audio.js

# ビルド（テスト前に必要）
npm run build

# 全テスト実行
npm test
npx playwright test
```

---

*最終更新: 2026-02-23*
*関連: `docs/manual-test-guide.md` / `docs/release-checklist.md` / `__tests__/setup.js`*
