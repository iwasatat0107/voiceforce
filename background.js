'use strict';

// Service Worker: 認証管理・メッセージルーティング・トークンリフレッシュ
// lib/auth.js を importScripts で読み込む（MV3 Classic Service Worker）
importScripts('lib/auth.js');

function handleMessage(message, sender, sendResponse) {
  // Fix 1: 送信者検証 — 自拡張のみ許可
  if (!sender || sender.id !== chrome.runtime.id) {
    sendResponse({ success: false, error: 'unauthorized sender' });
    return false;
  }

  switch (message.type) {
    case 'CONNECT_SALESFORCE': {
      const { clientId, clientSecret, instanceUrl } = message;
      // Fix 2: instanceUrl のバリデーション
      if (!validateInstanceUrl(instanceUrl)) { // eslint-disable-line no-undef
        sendResponse({ success: false, error: 'Invalid Salesforce login URL' });
        return false;
      }
      startOAuth(clientId, instanceUrl, clientSecret)
        .then(() => { sendResponse({ success: true }); void chrome.runtime.lastError; })
        .catch((err) => { sendResponse({ success: false, error: err.message }); void chrome.runtime.lastError; });
      return true; // 非同期レスポンスのため
    }

    case 'DISCONNECT_SALESFORCE':
      disconnect()
        .then(() => { sendResponse({ success: true }); void chrome.runtime.lastError; })
        .catch((err) => { sendResponse({ success: false, error: err.message }); void chrome.runtime.lastError; });
      return true;

    case 'GET_STATUS':
      isConnected()
        .then((connected) => getInstanceUrl().then((url) => ({ connected, instanceUrl: url })))
        .then((status) => { sendResponse({ success: true, ...status }); void chrome.runtime.lastError; })
        .catch((err) => { sendResponse({ success: false, error: err.message }); void chrome.runtime.lastError; });
      return true;

    case 'GET_VALID_TOKEN':
      getValidToken()
        .then((token) => { sendResponse({ success: true, token }); void chrome.runtime.lastError; })
        .catch((err) => { sendResponse({ success: false, error: err.message }); void chrome.runtime.lastError; });
      return true;

    case 'NAVIGATE_TO_SEARCH': {
      const { keyword } = message;
      if (!keyword || typeof keyword !== 'string') {
        sendResponse({ success: false, error: 'invalid keyword' });
        return false;
      }
      if (!sender.tab) {
        sendResponse({ success: false, error: 'no tab' });
        return false;
      }
      try {
        const tabOrigin = new URL(sender.tab.url).origin;
        const searchUrl = `${tabOrigin}/lightning/search?searchInput=${encodeURIComponent(keyword)}`;
        chrome.tabs.update(sender.tab.id, { url: searchUrl });
      } catch (e) {
        console.error('[VF] NAVIGATE_TO_SEARCH error:', e.message);
      }
      return false;
    }

    case 'STAY_ALIVE':
      // SW キープアライブ用。受信するだけで SW が生き続ける。
      sendResponse({ success: true });
      return false;

    default:
      sendResponse({ success: false, error: 'unknown message type' });
      return false;
  }
}

chrome.runtime.onMessage.addListener(handleMessage);

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
      if (tabs[0]) {
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_VOICE' })
          .catch(() => {}); // content script 未ロードのタブでは無視
      }
    });
  }
});

// Node.js (Jest) 環境向け CommonJS エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleMessage };
}
