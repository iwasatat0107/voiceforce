# インシデントレポート: OAuth 認証障害・音声ナビゲーション障害

**日時**: 2026-02-20 〜 2026-02-22
**重大度**: High（音声入力機能が完全に停止）
**状態**: 解決済み
**担当**: iwasatat0107

---

## 1. 概要

Playwright 自動テスト実装後から、VoiceForce Chrome 拡張機能の以下の機能が連鎖的に停止した。

1. **OAuth 認証が失敗**（`invalid_client` エラー）
2. **音声ウィジェットが表示されない**（`Option+V` が無反応）
3. **音声コマンドで画面遷移しない**（認識はされるが遷移なし）

最終的に 4 つの根本原因が特定され、PR #41・#44・#45・#46・#47 で解決した。

---

## 2. タイムライン

| 日時 | 出来事 |
|------|--------|
| 2026-02-20 以前 | OAuth 接続・音声入力・画面遷移がすべて正常動作 |
| 2026-02-20 | Playwright 自動テストを実装・マージ（Step 14 相当） |
| 2026-02-20 〜 21 | 拡張機能の接続試行 → `invalid_client` エラーが継続発生 |
| 2026-02-22 朝 | インシデント調査開始 |
| 2026-02-22 | PR #41: background.js で clientSecret が渡っていないことを発見・修正 |
| 2026-02-22 | PR #42: PKCE 不使用を試みる → `Authorization page could not be loaded` で悪化 |
| 2026-02-22 | PR #43: PKCE のみ（secret なし）を試みる → `invalid_client` 継続 |
| 2026-02-22 | PR #44: PKCE + clientSecret を body に含める → **OAuth 接続成功** |
| 2026-02-22 | `npm run build` 忘れが発覚 → dist/ 同期後に認証が確認できることを検証 |
| 2026-02-22 | PR #45: background.js の toggle-voice ハンドラーが空（TODO）だったことを発見・修正 |
| 2026-02-22 | PR #46: manifest.json の content_scripts に依存ファイルが未記載だったことを発見・修正 |
| 2026-02-22 | PR #47: ruleEngine.js のパターンが「してください」等に対応していないことを発見・修正 |
| 2026-02-22 夕 | 「商談の一覧を表示してください」で画面遷移成功 → **全機能復旧** |

---

## 3. 根本原因分析

### 根本原因 1: `background.js` — `clientSecret` が `startOAuth` に渡っていなかった

**ファイル**: `background.js` の `CONNECT_SALESFORCE` ハンドラー

**問題のコード**:
```javascript
// 修正前
const { clientId, instanceUrl } = message;  // clientSecret が欠落
startOAuth(clientId, instanceUrl);          // clientSecret が undefined
```

**修正後**:
```javascript
const { clientId, clientSecret, instanceUrl } = message;
startOAuth(clientId, instanceUrl, clientSecret);
```

**発生原因**: 実装当初に `clientSecret` 対応が後から追加された際、destructuring だけ追加して関数呼び出しへの引数追加を漏らした。テストではモックで誤魔化されており、実機でのみ問題が顕在化していた。

**PR**: #41

---

### 根本原因 2: `dist/` のビルド未実施

**問題**: Chrome 拡張は `dist/` からロードされるが、ソース修正後に `npm run build` が実行されていなかった。そのため `dist/background.js` は古いコードのままだった。

**発生原因**: 日常的な開発フローにおいて「ソース修正 → ビルド → 拡張機能再読み込み」の手順が省略されがちなため。

**教訓**: ソースを修正したら **必ず** `npm run build` → 拡張機能の再読み込みを行う。これを怠ると、いくらソースを修正しても動作が変わらない。

---

### 根本原因 3: Salesforce External Client App は PKCE + body secret の両方が必須

**ファイル**: `lib/auth.js`

**背景**: Salesforce の「外部クライアントアプリケーション」は通常の Connected App とは異なる OAuth 要件を持つ。

