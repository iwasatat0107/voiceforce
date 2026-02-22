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
