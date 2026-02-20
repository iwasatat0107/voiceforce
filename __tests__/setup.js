// グローバルChrome APIモックをセットアップ
const chromeMock = require('./mocks/chrome.js');
global.chrome = chromeMock;

// Web Crypto API（jsdom は crypto.subtle を持たないため Node.js の webcrypto を使用）
// Object.defineProperty で jsdom の getter 定義を上書き
const { webcrypto } = require('node:crypto');
Object.defineProperty(globalThis, 'crypto', {
  value: webcrypto,
  writable: true,
  configurable: true,
});

// TextEncoder / TextDecoder（jsdom 環境では未定義の場合がある）
const { TextEncoder, TextDecoder } = require('node:util');
if (typeof globalThis.TextEncoder === 'undefined') {
  globalThis.TextEncoder = TextEncoder;
}
if (typeof globalThis.TextDecoder === 'undefined') {
  globalThis.TextDecoder = TextDecoder;
}

// webkitSpeechRecognitionのグローバルモック
global.webkitSpeechRecognition = class {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
  }
  start() {}
  stop() {}
  abort() {}
};
