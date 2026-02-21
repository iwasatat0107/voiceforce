'use strict';

const { createSpeechRecognition } = require('../../lib/speechRecognition');

// ──────────────────────────────────────────
// webkitSpeechRecognition のコントローラブルなモック
// ──────────────────────────────────────────
let mockInstance;

class MockSpeechRecognition {
  constructor() {
    this.lang = '';
    this.continuous = false;
    this.interimResults = false;
    this.maxAlternatives = 1;
    this.onstart = null;
    this.onresult = null;
    this.onerror = null;
    this.onend = null;
    // start は onstart を即時発火するモック
    this.start = jest.fn(() => {
      if (this.onstart) this.onstart();
    });
    // stop は onend を即時発火するモック
    this.stop = jest.fn(() => {
      if (this.onend) this.onend();
    });
    this.abort = jest.fn(() => {
      if (this.onend) this.onend();
    });
    mockInstance = this;
  }
}

// onresult イベントオブジェクトを生成するヘルパー
function makeResultEvent(transcript, isFinal) {
  return {
    results: [
      Object.assign([{ transcript }], { isFinal }),
    ],
    resultIndex: 0,
  };
}

describe('lib/speechRecognition.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.webkitSpeechRecognition = MockSpeechRecognition;
    mockInstance = null;
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ──────────────────────────────────────────
  // 設定確認
  // ──────────────────────────────────────────
  describe('createSpeechRecognition 設定', () => {
    test('webkitSpeechRecognition を正しく設定する', () => {
      createSpeechRecognition();
      expect(mockInstance.lang).toBe('ja-JP');
      expect(mockInstance.continuous).toBe(false);
      expect(mockInstance.interimResults).toBe(true);
      expect(mockInstance.maxAlternatives).toBe(1);
    });
  });

  // ──────────────────────────────────────────
  // start / stop / isListening
  // ──────────────────────────────────────────
  describe('start / stop / isListening', () => {
    test('start() で recognition.start() を呼び出す', () => {
      const sr = createSpeechRecognition();
      sr.start();
      expect(mockInstance.start).toHaveBeenCalledTimes(1);
    });

    test('stop() で recognition.stop() を呼び出す', () => {
      const sr = createSpeechRecognition();
      sr.start();
      sr.stop();
      expect(mockInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('isListening() は開始前 false、開始後 true、終了後 false を返す', () => {
      const sr = createSpeechRecognition();
      expect(sr.isListening()).toBe(false);
      sr.start(); // mock: onstart が即時発火 → listening = true
      expect(sr.isListening()).toBe(true);
      sr.stop();  // mock: onend が即時発火 → listening = false
      expect(sr.isListening()).toBe(false);
    });

    test('認識中に再度 start() を呼んでも無視する', () => {
      const sr = createSpeechRecognition();
      sr.start();
      sr.start(); // リスニング中なので無視
      expect(mockInstance.start).toHaveBeenCalledTimes(1);
    });
  });

  // ──────────────────────────────────────────
  // コールバック
  // ──────────────────────────────────────────
  describe('コールバック', () => {
    test('onStart コールバックが呼ばれる', () => {
      const onStart = jest.fn();
      const sr = createSpeechRecognition({ onStart });
      sr.start();
      expect(onStart).toHaveBeenCalledTimes(1);
    });

    test('onEnd コールバックが呼ばれる', () => {
      const onEnd = jest.fn();
      const sr = createSpeechRecognition({ onEnd });
      sr.start();
      sr.stop();
      expect(onEnd).toHaveBeenCalledTimes(1);
    });

    test('onResult コールバックが確定テキストで呼ばれる', () => {
      const onResult = jest.fn();
      const sr = createSpeechRecognition({ onResult });
      sr.start();
      mockInstance.onresult(makeResultEvent('商談一覧を見せて', true));
      expect(onResult).toHaveBeenCalledWith('商談一覧を見せて');
    });

    test('onInterim コールバックが中間テキストで呼ばれる', () => {
      const onInterim = jest.fn();
      const sr = createSpeechRecognition({ onInterim });
      sr.start();
      mockInstance.onresult(makeResultEvent('商談...', false));
      expect(onInterim).toHaveBeenCalledWith('商談...');
    });

    test('中間テキストのとき onResult は呼ばれない', () => {
      const onResult = jest.fn();
      const onInterim = jest.fn();
      const sr = createSpeechRecognition({ onResult, onInterim });
      sr.start();
      mockInstance.onresult(makeResultEvent('途中', false));
      expect(onResult).not.toHaveBeenCalled();
      expect(onInterim).toHaveBeenCalledWith('途中');
    });

    test('確定テキストのとき onInterim は呼ばれない', () => {
      const onResult = jest.fn();
      const onInterim = jest.fn();
      const sr = createSpeechRecognition({ onResult, onInterim });
      sr.start();
      mockInstance.onresult(makeResultEvent('取引先一覧', true));
      expect(onResult).toHaveBeenCalledWith('取引先一覧');
      expect(onInterim).not.toHaveBeenCalled();
    });

    test('onError コールバックがエラータイプで呼ばれる', () => {
      const onError = jest.fn();
      const sr = createSpeechRecognition({ onError });
      sr.start();
      mockInstance.onerror({ error: 'no-speech' });
      expect(onError).toHaveBeenCalledWith('no-speech');
    });

    test('エラー後は isListening() が false になる', () => {
      const sr = createSpeechRecognition();
      sr.start();
      expect(sr.isListening()).toBe(true);
      mockInstance.onerror({ error: 'network' });
      expect(sr.isListening()).toBe(false);
    });

    test('コールバックなしでもエラーをスローしない', () => {
      const sr = createSpeechRecognition();
      sr.start();
      expect(() => {
        mockInstance.onresult(makeResultEvent('テスト', true));
        mockInstance.onresult(makeResultEvent('途中', false));
        mockInstance.onerror({ error: 'no-speech' });
      }).not.toThrow();
    });
  });

  // ──────────────────────────────────────────
  // 無音タイムアウト
  // ──────────────────────────────────────────
  describe('無音タイムアウト', () => {
    test('3秒間無音で recognition.stop() が呼ばれる', () => {
      const sr = createSpeechRecognition({ silenceTimeoutMs: 3000 });
      sr.start();
      jest.advanceTimersByTime(2999);
      expect(mockInstance.stop).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1);
      expect(mockInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('中間テキスト受信でタイムアウトがリセットされる', () => {
      const sr = createSpeechRecognition({ silenceTimeoutMs: 3000 });
      sr.start();
      jest.advanceTimersByTime(2000);
      // 中間テキスト受信 → タイマーリセット
      mockInstance.onresult(makeResultEvent('途中', false));
      jest.advanceTimersByTime(2000); // リセット後2秒なのでまだ止まらない
      expect(mockInstance.stop).not.toHaveBeenCalled();
      jest.advanceTimersByTime(1000); // 合計3秒到達
      expect(mockInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('確定テキスト受信後はタイムアウトが解除される', () => {
      const sr = createSpeechRecognition({ silenceTimeoutMs: 3000 });
      sr.start();
      mockInstance.onresult(makeResultEvent('取引先一覧', true));
      // 確定テキスト後はタイムアウト終了→どんなに待っても stop() は呼ばれない
      jest.advanceTimersByTime(5000);
      expect(mockInstance.stop).not.toHaveBeenCalled();
    });

    test('stop() でタイムアウトがクリアされる', () => {
      const sr = createSpeechRecognition({ silenceTimeoutMs: 3000 });
      sr.start();
      sr.stop(); // タイムアウトもクリアする
      jest.advanceTimersByTime(5000);
      // stop は sr.stop() の1回のみ
      expect(mockInstance.stop).toHaveBeenCalledTimes(1);
    });

    test('エラー後はタイムアウトがクリアされる', () => {
      const sr = createSpeechRecognition({ silenceTimeoutMs: 3000 });
      sr.start();
      mockInstance.onerror({ error: 'no-speech' });
      jest.advanceTimersByTime(5000);
      // stop() は呼ばれない（エラー後はタイマークリア済み）
      expect(mockInstance.stop).not.toHaveBeenCalled();
    });
  });
});
