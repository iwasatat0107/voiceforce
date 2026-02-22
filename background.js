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
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true; // 非同期レスポンスのため
    }

    case 'DISCONNECT_SALESFORCE':
      disconnect()
        .then(() => sendResponse({ success: true }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_STATUS':
      isConnected()
        .then((connected) => getInstanceUrl().then((url) => ({ connected, instanceUrl: url })))
        .then((status) => sendResponse({ success: true, ...status }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

    case 'GET_VALID_TOKEN':
      getValidToken()
        .then((token) => sendResponse({ success: true, token }))
        .catch((err) => sendResponse({ success: false, error: err.message }));
      return true;

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
        chrome.tabs.sendMessage(tabs[0].id, { type: 'TOGGLE_VOICE' });
      }
    });
  }
});

// Node.js (Jest) 環境向け CommonJS エクスポート
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleMessage };
}
