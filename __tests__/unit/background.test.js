'use strict';

// importScripts をモック（Service Worker 環境を模擬）
global.importScripts = jest.fn();

// lib/auth.js の関数をグローバルに公開（importScripts で読み込まれる想定）
const auth = require('../../lib/auth');
global.startOAuth = auth.startOAuth;
global.disconnect = auth.disconnect;
global.isConnected = auth.isConnected;
global.getInstanceUrl = auth.getInstanceUrl;
global.getValidToken = auth.getValidToken;
global.validateInstanceUrl = auth.validateInstanceUrl;

const background = require('../../background');

describe('background.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
  });

  // ──────────────────────────────────────────
  // 送信者検証（Fix 1）
  // ──────────────────────────────────────────
  describe('handleMessage — 送信者検証', () => {
    test('正しい sender.id → 処理される（GET_STATUS）', (done) => {
      const sender = { id: chrome.runtime.id };
      const message = { type: 'GET_STATUS' };

      // isConnected / getInstanceUrl をモック
      global.isConnected = jest.fn().mockResolvedValue(true);
      global.getInstanceUrl = jest.fn().mockResolvedValue('https://test.salesforce.com');

      const sendResponse = jest.fn(() => {
        expect(sendResponse).toHaveBeenCalledWith(
          expect.objectContaining({ success: true })
        );
        done();
      });

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(true); // 非同期レスポンス
    });

    test('異なる sender.id → unauthorized sender エラー', () => {
      const sendResponse = jest.fn();
      const sender = { id: 'malicious-extension-id' };
      const message = { type: 'GET_STATUS' };

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'unauthorized sender',
      });
    });

    test('sender.id が undefined → 拒否', () => {
      const sendResponse = jest.fn();
      const sender = {};
      const message = { type: 'GET_STATUS' };

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'unauthorized sender',
      });
    });

    test('sender が null → 拒否', () => {
      const sendResponse = jest.fn();
      const message = { type: 'GET_STATUS' };

      const result = background.handleMessage(message, null, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'unauthorized sender',
      });
    });
  });

  // ──────────────────────────────────────────
  // instanceUrl バリデーション（Fix 2）
  // ──────────────────────────────────────────
  describe('handleMessage — CONNECT_SALESFORCE instanceUrl 検証', () => {
    test('不正な instanceUrl → rejected', () => {
      const sendResponse = jest.fn();
      const sender = { id: chrome.runtime.id };
      const message = {
        type: 'CONNECT_SALESFORCE',
        clientId: 'test_client',
        instanceUrl: 'https://evil.com',
      };

      background.handleMessage(message, sender, sendResponse);

      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'Invalid Salesforce login URL',
      });
    });

    test('正しい instanceUrl → startOAuth が呼ばれる', () => {
      const sendResponse = jest.fn();
      const sender = { id: chrome.runtime.id };
      const message = {
        type: 'CONNECT_SALESFORCE',
        clientId: 'test_client',
        instanceUrl: 'https://login.salesforce.com',
      };

      global.startOAuth = jest.fn().mockResolvedValue(undefined);

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(true);
      expect(global.startOAuth).toHaveBeenCalledWith(
        'test_client',
        'https://login.salesforce.com',
        undefined
      );
    });
  });

  // ──────────────────────────────────────────
  // NAVIGATE_TO_SEARCH
  // ──────────────────────────────────────────
  describe('handleMessage — NAVIGATE_TO_SEARCH', () => {
    test('有効な keyword → chrome.tabs.update が正しい Salesforce 検索 URL で呼ばれる', () => {
      const sender = {
        id: chrome.runtime.id,
        tab: { id: 42, url: 'https://myorg.my.salesforce.com/lightning/o/Opportunity/list' },
      };
      const message = { type: 'NAVIGATE_TO_SEARCH', keyword: 'ABC株式会社' };
      const sendResponse = jest.fn();

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(false);
      expect(chrome.tabs.update).toHaveBeenCalledWith(
        42,
        { url: 'https://myorg.my.salesforce.com/lightning/search?searchInput=ABC%E6%A0%AA%E5%BC%8F%E4%BC%9A%E7%A4%BE' }
      );
    });

    test('keyword が空文字 → エラーレスポンスを返す', () => {
      const sender = {
        id: chrome.runtime.id,
        tab: { id: 42, url: 'https://myorg.my.salesforce.com/lightning/page/home' },
      };
      const message = { type: 'NAVIGATE_TO_SEARCH', keyword: '' };
      const sendResponse = jest.fn();

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({ success: false, error: 'invalid keyword' });
      expect(chrome.tabs.update).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────
  // 未知のメッセージタイプ
  // ──────────────────────────────────────────
  describe('handleMessage — unknown message type', () => {
    test('不明なメッセージタイプ → error レスポンス', () => {
      const sendResponse = jest.fn();
      const sender = { id: chrome.runtime.id };
      const message = { type: 'UNKNOWN_TYPE' };

      const result = background.handleMessage(message, sender, sendResponse);
      expect(result).toBe(false);
      expect(sendResponse).toHaveBeenCalledWith({
        success: false,
        error: 'unknown message type',
      });
    });
  });
});
