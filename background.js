'use strict';

// Service Worker: 認証管理・メッセージルーティング・トークンリフレッシュ
// 各機能は Step 2（auth）以降で実装する

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  switch (message.type) {
    case 'CONNECT_SALESFORCE':
      // Step 2 で lib/auth.js を使って実装
      console.warn('CONNECT_SALESFORCE: not implemented yet');
      sendResponse({ success: false, error: 'not implemented' });
      break;

    case 'DISCONNECT_SALESFORCE':
      // Step 2 で lib/auth.js を使って実装
      console.warn('DISCONNECT_SALESFORCE: not implemented yet');
      sendResponse({ success: false, error: 'not implemented' });
      break;

    default:
      console.warn('Unknown message type:', message.type);
      sendResponse({ success: false, error: 'unknown message type' });
  }

  // 非同期レスポンスのために true を返す
  return true;
});

chrome.commands.onCommand.addListener((command) => {
  if (command === 'toggle-voice') {
    // Step 4 で lib/speechRecognition.js を使って実装
    console.warn('toggle-voice: not implemented yet');
  }
});
