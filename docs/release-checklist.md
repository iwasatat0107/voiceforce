# VoiceForce リリースチェックリスト

**次回作業再開時の手順書**
**対象**: 手動テスト → Playwright テスト → Chrome Web Store 申請

---

## 概要

VoiceForce は以下の順序でリリース作業を進めます。

```
1. 手動テスト（全項目合格）
     ↓
2. Playwright 自動テスト（全テスト PASS）
     ↓
3. Jest ユニット・統合テスト（カバレッジ基準クリア）
     ↓
4. Chrome Web Store 申請準備
     ↓
5. Chrome Web Store に提出
```

---

## Step 1: 手動テスト

### 事前準備

```bash
# ローカルをリモートと同期（作業再開時は必ず実施）
git fetch origin && git reset --hard origin/develop
npm run build

# Chrome 拡張を再読み込み
# chrome://extensions/ → VoiceForce → 更新ボタン（↻）
```

### 手動テスト実施

`docs/manual-test-guide.md` に従って全テストを実施する。

```
テスト項目:
  □ テスト 1: ポップアップ UI
  □ テスト 2: ウィジェット表示
  □ テスト 3: 音声認識・ナビゲーション
  □ テスト 4: 戻る操作
  □ テスト 5: エラーハンドリング
  □ テスト 6: セキュリティ確認
```

全テスト合格したら次のステップへ。

---

## Step 2: Playwright 自動テスト

### セットアップ（初回のみ）

```bash
# Playwright のブラウザをインストール
npx playwright install chromium
```

### テスト実行

```bash
# 全 Playwright テストを実行
npx playwright test

# 特定のテストのみ実行
npx playwright test voice.test.js

# テスト結果レポートを表示
npx playwright show-report
```

### テストファイルの場所

```
__tests__/playwright/
├── voice.test.js    # 音声認識 → ruleEngine → widget 状態遷移
├── widget.test.js   # ウィジェット UI の状態遷移
└── popup.test.js    # ポップアップ UI
```

### 注意事項

- Playwright テストは `headless: false`（Chromeウィンドウが開く）
- 拡張機能は `dist/` からロードされるため、事前に `npm run build` が必要
- Salesforce への実接続は不要（モック使用）
- テスト中は他の Chrome ウィンドウを閉じると安定する

### テスト失敗時

```
1. エラーメッセージを確認
2. スクリーンショットを確認（test-results/ に保存される）
3. docs/troubleshooting.md の診断フローに従う
4. 修正後: npm run build → npx playwright test
```

---

## Step 3: Jest テスト

```bash
# 全テスト + カバレッジ
npm test

# カバレッジ基準確認
# branches: 70% 以上
# functions, lines, statements: 80% 以上
```

全テスト PASS・カバレッジ基準クリアしたら次のステップへ。

---

## Step 4: Chrome Web Store 申請準備

### 4-1. バージョン番号の更新

```bash
# manifest.json の version を更新
# 例: "0.1.0" → "1.0.0"
```

`manifest.json` と `package.json` の version を一致させる。

### 4-2. ZIP パッケージ作成

```bash
npm run build     # dist/ を最新状態に
npm run package   # dist/ を ZIP に圧縮（ルートに .zip が生成される）
```

生成されるファイル: `voiceforce-vX.X.X.zip`

### 4-3. 申請前チェックリスト

#### 機能確認
```
□ OAuth 接続が成功する
□ Option+V でウィジェットが表示される
□ 「商談の一覧を表示してください」で商談一覧に遷移する
□ 「すべての商談を開いて」で全件一覧に遷移する
□ 「最近の商談を開いて」で最近参照一覧に遷移する
□ 「戻って」でブラウザバックする
□ ポップアップで接続状態が正しく表示される
```

#### セキュリティ確認
```
□ トークンが chrome.storage.local に暗号化されて保存されている
   （DevTools → Application → Local Storage → 暗号化文字列のみ）
□ innerHTML を使用していない（XSS 対策）
□ Content Security Policy が manifest.json に設定されている
□ host_permissions が Salesforce ドメインのみに限定されている
```

#### ストア掲載要件確認
```
□ アイコンが揃っている（16px, 48px, 128px）
□ スクリーンショットを用意している（最低1枚・推奨5枚）
   サイズ: 1280x800 または 640x400
□ プロモーションタイル画像（任意）: 440x280
□ 説明文（日本語・英語）を用意している
□ プライバシーポリシー URL が公開されている
   → https://iwasatat0107.github.io/voiceforce/
□ 単一用途に特化した拡張機能であることを説明できる
```

---

## Step 5: Chrome Web Store に提出

### 5-1. デベロッパーアカウント

- Chrome Web Store デベロッパーダッシュボード: https://chrome.google.com/webstore/devconsole
- 初回登録料: $5（1回のみ）

### 5-2. 審査の準備

Chrome Web Store の審査では以下が確認されます。

| 審査項目 | 対応状況 |
|---------|---------|
| マニフェストの permissions が最小限か | `activeTab, tabs, storage, identity` のみ ✅ |
| host_permissions が必要なドメインのみか | Salesforce ドメインのみ ✅ |
| リモートコードの実行がないか | `script-src 'self'` で制限済み ✅ |
| プライバシーポリシーがあるか | GitHub Pages で公開済み ✅ |
| 単一用途であるか | Salesforce 音声操作のみ ✅ |

### 5-3. 提出手順

```
1. Chrome Web Store デベロッパーダッシュボードにアクセス
2. 「新しいアイテム」→ ZIP ファイルをアップロード
3. ストア掲載情報を入力
   - 説明文（日本語）
   - スクリーンショット（Salesforce ページで動作中の画面）
   - カテゴリ: 「仕事効率化」
   - 言語: 日本語
4. プライバシーポリシー URL を入力
   https://iwasatat0107.github.io/voiceforce/
5. 「提出して審査」をクリック
6. 審査完了まで待つ（通常 1〜3 営業日）
```

### 5-4. 審査却下された場合

よくある却下理由と対応：

| 却下理由 | 対応 |
|---------|------|
| permissions の説明不足 | manifest.json に `"description"` を詳しく書く |
| プライバシーポリシーが不完全 | データ収集・送信内容を明記する |
| スクリーンショットが実際の動作を示していない | 実際の Salesforce 操作画面を撮影して差し替え |
| リモートコードの疑い | CSP 設定と `'self'` 制限を説明する |

---

## 作業再開時の状態確認コマンド

```bash
# リモートと同期
git fetch origin && git reset --hard origin/develop

# テスト実行
npm test

# ビルド
npm run build

# Playwright テスト
npx playwright test

# 現在のバージョン確認
cat manifest.json | grep version
```

---

## 関連ドキュメント

- [`docs/manual-test-guide.md`](./manual-test-guide.md) — 手動テスト手順書（詳細版）
- [`docs/troubleshooting.md`](./troubleshooting.md) — トラブルシューティングガイド
- [`docs/incident-report-2026-02.md`](./incident-report-2026-02.md) — 過去インシデントと再発防止策
- [`docs/privacy-policy.html`](./privacy-policy.html) — プライバシーポリシー