**試行錯誤の記録**:

| 試した方式 | 結果 | 理由 |
|-----------|------|------|
| PKCE なし + secret なし | `Authorization page could not be loaded` | PKCE が必須のため認証画面が表示されない |
| PKCE のみ（secret なし） | `invalid_client` | Secret が必須 |
| PKCE + Basic Auth ヘッダー（`Authorization: Basic base64(key:secret)`） | `invalid_client` | Salesforce は body 渡しのみ対応 |
| PKCE + secret を body に含める（`client_secret=...`） | **認証成功** | 正しい方式 |

**正しいトークンエクスチェンジ**:
```
POST /services/oauth2/token
Content-Type: application/x-www-form-urlencoded

grant_type=authorization_code
&code={code}
&client_id={consumer_key}
&client_secret={consumer_secret}   ← body に含める（Basic Auth ではない）
&redirect_uri={callback_url}
&code_verifier={pkce_verifier}     ← PKCE 必須
```

**PR**: #44

---

### 根本原因 4: `background.js` — `toggle-voice` コマンドハンドラーが実装されていなかった

**ファイル**: `background.js`

**問題のコード**:
```javascript
chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    // TODO: implement
  }
});
```

**修正後**:
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

また `manifest.json` の `permissions` に `"tabs"` が `optional_permissions` 側にあったため、`chrome.tabs.query` が動作しなかった。

**PR**: #45

---

### 根本原因 5: `manifest.json` — content_scripts に依存ファイルが未記載

**ファイル**: `manifest.json`

**問題**: `content.js` は `createWidget()`、`createSpeechRecognition()`、`match()`、`buildListUrl()`、`navigateTo()`、`goBack()` をグローバル関数として参照するが、これらを提供するファイルが `content_scripts` に記載されていなかった。

**修正前**:
```json
"js": ["content.js"]
```

**修正後**:
```json
"js": [
  "lib/ruleEngine.js",
  "lib/navigator.js",
  "lib/speechRecognition.js",
  "ui/widget.js",
  "content.js"
]
```

**発生原因**: ファイル分割してモジュール化した際に、`manifest.json` への追記を忘れた。Chrome 拡張の content scripts はモジュールシステムを持たないため、依存ファイルを明示的に列挙する必要がある。

**PR**: #46

---

### 根本原因 6: `ruleEngine.js` — 日本語パターンが不十分

**ファイル**: `lib/ruleEngine.js`

**問題**: 「商談の一覧を表示してください」「商談のすべてを表示してください」などの自然な日本語がマッチしなかった。

**追加した対応**:
- `SUFFIX = '(してください|ください|て)?'` — 丁寧語末尾
- `VERB = '(出して|開いて|見せて|表示して|表示|開く|開け)'` — 動詞バリエーション
- All / RecentlyViewed / MyOpportunities フィルターパターン
- 「相談」→ `Opportunity` 誤認識マッピング

**PR**: #47

---

## 4. 影響範囲

| 機能 | 影響 |
|------|------|
| OAuth 認証 | 新規接続が不可能（既存トークンは有効だったが、セッション終了後に再認証不可） |
| 音声ウィジェット表示 | `Option+V` が無反応 |
| 音声コマンドでの画面遷移 | 認識はされるが遷移しない |
| ポップアップ UI | 正常動作 |
| バックグラウンドのトークンリフレッシュ | 影響なし |

---

## 5. 再発防止策

### 即時対応（実施済み）

| 対策 | 実施内容 | PR |
|------|---------|----|
| clientSecret 渡し漏れ修正 | background.js の destructuring と関数呼び出しを修正 | #41 |
| OAuth 方式を正式仕様に固定 | PKCE + body secret の方式に統一 | #44 |
| toggle-voice ハンドラー実装 | chrome.tabs.query でコンテンツスクリプトにメッセージを転送 | #45 |
| manifest.json の依存関係を修正 | content_scripts に全依存ファイルを追加 | #46 |
| ruleEngine パターン拡張 | 自然な日本語パターンに対応 | #47 |
| トラブルシューティングガイド作成 | docs/troubleshooting.md を作成 | — |

