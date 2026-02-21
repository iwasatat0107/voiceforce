'use strict';

// Web Speech API ラッパー（Push-to-Talk、ja-JP）
// Content Script 側で使用する

const DEFAULT_SILENCE_TIMEOUT_MS = 3000;

/**
 * Push-to-Talk 音声認識インスタンスを生成する
 *
 * @param {object}   [options]
 * @param {function} [options.onResult]          確定テキストコールバック (transcript: string)
 * @param {function} [options.onInterim]         中間テキストコールバック (transcript: string)
 * @param {function} [options.onStart]           認識開始コールバック
 * @param {function} [options.onEnd]             認識終了コールバック
 * @param {function} [options.onError]           エラーコールバック (errorType: string)
 * @param {number}   [options.silenceTimeoutMs]  無音タイムアウト ミリ秒（デフォルト: 3000）
 * @returns {{ start: function, stop: function, isListening: function }}
 */
function createSpeechRecognition({
  onResult,
  onInterim,
  onStart,
  onEnd,
  onError,
  silenceTimeoutMs = DEFAULT_SILENCE_TIMEOUT_MS,
} = {}) {
  const recognition = new webkitSpeechRecognition();
  recognition.lang = 'ja-JP';
  recognition.continuous = false;    // Push-to-Talk なので false
  recognition.interimResults = true; // リアルタイム表示用
  recognition.maxAlternatives = 1;

  let listening = false;
  let silenceTimer = null;

  function clearSilenceTimer() {
    if (silenceTimer !== null) {
      clearTimeout(silenceTimer);
      silenceTimer = null;
    }
  }

  function resetSilenceTimer() {
    clearSilenceTimer();
    silenceTimer = setTimeout(() => {
      recognition.stop();
    }, silenceTimeoutMs);
  }

  recognition.onstart = () => {
    listening = true;
    resetSilenceTimer();
    if (onStart) onStart();
  };

  recognition.onresult = (event) => {
    resetSilenceTimer();
    const result = event.results[event.resultIndex];
    const transcript = result[0].transcript;
    const isFinal = result.isFinal;

    if (isFinal) {
      clearSilenceTimer();
      if (onResult) onResult(transcript);
    } else {
      if (onInterim) onInterim(transcript);
    }
  };

  recognition.onerror = (event) => {
    clearSilenceTimer();
    listening = false;
    if (onError) onError(event.error);
  };

  recognition.onend = () => {
    clearSilenceTimer();
    listening = false;
    if (onEnd) onEnd();
  };

  return {
    start() {
      if (listening) return;
      recognition.start();
    },
    stop() {
      clearSilenceTimer();
      recognition.stop();
    },
    isListening() {
      return listening;
    },
  };
}

// Node.js (Jest) 環境向け CommonJS エクスポート
// ブラウザ環境（Content Script）では importScripts() / スクリプトタグで読み込む
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createSpeechRecognition };
}
