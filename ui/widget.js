'use strict';

// フローティングウィジェット（待機/リスニング/処理中/確認/完了/エラーの6状態）
// XSS防止のため innerHTML は使用しない。テキストは textContent のみ使用。

const STATES = {
  IDLE: 'idle',
  LISTENING: 'listening',
  PROCESSING: 'processing',
  CONFIRM: 'confirm',
  SUCCESS: 'success',
  ERROR: 'error',
};

const DEFAULT_SUCCESS_DURATION_MS = 3000;

/**
 * フローティングウィジェットを生成し document.body に追加する
 * @returns {{ setState, getState, setTranscript, destroy }}
 */
function createWidget() {
  // ── DOM 構築（innerHTML 禁止・DOM API のみ使用）──
  const container = document.createElement('div');
  container.id = 'vfa-widget';
  container.setAttribute('data-state', STATES.IDLE);
  container.setAttribute('role', 'status');
  container.setAttribute('aria-live', 'polite');
  container.style.display = 'none';

  const statusEl = document.createElement('div');
  statusEl.className = 'vfa-status';

  const transcriptEl = document.createElement('div');
  transcriptEl.className = 'vfa-transcript';

  const messageEl = document.createElement('div');
  messageEl.className = 'vfa-message';

  const confirmEl = document.createElement('div');
  confirmEl.className = 'vfa-confirm';
  confirmEl.style.display = 'none';

  const yesBtn = document.createElement('button');
  yesBtn.className = 'vfa-btn vfa-btn-yes';
  yesBtn.textContent = 'はい';
  yesBtn.setAttribute('type', 'button');

  const noBtn = document.createElement('button');
  noBtn.className = 'vfa-btn vfa-btn-no';
  noBtn.textContent = 'いいえ';
  noBtn.setAttribute('type', 'button');

  confirmEl.appendChild(yesBtn);
  confirmEl.appendChild(noBtn);

  container.appendChild(statusEl);
  container.appendChild(transcriptEl);
  container.appendChild(messageEl);
  container.appendChild(confirmEl);

  document.body.appendChild(container);

  // ── 内部状態 ──
  let currentState = STATES.IDLE;
  let confirmCallback = null;
  let successTimer = null;

  function clearSuccessTimer() {
    if (successTimer !== null) {
      clearTimeout(successTimer);
      successTimer = null;
    }
  }

  // ── ボタンイベント ──
  yesBtn.addEventListener('click', () => {
    if (confirmCallback) confirmCallback(true);
  });

  noBtn.addEventListener('click', () => {
    if (confirmCallback) confirmCallback(false);
  });

  // ── 状態遷移 ──
  function setState(state, options) {
    clearSuccessTimer();
    const opts = options || {};
    currentState = state;
    container.setAttribute('data-state', state);

    // 確認ボタン・コールバックをリセット
    confirmEl.style.display = 'none';
    confirmCallback = null;

    if (state === STATES.IDLE) {
      container.style.display = 'none';
      statusEl.textContent = '';
      transcriptEl.textContent = '';
      messageEl.textContent = '';
      return;
    }

    container.style.display = 'block';

    if (state === STATES.LISTENING) {
      statusEl.textContent = 'リスニング中...';
      transcriptEl.textContent = '';
      messageEl.textContent = '';
      return;
    }

    if (state === STATES.PROCESSING) {
      statusEl.textContent = '処理中...';
      if (opts.transcript !== undefined) {
        transcriptEl.textContent = opts.transcript;
      }
      messageEl.textContent = '';
      return;
    }

    if (state === STATES.CONFIRM) {
      statusEl.textContent = '確認';
      if (opts.transcript !== undefined) {
        transcriptEl.textContent = opts.transcript;
      }
      messageEl.textContent = opts.message || '';
      confirmEl.style.display = 'flex';
      confirmCallback = opts.onConfirm || null;
      return;
    }

    if (state === STATES.SUCCESS) {
      statusEl.textContent = '完了';
      messageEl.textContent = opts.message || '';
      const duration =
        opts.duration !== undefined ? opts.duration : DEFAULT_SUCCESS_DURATION_MS;
      successTimer = setTimeout(() => setState(STATES.IDLE), duration);
      return;
    }

    if (state === STATES.ERROR) {
      statusEl.textContent = 'エラー';
      messageEl.textContent = opts.message || '';
      return;
    }
  }

  return {
    setState,
    getState() {
      return currentState;
    },
    setTranscript(text) {
      transcriptEl.textContent = text;
    },
    destroy() {
      container.remove();
    },
  };
}

// Node.js (Jest) 環境向け CommonJS エクスポート
// ブラウザ環境（Content Script）では importScripts() または <script> タグで読み込む
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createWidget, STATES };
}
