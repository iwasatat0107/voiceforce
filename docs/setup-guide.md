# VoiceForce セットアップガイド

このガイドでは、VoiceForce を使い始めるために必要な Salesforce Connected App の設定手順を説明します。

---

## 前提条件

- Salesforce 組織の **システム管理者** 権限
- Google Chrome（最新版）
- VoiceForce 拡張機能インストール済み

---

## Step 1: Salesforce に Connected App を作成する

1. Salesforce にログインし、右上の歯車アイコン → **「設定」** を開く
2. クイック検索欄に `App Manager` と入力し、**「App Manager」** を開く
3. 右上の **「新規接続済みアプリケーション」** をクリック

---

## Step 2: 基本情報を入力する

| 項目 | 入力値 |
|------|--------|
| 接続済みアプリケーション名 | `VoiceForce`（任意） |
| API 参照名 | `VoiceForce`（自動入力） |
| 連絡先メール | あなたのメールアドレス |

---

## Step 3: OAuth 設定を行う

1. **「OAuth 設定を有効化」** にチェックを入れる
2. コールバック URL に以下を入力:

   ```
   https://login.salesforce.com/services/oauth2/callback
   ```

3. **「選択した OAuth 範囲」** に以下を追加:
   - `データへのアクセスと管理（api）`
   - `いつでもリクエストを実行（refresh_token, offline_access）`

4. **「コードフローの要件（PKCE）」** を有効化（チェックを入れる）

---

## Step 4: 保存してコンシューマーキーを取得する

1. **「保存」** をクリック（反映まで 2〜10 分かかる場合があります）
2. 「続行」を押すと詳細ページが表示される
3. **「コンシューマーキーとシークレットを管理」** をクリック
4. 表示された **「コンシューマーキー」** と **「コンシューマーシークレット」** をコピーする

---

## Step 5: VoiceForce ポップアップに入力する

1. Chrome のツールバーで VoiceForce アイコンをクリック
2. **「コンシューマーキー」** に取得したキーを貼り付け
3. **「コンシューマーシークレット」** に取得したシークレットを貼り付け
4. **「Salesforce URL」** はデフォルト（`https://login.salesforce.com`）のままでよい
   - Sandbox の場合は `https://test.salesforce.com` に変更
5. **「Salesforce に接続」** をクリック
6. Salesforce のログイン画面が開くので、ログインして許可する

---

## 接続後の使い方

- `Alt+V`（Mac: `Option+V`）で音声入力開始
- 例: 「株式会社サンプルを検索して」「取引先一覧を開いて」

ショートカットは `chrome://extensions/shortcuts` からカスタマイズできます。

---

## トラブルシューティング

| 症状 | 原因と対処 |
|------|----------|
| 「Authorization page could not be loaded」 | PKCE が有効になっているか確認 |
| `invalid_client` エラー | コンシューマーキー / シークレットの入力ミス。再確認する |
| 「ポップアップから再接続してください」 | トークンが期限切れ。ポップアップから再接続する |
| 音声入力が反応しない | Salesforce のタブを開いているか確認。`Alt+V` を押して緑の枠が出るか確認 |

---

## 関連ドキュメント

- [音声コマンド一覧](./voice-operations.md)
- [プライバシーポリシー](./privacy-policy.md)
