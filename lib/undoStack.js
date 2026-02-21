'use strict';

// lib/undoStack.js
// update 前の値を最大10件 LIFO 保持・復元

const MAX_STACK_SIZE = 10;

/**
 * LIFO undo stack を生成する
 * @returns {{ push, pop, peek, clear, size, isEmpty }}
 */
function createUndoStack() {
  const stack = [];

  /**
   * エントリをスタックに追加する
   * MAX_STACK_SIZE を超えた場合は最古のエントリを削除する
   * @param {{ objectName: string, recordId: string, previousFields: object, updatedFields: object, timestamp: number }} entry
   */
  function push(entry) {
    if (!entry || typeof entry !== 'object') return;
    stack.push(entry);
    if (stack.length > MAX_STACK_SIZE) {
      stack.shift();
    }
  }

  /**
   * スタックの先頭（最新）エントリを取り出して削除する
   * @returns {object|null}
   */
  function pop() {
    return stack.length > 0 ? stack.pop() : null;
  }

  /**
   * スタックの先頭（最新）エントリを削除せずに返す
   * @returns {object|null}
   */
  function peek() {
    return stack.length > 0 ? stack[stack.length - 1] : null;
  }

  /** スタックを全削除する */
  function clear() {
    stack.length = 0;
  }

  /** スタックの現在の件数を返す */
  function size() {
    return stack.length;
  }

  /** スタックが空かどうかを返す */
  function isEmpty() {
    return stack.length === 0;
  }

  return { push, pop, peek, clear, size, isEmpty };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { createUndoStack, MAX_STACK_SIZE };
}
