'use strict';

// ui/candidateList.js
// 音声番号選択対応の候補リスト UI
// XSS防止のため innerHTML は使用しない。textContent / DOM API のみ使用。

/**
 * 候補リスト UI を生成し document.body に追加する
 * @returns {{ show, hide, selectByNumber, destroy }}
 */
function createCandidateList() {
  const container = document.createElement('div');
  container.id = 'vfa-candidate-list';
  container.setAttribute('role', 'list');
  container.style.display = 'none';

  document.body.appendChild(container);

  let selectCallback  = null;
  let currentCandidates = [];

  function clearItems() {
    while (container.firstChild) {
      container.removeChild(container.firstChild);
    }
  }

  /**
   * 候補リストを表示する
   * @param {Array}    candidates - レコード配列（Name / Subject / Id を持つ）
   * @param {Function} onSelect   - (index: number, record: object) => void
   */
  function show(candidates, onSelect) {
    currentCandidates = Array.isArray(candidates) ? candidates : [];
    selectCallback    = typeof onSelect === 'function' ? onSelect : null;

    clearItems();

    if (currentCandidates.length === 0) {
      container.style.display = 'none';
      return;
    }

    currentCandidates.forEach((record, i) => {
      const item = document.createElement('div');
      item.className = 'vfa-candidate-item';
      item.setAttribute('role', 'listitem');
      item.setAttribute('data-index', String(i + 1));

      const numEl = document.createElement('span');
      numEl.className = 'vfa-candidate-num';
      numEl.textContent = String(i + 1);

      const nameEl = document.createElement('span');
      nameEl.className = 'vfa-candidate-name';
      nameEl.textContent = record.Name || record.Subject || String(record.Id || '');

      item.appendChild(numEl);
      item.appendChild(nameEl);

      item.addEventListener('click', () => {
        if (selectCallback) selectCallback(i + 1, record);
      });

      container.appendChild(item);
    });

    container.style.display = 'block';
  }

  /** 候補リストを非表示にして状態をリセットする */
  function hide() {
    container.style.display = 'none';
    selectCallback    = null;
    currentCandidates = [];
    clearItems();
  }

  /**
   * 番号（1-based）でレコードを選択する（音声番号選択用）
   * @param {number} n - 1-based の選択番号
   * @returns {boolean} 選択できた場合 true
   */
  function selectByNumber(n) {
    if (typeof n !== 'number' || n < 1 || n > currentCandidates.length) return false;
    const record = currentCandidates[n - 1];
    if (selectCallback) selectCallback(n, record);
    return true;
  }

  /** DOM から候補リストを削除する */
  function destroy() {
    container.remove();
  }

  return { show, hide, selectByNumber, destroy };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createCandidateList };
}
