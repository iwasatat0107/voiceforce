// グローバルChrome APIモックをセットアップ
const chromeMock = require('./mocks/chrome.js');
global.chrome = chromeMock;

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
