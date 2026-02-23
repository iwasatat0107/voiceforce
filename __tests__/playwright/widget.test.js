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

// ── 既存テスト ─────────────────────────────────────────────────

test('ウィジェットが初期状態では非表示', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const widget = page.locator('#vfa-widget');
  await expect(widget).toHaveCount(0);

  await page.close();
});

test('ruleEngine: 商談一覧ナビゲーションパターン', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ruleEngine.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    return [
      window.match('商談一覧を開いて'),
      window.match('すべての商談を開いて'),
      window.match('最近参照した商談を開いて'),
      window.match('戻って'),
    ];
  });

  expect(result[0]).toMatchObject({ action: 'navigate', object: 'Opportunity' });
  expect(result[1]).toMatchObject({ action: 'navigate', filterName: 'AllOpportunities' });
  expect(result[2]).toMatchObject({ action: 'navigate', filterName: 'Recent' });
  expect(result[3]).toMatchObject({ action: 'back' });

  await page.close();
});

test('ruleEngine: 誤認識語も正しくマッチする', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ruleEngine.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    return [
      window.match('相談一覧を開いて'),
      window.match('全ての商談を開いて'),
    ];
  });

  expect(result[0]).toMatchObject({ action: 'navigate', object: 'Opportunity' });
  expect(result[1]).toMatchObject({ action: 'navigate', filterName: 'AllOpportunities' });

  await page.close();
});

// ── 優先度高: リストビュー別ナビゲーション ──────────────────────

test('ruleEngine: 全オブジェクトの一覧ナビゲーションが認識される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ruleEngine.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    return {
      opportunity: window.match('商談一覧を開いて'),
      account:     window.match('取引先一覧を開いて'),
      contact:     window.match('取引先責任者一覧を開いて'),
      lead:        window.match('リード一覧を開いて'),
    };
  });

  expect(result.opportunity).toMatchObject({ action: 'navigate', object: 'Opportunity' });
  expect(result.account).toMatchObject({ action: 'navigate', object: 'Account' });
  expect(result.contact).toMatchObject({ action: 'navigate', object: 'Contact' });
  expect(result.lead).toMatchObject({ action: 'navigate', object: 'Lead' });

  await page.close();
});

test('ruleEngine: リストビュー指定パターンのバリエーション', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ruleEngine.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    return {
      all1:    window.match('全ての商談を開いて'),
      all2:    window.match('全部の商談'),
      all3:    window.match('商談のすべてを開いて'),
      recent1: window.match('最近参照した商談'),
      recent2: window.match('最近の商談を開いて'),
      mine1:   window.match('自分の商談を開いて'),
      mine2:   window.match('私の商談一覧'),
      mine3:   window.match('私の商談を開いて'),
    };
  });

  expect(result.all1).toMatchObject({ filterName: 'AllOpportunities' });
  expect(result.all2).toMatchObject({ filterName: 'AllOpportunities' });
  expect(result.all3).toMatchObject({ filterName: 'AllOpportunities' });
  expect(result.recent1).toMatchObject({ filterName: 'Recent' });
  expect(result.recent2).toMatchObject({ filterName: 'Recent' });
  expect(result.mine1).toMatchObject({ filterName: 'MyOpportunities' });
  expect(result.mine2).toMatchObject({ filterName: 'MyOpportunities' });
  expect(result.mine3).toMatchObject({ filterName: 'MyOpportunities' });

  await page.close();
});

test('navigator: buildListUrl が正しい URL を生成する', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/navigator.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    const base = 'https://example.my.salesforce.com';
    return {
      noFilter:   window.buildListUrl(base, 'Opportunity'),
      withFilter: window.buildListUrl(base, 'Opportunity', '00B5h0000096B6YEAU'),
      account:    window.buildListUrl(base, 'Account'),
    };
  });

  expect(result.noFilter).toBe('https://example.my.salesforce.com/lightning/o/Opportunity/list');
  expect(result.withFilter).toBe('https://example.my.salesforce.com/lightning/o/Opportunity/list?filterName=00B5h0000096B6YEAU');
  expect(result.account).toBe('https://example.my.salesforce.com/lightning/o/Account/list');

  await page.close();
});

test('ruleEngine: 確認応答パターンが認識される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const result = await page.evaluate(async () => {
    const script = document.createElement('script');
    script.src = chrome.runtime.getURL('lib/ruleEngine.js');
    document.head.appendChild(script);
    await new Promise(r => script.addEventListener('load', r));
    return {
      yes1: window.match('はい'),
      yes2: window.match('OK'),
      no1:  window.match('いいえ'),
      no2:  window.match('キャンセル'),
      undo: window.match('元に戻して'),
      stop: window.match('止めて'),
    };
  });

  expect(result.yes1).toMatchObject({ action: 'confirm', value: true });
  expect(result.yes2).toMatchObject({ action: 'confirm', value: true });
  expect(result.no1).toMatchObject({ action: 'confirm', value: false });
  expect(result.no2).toMatchObject({ action: 'confirm', value: false });
  expect(result.undo).toMatchObject({ action: 'undo' });
  expect(result.stop).toMatchObject({ action: 'stop' });

  await page.close();
});