### 中長期的な対策（今後の実装時に注意）

#### (1) ビルド忘れ防止

開発フローに `npm run build` を組み込む。ソースを修正したら必ずビルドすること。

```bash
# 推奨フロー
git fetch origin && git reset --hard origin/develop  # リモート同期
npm run build                                         # ビルド
# chrome://extensions/ → 更新                        # 拡張機能再読み込み
```

#### (2) manifest.json の content_scripts チェック

新しい `lib/` または `ui/` ファイルを作成したとき、`manifest.json` の `content_scripts.js` への追記を忘れない。追加する際は `content.js` より前に記載する。

#### (3) OAuth の動作確認テスト

auth.js を修正した際は、必ず以下の手順で実機確認する。

```
1. 「接続を解除」で既存の接続を切断
2. Consumer Key と Secret を入力して「Salesforceに接続」
3. Salesforce の認証画面が表示されることを確認
4. 許可後、「接続済み」になることを確認
5. Option+V で音声ウィジェットが開くことを確認
```

#### (4) ruleEngine のテスト駆動開発

音声パターンを追加・変更する際は、必ずテストを先に書く（TDD）。

```bash
npx jest __tests__/unit/ruleEngine.test.js --watch
```

#### (5) TODO コメントを残さない

`// TODO: implement` が残っているコードは、テストでは検出されにくい。コードレビュー時に TODO が残っていないか確認する。

---

## 6. 学んだこと（Lessons Learned）

1. **Chrome 拡張の `dist/` は常に最新を維持する**: ソース修正 = 即ビルド。これを忘れると調査に多大な時間を費やす。

2. **Salesforce External Client App は PKCE + body secret が必須**: Connected App との違いを認識していなかったことで、試行錯誤に時間を要した。

3. **Chrome 拡張の content scripts はロード順が重要**: ES Module ではなく、グローバルスコープへの逐次ロードであるため、依存関係の順序管理を手動で行う必要がある。

4. **TODO コメントは未完成のコード**: 実装が完了するまでは動作確認ができない。ステップをマージする前に TODO が残っていないか確認する。

5. **実機テストはテストコードで代替できない部分がある**: Jest テストはモック環境のため、Chrome API の連携（permissions、manifest.json の設定、コンテンツスクリプトのロード順）はカバーできない。実機での動作確認を必ずセットで行う。

---

## 7. 関連 PR

| PR | 内容 |
|----|------|
| #41 | fix(background): clientSecret を startOAuth に渡すよう修正 |
| #44 | fix(auth): PKCE + clientSecret body 方式に統一 |
| #45 | fix(background): toggle-voice コマンドハンドラーを実装 |
| #46 | fix(manifest): content_scripts に依存ファイルを追加 |
| #47 | fix(rule-engine): 日本語音声パターン拡張（してください/フィルター対応） |

---

## 8. 参照ドキュメント

