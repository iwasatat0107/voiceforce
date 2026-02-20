'use strict';

// Service Worker: 認証管理・メッセージルーティング・トークンリフレッシュ
// lib/auth.js を importScripts で読み込む（MV3 Classic Service Worker）
importScripts('lib/auth.js');

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'CONNECT_SALESFORCE': {
      const { clientId, instanceUrl } = message;
      startOAuth(clientId, instanceUrl)
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
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'unknown message type' });
      return false;
  }
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    // Step 4 で lib/speechRecognition.js を使って実装
    console.warn('toggle-voice: not implemented yet');
  }
});
