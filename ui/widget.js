'use strict';

// フローティングウィジェット（待機/リスニング/処理中/編集/確認/完了/エラーの7状態）
// XSS防止のため innerHTML は使用しない。テキストは textContent のみ使用。

const STATES = {
  IDLE:       'idle',
  LISTENING:  'listening',
  PROCESSING: 'processing',
  EDITING:    'editing',
  CONFIRM:    'confirm',
  SUCCESS:    'success',
  ERROR:      'error',
  SELECTING:  'selecting', // candidateList 選択待ち（自動消滅なし）
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

  // 編集行: input + 検索ボタン
  const editRowEl = document.createElement('div');
  editRowEl.className = 'vfa-edit-row';
  editRowEl.style.display = 'none';

  const editInputEl = document.createElement('input');
  editInputEl.className = 'vfa-edit-input';
  editInputEl.setAttribute('type', 'text');
  editInputEl.setAttribute('aria-label', '検索キーワードを修正');
  editRowEl.appendChild(editInputEl);

  const searchBtnEl = document.createElement('button');
  searchBtnEl.className = 'vfa-btn vfa-btn-search';
  searchBtnEl.setAttribute('type', 'button');
  searchBtnEl.textContent = '🔍';
  editRowEl.appendChild(searchBtnEl);

  // オブジェクト切替行
  const objectRowEl = document.createElement('div');
  objectRowEl.className = 'vfa-object-row';
  objectRowEl.style.display = 'none';

  const OBJECT_LABELS = [
    { api: 'Account',     label: '取引先' },
    { api: 'Contact',     label: '責任者' },
    { api: 'Lead',        label: 'リード' },
    { api: 'Opportunity', label: '商談'   },
    { api: 'Task',        label: 'ToDo'   },
  ];

  OBJECT_LABELS.forEach(({ api, label }) => {
    const btn = document.createElement('button');
    btn.className = 'vfa-obj-btn';
    btn.setAttribute('type', 'button');
    btn.setAttribute('data-object', api);
    btn.textContent = label;
    objectRowEl.appendChild(btn);
  });

  // キャンセルボタン（editing専用）
  const editCancelBtnEl = document.createElement('button');
  editCancelBtnEl.className = 'vfa-btn vfa-btn-cancel';
  editCancelBtnEl.setAttribute('type', 'button');
  editCancelBtnEl.textContent = 'キャンセル';
  editCancelBtnEl.style.display = 'none';

  container.appendChild(statusEl);
  container.appendChild(transcriptEl);
  container.appendChild(messageEl);
  container.appendChild(confirmEl);
  container.appendChild(editRowEl);
  container.appendChild(objectRowEl);
  container.appendChild(editCancelBtnEl);

  document.body.appendChild(container);

  // ── 内部状態 ──
  let currentState = STATES.IDLE;
  let confirmCallback = null;
  let successTimer = null;
  let editingTimeoutId = null;

  function clearSuccessTimer() {
    if (successTimer !== null) {
      clearTimeout(successTimer);
      successTimer = null;
    }
  }

  function clearEditingTimeout() {
    if (editingTimeoutId !== null) {
      clearTimeout(editingTimeoutId);
      editingTimeoutId = null;
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
    clearEditingTimeout();
    const opts = options || {};
    currentState = state;
    container.setAttribute('data-state', state);

    // 確認ボタン・コールバックをリセット
    confirmEl.style.display = 'none';
    confirmCallback = null;

    // 編集UIをリセット（常時）
    editRowEl.style.display = 'none';
    objectRowEl.style.display = 'none';
    editCancelBtnEl.style.display = 'none';

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

    if (state === STATES.EDITING) {
      statusEl.textContent = '見つかりません — 修正して再検索';
      transcriptEl.textContent = '';
      messageEl.textContent = '';
      editInputEl.value = opts.keyword || '';
      editRowEl.style.display = 'flex';
      editCancelBtnEl.style.display = 'block';

      // オブジェクト切替: active クラス設定
      let currentObject = opts.sfObject || 'Account';
      objectRowEl.style.display = 'flex';
      objectRowEl.querySelectorAll('.vfa-obj-btn').forEach((btn) => {
        btn.className = btn.getAttribute('data-object') === currentObject
          ? 'vfa-obj-btn vfa-obj-active'
          : 'vfa-obj-btn';
        btn.onclick = () => {
          currentObject = btn.getAttribute('data-object');
          objectRowEl.querySelectorAll('.vfa-obj-btn').forEach((b) => {
            b.className = b.getAttribute('data-object') === currentObject
              ? 'vfa-obj-btn vfa-obj-active'
              : 'vfa-obj-btn';
          });
        };
      });

      const editCallback = opts.onConfirm || null;
      const cancelCallback = opts.onCancel || null;

      const doSearch = () => {
        const kw = editInputEl.value.trim();
        if (!kw) return;
        clearEditingTimeout();
        if (editCallback) editCallback(kw, currentObject);
      };

      searchBtnEl.onclick = doSearch;

      editInputEl.onkeydown = (e) => {
        if (e.key === 'Enter') { e.preventDefault(); doSearch(); }
        if (e.key === 'Escape') { clearEditingTimeout(); if (cancelCallback) cancelCallback(); }
      };

      editCancelBtnEl.onclick = () => {
        clearEditingTimeout();
        if (cancelCallback) cancelCallback();
      };

      // 60秒タイムアウト
      editingTimeoutId = setTimeout(() => {
        setState(STATES.ERROR, { message: 'タイムアウトしました' });
        setTimeout(() => setState(STATES.IDLE), 3000);
      }, 60000);

      // オートフォーカス（カーソルを末尾に移動）
      editInputEl.focus();
      const len = editInputEl.value.length;
      editInputEl.setSelectionRange(len, len);
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

    if (state === STATES.SELECTING) {
      statusEl.textContent = '候補を選択';
      messageEl.textContent = opts.message || '';
      // 自動消滅なし。candidateList が hide() されるまで表示を維持する
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