- [`docs/troubleshooting.md`](./troubleshooting.md) — 症状別トラブルシューティングガイド
- [`docs/manual-test-guide.md`](./manual-test-guide.md) — 手動テスト手順書
- [Salesforce External Client App OAuth Documentation](https://developer.salesforce.com/docs/platform/external-client-apps/guide/eca-overview.html)

---

---

# インシデント #2: content_scripts 新スクリプト追加後 Option+V 無反応

**日時**: 2026-02-23
**重大度**: High（音声入力機能が完全に停止）
**状態**: 解決済み / 再発防止策実装済み
**担当**: iwasatat0107
**関連 PR**: #57

---

## 1. 概要

レコード検索機能実装（PR #57）で `manifest.json` の `content_scripts` に
`salesforceApi.js`, `recordResolver.js`, `candidateList.js` の 3 ファイルを追加した直後、
Salesforce 画面で `Option+V` を押しても音声ウィジェットが一切開かなくなった。

---

## 2. タイムライン

| 時刻 | 出来事 |
|------|--------|
| 実装中 | PR #57 で manifest.json content_scripts に 3 ファイル追加、Jest 605件・Playwright 98件が PASS |
| マージ後 | ユーザーが Salesforce 画面で Option+V → ウィジェット表示なし |
| 調査開始 | ソース・dist/ の差分確認、構文チェック、ビルド確認 → コード自体は正常 |
| 解決 | `npm run build` → `chrome://extensions/` リロード → Salesforce タブリロードの 3 ステップ実施 |

---

## 3. 根本原因分析

### 根本原因 A: 同一パターンの再発（前回インシデント §根本原因 2・5 の再発）

前回インシデント（2026-02-22）で既に記録されていた以下 2 点が再発した。

| 前回の教訓 | 再発した理由 |
|-----------|-------------|
| `dist/` のビルド未実施（§根本原因 2） | manifest.json 変更後の 3 ステップ手順（ビルド→拡張リロード→タブリロード）が習慣化されていなかった |
| manifest.json への依存ファイル追記漏れ（§根本原因 5） | 新 content script 追加時に "追加しても壊れないか" を自動テストで確認する仕組みがなかった |

### 根本原因 B: content_scripts ロード失敗の検知テストが未実装

Jest・Playwright のいずれにも「manifest.json の content_scripts に列挙された全ファイルが
正常にロードされ、content.js が依存するグローバル関数が全て定義されているか」を
検証するテストが存在しなかった。

新スクリプトのいずれかがロードエラーになると、後続の `content.js` も読み込まれず、
`TOGGLE_VOICE` メッセージリスナーが登録されない。結果として `Option+V` が完全に無反応になる。

### 根本原因 C: 自動テスト環境と実機環境の乖離

Playwright テストは `popup.html`（`chrome-extension://`）コンテキストで実行され、
実際の Salesforce ページへの content script 注入は検証されない。
このため、manifest.json の変更が実機で問題を起こしても CI では検知できなかった。

---

## 4. 影響範囲

| 機能 | 影響 |
|------|------|
| 音声ウィジェット（Option+V） | 完全停止（ウィジェット表示なし） |
| navigate / back / search / select 全アクション | 完全停止 |
| OAuth 認証・ポップアップ | 影響なし |

---

## 5. 対処手順（実施済み）

```bash
npm run build
# → chrome://extensions/ → VoiceForce → ↻ リロード
# → Salesforce タブを Cmd+R でリロード
# → Option+V でウィジェットが開くことを確認
```

---

## 6. 再発防止策（実装済み）

### (1) manifest.test.js に content_scripts 整合性テストを追加（PR #57 追加分）

`content.js` が依存するグローバル関数の提供元ファイルが全て `content_scripts` に
列挙されているかを CI で自動検証する。

```javascript
// __tests__/unit/manifest.test.js に追加済み
test.each(Object.entries(REQUIRED_PROVIDERS))(
  'content.js の依存 %s (%s) が content_scripts に含まれている',
  (file) => { expect(scripts).toContain(file); }
);
```

**効果**: 今後 content.js に新しいグローバル依存を追加した際、
manifest.json への追記漏れを CI が即座に検知する。

### (2) Playwright テスト7 を追加（PR #57 追加分）

全 content_scripts ロード後に全グローバル関数が定義されているか、
および widget idle→listening 遷移（Option+V の核心フロー）が
動作するかを自動検証する。

```
テスト7-1: 全 content_scripts ロード後 — content.js 依存グローバル関数が全て定義されている
テスト7-2: Option+V 核心フロー — widget が idle→listening に遷移し SR が起動できる
```

### (3) troubleshooting.md を更新

- §2-2 を現在の content_scripts 定義（7 ファイル）に更新
- §7 チェックリストに manifest.json 変更時の専用確認項目を追加

---

## 7. 学んだこと（Lessons Learned）

1. **過去のインシデントレポートを実装前に読む**: 前回の教訓が記録されていたにも関わらず同じパターンが再発した。新規 content script を追加する前に `docs/incident-report-2026-02.md` の §根本原因 2・5 を参照する。

2. **「動くテストが全て通る」は「実機で動く」を意味しない**: content scripts のロード順・manifest.json の整合性は Jest/Playwright のモック環境では検証できない。manifest.json を変更したら必ず 3 ステップ（ビルド→拡張リロード→タブリロード）を実施する。

3. **再発防止は "ドキュメント化" だけでは不十分**: 前回も同じ教訓がドキュメントに残っていたが、開発者が参照しなかった。今回追加した `manifest.test.js` の自動テストのように、**人が判断する余地なく CI が強制的に検知する仕組み**を作ることが本質的な再発防止になる。

4. **3 ステップを必ず守る**: manifest.json / content_scripts を変更したら以下を省略しない。

```
① npm run build
② chrome://extensions/ → 拡張機能を ↻ リロード  ← アンロード→再ロードの方が確実
③ Salesforce タブを Cmd+R でリロード
④ Option+V で動作確認
```

---

---

# インシデント #3: 音声検索が「認識: ...」で止まる・トークンエラー

**日時**: 2026-02-24 〜 2026-02-25
**重大度**: High（音声検索機能が完全に動作しない）
**状態**: 解決済み / 再発防止策実装済み
**担当**: iwasatat0107
**関連 PR**: #62〜#66, #67

---

## 1. 概要

「ABC株式会社を表示して」「ABC株式会社を検索して」と発話しても以下の問題が発生した。

1. **ウィジェットに「認識: ABC株式会社を表示して」と表示される**（intent が null）
2. **「VFトークンの取得に失敗しました」エラー**（SW が終了済みのため）
3. **sosl is not defined**（manifest.json に salesforceApi.js が未記載）

---

## 2. タイムライン

| 出来事 | 対応 PR |
|--------|---------|
| 「を検索して」フレーズが ruleEngine にマッチしない | #66 |
| manifest.json に salesforceApi.js / recordResolver.js / candidateList.js が未記載 → sosl is not defined | #67 |
| SW が発話認識中（~10秒）に idle 終了 → GET_VALID_TOKEN 失敗 | #67 |
| background.js で sendResponse 後に chrome.runtime.lastError が未確認 | #66 |

---

## 3. 根本原因分析

### 根本原因 A: ruleEngine の VERB に「検索して」「探して」が未登録

音声認識が返す文字列に「を検索して」「を探して」が含まれるケースがあったが、
`VERB = '(出して|開いて|見せて|表示して|表示|開く|開け)'` に含まれていなかった。

**なぜ VERB に追加しなかったか**: VERB を navigate パターンと共用しているため、
「商談を検索して」が誤って navigate にマッチする危険があった。
**修正**: search ブロック専用の別パターンとして追加。

```javascript
// lib/ruleEngine.js — オブジェクト指定なし検索ブロックに追加
new RegExp('^(.+?)を(検索|探)(して|してください)?$'),
```

### 根本原因 B: manifest.json に salesforceApi.js / recordResolver.js / candidateList.js が未記載

SOSL 検索を実装した際（PR #65）、`content.js` に `sosl()`, `resolve()` の呼び出しを追加したが
`manifest.json` の `content_scripts` への追記を忘れた。

**なぜ CI が検知できなかったか**: `manifest.test.js` の `REQUIRED_PROVIDERS` テーブルに
これらのファイルが含まれていなかった。

**修正**:
1. `manifest.json` の `content_scripts.js` に 3 ファイルを追加
2. `manifest.test.js` の `REQUIRED_PROVIDERS` に 3 エントリを追加

**これはインシデント #2 と全く同一パターンの再発。**
新しいグローバル関数依存を `content.js` に追加したら **必ず** `REQUIRED_PROVIDERS` を更新すること。

### 根本原因 C: MV3 Service Worker が発話認識中に idle 終了

MV3 の Service Worker はブラウザが ~30 秒の無活動を検知すると強制終了する。

```
Option+V（押下）→ SW が TOGGLE_VOICE を転送 → SW の活動が終了
  ↓（SW の idle タイマー開始）
ユーザーが話す（5〜15 秒）
  ↓（SW の idle タイマーが ~30 秒で切れる）
音声認識結果 → GET_VALID_TOKEN 送信 → SW が終了済み
  → "The message channel closed before a response was received"
```

一覧ナビゲーション（「取引先一覧を表示して」）は SW を呼ばないため影響を受けない。
検索のみが影響を受けた。

**修正**: content.js でリスニング開始時に 10 秒ごとに `STAY_ALIVE` を送信して SW を起こし続ける。

```javascript
// content.js
const startKeepalive = function() {
  if (keepaliveTimer) return;
  keepaliveTimer = setInterval(() => {
    chrome.runtime.sendMessage({ type: 'STAY_ALIVE' }).catch(() => {});
  }, 10000); // Chrome の idle タイマー（~30秒）より十分短い
};
```

```javascript
// background.js
case 'STAY_ALIVE':
  sendResponse({ success: true });
  return false;
```

### 根本原因 D: background.js で sendResponse 後の chrome.runtime.lastError が未確認

非同期 `sendResponse` 呼び出し後、送信先（content script）がすでにいない場合、
Chrome が `chrome.runtime.lastError` をセットするが未確認だったため
"Unchecked runtime.lastError" 警告が発生していた。

**修正**: 全非同期 sendResponse 後に `void chrome.runtime.lastError` を追加。

---

## 4. 再発防止策（実装済み）

| 対策 | 実装内容 |
|------|---------|
| REQUIRED_PROVIDERS 更新 | salesforceApi.js, recordResolver.js, candidateList.js を追加 |
| SW keepalive テスト追加 | テスト3-search-9 で setInterval + STAY_ALIVE の動作を検証 |
| SOSL フローテスト追加 | テスト3-search-6/7/8 で 0件/1件/複数件の分岐を検証 |
| STAY_ALIVE ユニットテスト追加 | background.test.js で同期応答を検証 |

---

## 5. 学んだこと（Lessons Learned）

1. **content.js に新しいグローバル依存を追加したら REQUIRED_PROVIDERS も必ず更新する**: インシデント #2 と全く同一のパターン。自動テストの網がグローバル関数ではなくファイル単位で止まっていた。

2. **MV3 の SW は音声認識中に終了しうる**: 発話待機（listening 状態）は「無活動」とみなされる。keepalive は音声認識のある全 MV3 拡張機能で必要。

3. **「一覧ナビが動く = OAuth 接続が生きている」は誤り**: 一覧ナビは SW を使わないため、SW が死んでいても動く。SW の生存確認には検索（GET_VALID_TOKEN）が必要。

4. **Unchecked lastError は無音のデバッグ妨害**: Chrome が "Unchecked" と記録するだけで例外は投げない。定期的にコンソールを確認し、`void chrome.runtime.lastError` パターンを全非同期 sendResponse に適用する。

---

## 6. 関連 PR

| PR | 内容 |
|----|------|
| #62〜#65 | 検索方式の試行錯誤（SOSL API / shadow DOM / execCommand / URL遷移） |
| #66 | fix(search): デバッグログ・トークンエラーフォールバック・「を検索して」パターン追加 |
| #67 | fix(search): manifest に salesforceApi.js 等を追加・SW keepalive 実装 |
