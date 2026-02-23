# VoiceForce トラブルシューティングガイド

**最終更新**: 2026-02-22
**対象バージョン**: v0.1.0〜

このドキュメントは、VoiceForce の開発・運用中に発生しやすい問題について、症状 → 原因 → 解決手順をまとめたものです。インシデント発生時はまずこのドキュメントを参照してください。

---

## 目次

1. [OAuth / 認証の問題](#1-oauth--認証の問題)
2. [音声ウィジェットが表示されない](#2-音声ウィジェットが表示されない)
3. [音声認識は動くが画面遷移しない](#3-音声認識は動くが画面遷移しない)
4. [dist/ とソースが乖離している（最重要）](#4-dist-とソースが乖離している最重要)
5. [音声が正確に認識されない](#5-音声が正確に認識されない)
6. [一般的なデバッグ手順](#6-一般的なデバッグ手順)
7. [開発後チェックリスト](#7-開発後チェックリスト)

---

## 1. OAuth / 認証の問題

### 1-1. 症状: 「未接続」になっている / 突然切断された

#### 確認手順

```
1. chrome://extensions/ → VoiceForce → 「サービスワーカー」の inspect をクリック
2. Console タブでエラーメッセージを確認
3. ポップアップを開き、接続ボタンを押してエラーを確認
```

#### 原因と解決

| エラーメッセージ | 原因 | 解決 |
|----------------|------|------|
| `invalid_client` | Consumer Key/Secret が間違っているか、Salesforce 側の設定が正しくない | [→ 1-2 参照](#1-2-invalid_client-エラー) |
| `Authorization page could not be loaded` | PKCE パラメータが抜けている | `lib/auth.js` の `startOAuth` で `code_challenge` が送られているか確認 |
| `Token exchange failed` | `dist/` が古い（ソース修正後にビルドしていない） | `npm run build` 実行後、拡張機能を再読み込み |
| `unauthorized sender` | 別の拡張機能からメッセージが送信された | 正常な保護動作。ユーザー操作からのメッセージは正しくルーティングされているか確認 |

---

### 1-2. `invalid_client` エラー

VoiceForce は **Salesforce External Client App（外部クライアントアプリケーション）** を使用しているため、認証には以下の **3条件がすべて必要** です。

```
✅ PKCE (code_challenge + code_challenge_method: 'S256')
✅ Consumer Secret を POST body に含める (client_secret=...)
✅ grant_type=authorization_code
```

#### 正しいトークンエクスチェンジのリクエスト形式

```
POST https://{instance}.salesforce.com/services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={authorization_code}
&client_id={consumer_key}
&client_secret={consumer_secret}       ← 必須（Basic Auth ヘッダーではなく body に）
&redirect_uri={callback_url}
&code_verifier={pkce_verifier}         ← 必須
```

#### よくある間違い

| 間違い | 正しい対応 |
|--------|----------|
| `Authorization: Basic base64(key:secret)` ヘッダーで送信 | body の `client_secret` パラメータで送信 |
| `code_verifier` を送らない | `startOAuth` で生成した verifier を `exchangeCodeForTokens` に渡す |
| `code_challenge_method: 'plain'` を使用 | `'S256'` を使用（SHA-256 ハッシュ） |

#### Salesforce 外部クライアントアプリ設定確認項目

```
Salesforce Setup → App Manager → VoiceForce → 編集
├── OAuth フロー: 有効化済みか
├── コールバック URL: https://{拡張機能ID}.chromiumapp.org/oauth
│   ※ 拡張機能 ID は chrome://extensions/ で確認
├── OAuth スコープ: 「API を利用してユーザーデータを管理」が含まれているか
└── アプリを有効化: オンになっているか
```

---

### 1-3. コールバック URL の確認

拡張機能 ID は Chrome のアップデートやプロファイル変更で変わることがあります。

```
コールバック URL = https://{拡張機能ID}.chromiumapp.org/oauth

拡張機能IDの確認:
chrome://extensions/ → VoiceForce → 「ID」フィールド
```

Salesforce 側の登録 URL と一致しているか確認してください。

---

## 2. 音声ウィジェットが表示されない

### 2-1. 症状: `Option+V` を押してもウィジェットが表示されない

#### 診断フロー

```
Option+V を押す
    │
    ├─ ショートカットキーが反応していない？
    │       → chrome://extensions/shortcuts でキーが設定されているか確認
    │
    ├─ background.js にメッセージが届いていない？
    │       → サービスワーカーの Console で TOGGLE_VOICE ログを確認
    │
    ├─ content.js が Salesforce ページで実行されていない？
    │       → DevTools → Console で「content.js is running」を確認
    │       → Salesforce URL が host_permissions に含まれているか確認
    │
    └─ createWidget() / createSpeechRecognition() / match() が undefined？
            → manifest.json の content_scripts のロード順を確認（→ 2-2 参照）
```

---

### 2-2. manifest.json の content_scripts ロード順

content.js は以下の関数をグローバル変数として参照します。これらは **content.js より前にロードされている必要** があります。

```json
"content_scripts": [{
  "matches": ["https://*.salesforce.com/*", ...],
  "js": [
    "lib/ruleEngine.js",        // match() を提供
    "lib/navigator.js",         // buildListUrl(), navigateTo(), goBack(), buildRecordUrl() を提供
    "lib/speechRecognition.js", // createSpeechRecognition() を提供
    "lib/salesforceApi.js",     // sosl() を提供
    "lib/recordResolver.js",    // resolve() を提供
    "ui/widget.js",             // createWidget() を提供
    "ui/candidateList.js",      // createCandidateList() を提供
    "content.js"                // ← 最後に読み込む（依存先が全て揃った後）
  ]
}]
```

> ⚠️ **いずれか 1 ファイルでもロードエラーになると、後続の content.js も読み込まれず Option+V が完全に無反応になります。**

**よくある間違い**:
- 新しい `lib/` または `ui/` ファイルを content.js から参照したが、manifest.json への追記を忘れた
- ファイルを追加したが `content.js` より後に記載してしまった

**自動検知**: `npx jest __tests__/unit/manifest.test.js` の `content_scripts 整合性` テスト群が
追記漏れを CI で検知します（インシデント #2 再発防止、2026-02-23 追加）。

**実機確認手順**（manifest.json を変更したら必須）:

```
① npm run build
② chrome://extensions/ → VoiceForce → ↻ リロード（アンロード→再ロードの方が確実）
③ Salesforce タブを Cmd+R でリロード
④ DevTools → Console でエラーがないことを確認
⑤ Option+V でウィジェットが開くことを確認
```

---

### 2-3. background.js の toggle-voice コマンドハンドラー

`chrome.commands.onCommand` リスナーは **必ず** コンテンツスクリプトへのメッセージ転送を実装していること。

```javascript
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_VOICE' });
      }
    });
  }
});
```

また、`manifest.json` の `permissions` に **`"tabs"` が含まれていること** を確認してください（`optional_permissions` ではなく `permissions`）。

---

## 3. 音声認識は動くが画面遷移しない

### 3-1. 症状: ウィジェットに発話が表示されるが、画面遷移が起きない

#### 診断フロー

```
発話がウィジェットに表示される
    │
    ├─ ruleEngine.match() が null を返している
    │       → DevTools Console で match('商談の一覧を表示してください') を実行
    │       → null なら → 3-2 パターンマッチング確認
    │
    ├─ match() が intent を返しているが navigate でない
    │       → intent.action の値を確認
    │
    ├─ filterName 付き navigate で Salesforce API エラー
    │       → Console の fetch エラーを確認
    │       → フォールバック（filterName なし URL）で遷移しているか確認
    │
    └─ buildListUrl() / navigateTo() が undefined
            → manifest.json の content_scripts に lib/navigator.js が含まれているか確認
```

---

### 3-2. ruleEngine.js パターンマッチング

`lib/ruleEngine.js` の QUICK_PATTERNS は以下の日本語パターンに対応しています。

#### 対応パターン一覧

| 発話例 | マッチするパターン | 結果 |
|--------|-----------------|------|
| 「商談」「商談の一覧」「商談リスト」 | オブジェクト一覧（フィルターなし） | navigate Opportunity list |
| 「商談を開いて」「商談出して」「商談を表示してください」 | 動詞付きオブジェクト | navigate Opportunity list |
| 「商談一覧を開いて」「商談の一覧を表示してください」 | 一覧指定 + 動詞 | navigate Opportunity list |
| 「すべての商談を開いて」「全ての商談」「商談の全てを表示して」 | All フィルター | navigate filterName: All |
| 「最近の商談を開いて」「最近参照した商談を表示して」 | RecentlyViewed フィルター | navigate filterName: RecentlyViewed |
| 「自分の商談を開いて」「商談の自分の分を表示して」 | MyOpportunities フィルター | navigate filterName: MyOpportunities |
| 「相談」 | Opportunity 誤認識マッピング | navigate Opportunity list |

#### 新しいパターンを追加する際の手順

```javascript
// 1. QUICK_PATTERNS に新しいオブジェクトを追加
{
  patterns: [
    /^新しいパターン$/,
  ],
  resolve: (m) => ({
    action: 'navigate',
    object: '...',
    target: 'list',
    confidence: 1.0,
    message: '...',
  }),
},

// 2. テストを追加
// __tests__/unit/ruleEngine.test.js に対応テストケースを追加

// 3. テスト実行
// npx jest __tests__/unit/ruleEngine.test.js

// 4. ビルド
// npm run build
```

---

## 4. `dist/` とソースが乖離している（最重要）

### 問題の背景

Chrome 拡張機能は **`dist/` ディレクトリ** からロードされています。ソースファイル（`lib/`, `ui/`, `background.js` など）を修正しても、`npm run build` を実行しなければ Chrome には反映されません。

### 症状

- ソースを修正したのに動作が変わらない
- コンソールで古いエラーが出続ける
- テストはパスするのに実機で動かない

### 解決手順（修正作業後は必ず実施）

```bash
# 1. ソース変更をビルド
npm run build

# 2. Chrome で拡張機能を再読み込み
# chrome://extensions/ → VoiceForce → 更新ボタン（↻）をクリック

# 3. Salesforce ページをリロード（Content Script を再実行させる）
# Salesforce のページで Cmd+R
```

### リモートとの同期が必要な場合（GitHub MCP マージ後）

```bash
git fetch origin && git reset --hard origin/develop
npm run build
# → Chrome 拡張を再読み込み
```

### 重要な `dist/` のルール

- `dist/` は `.gitignore` に **含まれない**（CI でビルドして Chrome Web Store に提出するため）
- ソースを直接 `dist/` に編集してはいけない（次の `npm run build` で上書きされる）
- PR マージ後に必ず手元で `npm run build` を実行する

---

## 5. 音声が正確に認識されない

### 5-1. Web Speech API の特性

VoiceForce は `webkitSpeechRecognition`（Web Speech API）を使用しており、以下の特性があります。

| 特性 | 詳細 |
|------|------|
| 言語設定 | `lang: 'ja-JP'` で日本語認識 |
| 認識モード | `interimResults: false`（最終結果のみ） |
| マイク | `continuous: false`（1発話で停止） |
| ノイズ | 静かな環境での認識精度が高い |

### 5-2. 誤認識されやすいパターンと対策

| 音声入力 | 誤認識例 | 対策 |
|---------|---------|------|
| 「商談」 | 「相談」 | ruleEngine で `'相談'` → `Opportunity` マッピング済み |
| 数字「いち」 | 「一」「1」 | ruleEngine で漢数字・算用数字両対応済み |
| 「OK」 | 「オッケー」「オーケー」 | confirm パターンで複数形式対応済み |

### 5-3. 認識率が低い場合のチェックリスト

```
□ マイクのアクセス許可が「許可」になっているか
  → chrome://settings/content/microphone

□ マイクデバイスが正しく選択されているか
  → Chrome の設定 → プライバシーとセキュリティ → サイトの設定 → マイク

□ 静かな環境で話しているか

□ はっきり・ゆっくり話しているか

□ 発話後に少し待っているか（認識完了のタイムラグがある）
```

### 5-4. 新しい音声パターンへの対応手順

1. `lib/ruleEngine.js` の `QUICK_PATTERNS` に追加
2. `__tests__/unit/ruleEngine.test.js` にテストケースを追加
3. `npm test` でテスト通過を確認
4. `npm run build` 後に実機確認

---

## 6. 一般的なデバッグ手順

### 6-1. コンソールログの場所

| コンポーネント | ログの確認場所 |
|-------------|-------------|
| Service Worker (background.js) | `chrome://extensions/` → VoiceForce → 「サービスワーカー」リンク → inspect |
| Content Script (content.js, lib/, ui/) | Salesforce ページの DevTools → Console |
| Popup (popup.js) | ポップアップを右クリック → 検証 → Console |

### 6-2. よく使うデバッグコマンド

Salesforce ページの DevTools Console で実行：

```javascript
// ruleEngine のパターンマッチングを直接確認
match('商談の一覧を表示してください')
// → { action: 'navigate', object: 'Opportunity', target: 'list', ... }

// navigator の URL 生成を確認
buildListUrl('https://example.my.salesforce.com', 'Opportunity')
// → 'https://example.my.salesforce.com/lightning/o/Opportunity/list'

// 現在ページの URL 解析
parseUrl(window.location.href)
// → { type: 'list', objectName: 'Opportunity', recordId: null }
```

### 6-3. chrome.storage の確認

```javascript
// Service Worker の inspect → Console で実行
chrome.storage.local.get(null, console.log)
// → { instance_url: '...', access_token_enc: '...', enc_iv: '...' }

// セッションストレージ（暗号化キー）
chrome.storage.session.get(null, console.log)
```

---

## 7. 開発後チェックリスト

ソースを修正して GitHub MCP でマージした後、必ず以下を実施してください。

```
□ npm run build を実行した
□ chrome://extensions/ → VoiceForce → 更新ボタンをクリックした
□ Salesforce ページをリロードした
□ ウィジェットが Option+V で開くことを確認した  ← 最重要: 無反応なら §2-1 参照
□ 「商談の一覧を表示してください」で画面遷移することを確認した
□ ポップアップで「接続済み」になっていることを確認した
```

### 修正内容別の追加確認

| 修正内容 | 追加確認 |
|---------|----------|
| `lib/auth.js` | 一度「接続を解除」してから再接続を試す |
| `manifest.json` | Chrome 拡張を **アンロード → 再ロード**（更新ボタンだけでは不十分な場合あり） |
| `manifest.json` の `content_scripts` に新ファイル追加 | `npx jest __tests__/unit/manifest.test.js` 実行 → Option+V 実機確認（§2-2 参照） |
| `content.js` に新グローバル関数依存を追加 | `manifest.test.js` の `REQUIRED_PROVIDERS` テーブルも更新する |
| `lib/ruleEngine.js` | `npx jest __tests__/unit/ruleEngine.test.js` でテストが通ることを確認 |
| `background.js` | サービスワーカーを inspect → 再起動 |
| `ui/widget.js` | ウィジェットの 6 状態（idle/listening/processing/confirm/success/error）を目視確認 |

> **⚠️ インシデント #2 教訓（2026-02-23）**: `manifest.json` の `content_scripts` を変更した際に
> 上記手順を省略すると Option+V が完全に無反応になります。
> 詳細は [`docs/incident-report-2026-02.md`](./incident-report-2026-02.md) 「インシデント #2」を参照。

---

## 関連ドキュメント

- [`docs/incident-report-2026-02.md`](./incident-report-2026-02.md) — 2026年2月 OAuth・音声ナビゲーション障害 ポストモーテム
- [`docs/manual-test-guide.md`](./manual-test-guide.md) — 手動テスト手順書
- [`DESIGN_DOC.md`](../DESIGN_DOC.md) — 設計仕様書
