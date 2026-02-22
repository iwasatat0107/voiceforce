'use strict';

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

let context;
let extensionId;

test.beforeAll(async () => {
  const extensionPath = path.resolve(__dirname, '../../dist');
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  extensionId = background.url().split('/')[2];
});

test.afterAll(async () => {
  await context.close();
});

// chrome.storage.local にダミーの接続済み状態をセットするヘルパー
async function setConnectedState(page, instanceUrl = 'https://example.my.salesforce.com') {
  await page.evaluate((url) => {
    return new Promise((resolve) => {
      chrome.storage.local.set({ instance_url: url }, resolve);
    });
  }, instanceUrl);
}

async function clearConnectedState(page) {
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(['instance_url'], resolve);
    });
  });
}

// ── 既存テスト ─────────────────────────────────────────────────

test('ポップアップが正しく表示される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('h1')).toContainText('Voice Assistant');
  await expect(page.locator('#status-text')).toContainText('未接続');
  await expect(page.locator('.status-badge')).toHaveClass(/disconnected/);

  await page.close();
});

test('コンシューマーキー入力欄が表示される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('#client-id-input')).toBeVisible();
  await expect(page.locator('#client-secret-input')).toBeVisible();
  await expect(page.locator('#instance-url-input')).toBeVisible();
  await expect(page.locator('#instance-url-input')).toHaveValue('https://login.salesforce.com');

  await page.close();
});

test('コンシューマーキー未入力で接続ボタンを押すとエラー表示', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.locator('#connect-btn').click();

  const borderColor = await page.locator('#client-id-input').evaluate(
    el => window.getComputedStyle(el).borderColor
  );
  expect(borderColor).toContain('239'); // rgb(239, 68, 68) = #ef4444

  await page.close();
});

test('ショートカットカスタマイズボタンが表示される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await expect(page.locator('#customize-shortcut-btn')).toBeVisible();
  await expect(page.locator('#customize-shortcut-btn')).toContainText('ショートカットをカスタマイズ');

  await page.close();
});

// ── 優先度高: 接続済み状態のポップアップ表示 ─────────────────────

test('接続済み状態: ステータスが「接続済み」に変わる', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // storage に接続済み状態をセット
  await setConnectedState(page, 'https://example.my.salesforce.com');

  // ページをリロードして状態を反映
  await page.reload();

  await expect(page.locator('#status-text')).toContainText('接続済み');
  await expect(page.locator('.status-badge')).toHaveClass(/connected/);

  await clearConnectedState(page);
  await page.close();
});

test('接続済み状態: instance_url がポップアップに表示される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const instanceUrl = 'https://myorg.my.salesforce.com';
  await setConnectedState(page, instanceUrl);
  await page.reload();

  await expect(page.locator('#instance-url')).toBeVisible();
  await expect(page.locator('#instance-url')).toContainText(instanceUrl);

  await clearConnectedState(page);
  await page.close();
});

test('接続済み状態: 接続フォームが非表示・切断ボタンが表示される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await setConnectedState(page);
  await page.reload();

  // 接続フォームは非表示
  await expect(page.locator('#connect-form')).toBeHidden();
  // 切断ボタンが表示
  await expect(page.locator('#disconnect-btn')).toBeVisible();

  await clearConnectedState(page);
  await page.close();
});

test('接続済み状態: 切断ボタンを押すと未接続に戻る', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await setConnectedState(page);
  await page.reload();

  // 切断ボタンをクリック（background.js が DISCONNECT_SALESFORCE を処理）
  await page.locator('#disconnect-btn').click();
  await page.waitForTimeout(500);

  await expect(page.locator('#status-text')).toContainText('未接続');
  await expect(page.locator('#connect-form')).toBeVisible();

  await page.close();
});
