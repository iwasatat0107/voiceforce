'use strict';

const { createUndoStack, MAX_STACK_SIZE } = require('../../lib/undoStack');

// ---------------------------------------------------------------------------
// テスト用フィクスチャ
// ---------------------------------------------------------------------------
function makeEntry(i = 0) {
  return {
    objectName:     'Opportunity',
    recordId:       `id${i}`,
    previousFields: { Amount: 1000000 * (i + 1) },
    updatedFields:  { Amount: 2000000 * (i + 1) },
    timestamp:      i,
  };
}

// ===========================================================================
// MAX_STACK_SIZE
// ===========================================================================
describe('MAX_STACK_SIZE', () => {
  test('最大スタックサイズが 10 である', () => {
    expect(MAX_STACK_SIZE).toBe(10);
  });
});

// ===========================================================================
// createUndoStack
// ===========================================================================
describe('createUndoStack', () => {
  let stack;

  beforeEach(() => {
    stack = createUndoStack();
  });

  // ── isEmpty / size ───────────────────────────────────────────────────
  describe('isEmpty() / size()', () => {
    test('初期状態は isEmpty=true, size=0', () => {
      expect(stack.isEmpty()).toBe(true);
      expect(stack.size()).toBe(0);
    });

    test('push 後は isEmpty=false', () => {
      stack.push(makeEntry());
      expect(stack.isEmpty()).toBe(false);
    });

    test('size は push した件数を返す', () => {
      stack.push(makeEntry(1));
      stack.push(makeEntry(2));
      expect(stack.size()).toBe(2);
    });
  });

  // ── push ─────────────────────────────────────────────────────────────────
  describe('push()', () => {
    test('エントリを追加できる', () => {
      stack.push(makeEntry(1));
      expect(stack.size()).toBe(1);
    });

    test('null を push しても size は変わらない', () => {
      stack.push(null);
      expect(stack.size()).toBe(0);
    });

    test('undefined を push しても size は変わらない', () => {
      stack.push(undefined);
      expect(stack.size()).toBe(0);
    });

    test('文字列を push しても size は変わらない', () => {
      stack.push('string');
      expect(stack.size()).toBe(0);
    });

    test(`MAX_STACK_SIZE(${MAX_STACK_SIZE})件までは全て保持する`, () => {
      for (let i = 0; i < MAX_STACK_SIZE; i++) stack.push(makeEntry(i));
      expect(stack.size()).toBe(MAX_STACK_SIZE);
    });

    test(`${MAX_STACK_SIZE + 1}件目に最古のエントリが削除される`, () => {
      for (let i = 0; i < MAX_STACK_SIZE + 1; i++) stack.push(makeEntry(i));
      expect(stack.size()).toBe(MAX_STACK_SIZE);
    });

    test('11件 push 後に peek は最後のエントリを返す', () => {
      for (let i = 0; i < MAX_STACK_SIZE + 1; i++) stack.push(makeEntry(i));
      expect(stack.peek().recordId).toBe(`id${MAX_STACK_SIZE}`);
    });

    test('11件 push 後に id0 (最古) は消えている', () => {
      for (let i = 0; i < MAX_STACK_SIZE + 1; i++) stack.push(makeEntry(i));
      const ids = [];
      let e;
      while ((e = stack.pop()) !== null) ids.push(e.recordId);
      expect(ids).not.toContain('id0');
    });
  });

  // ── pop ─────────────────────────────────────────────────────────────────
  describe('pop()', () => {
    test('LIFO 順に返す', () => {
      const e1 = makeEntry(1);
      const e2 = makeEntry(2);
      stack.push(e1);
      stack.push(e2);
      expect(stack.pop()).toBe(e2);
      expect(stack.pop()).toBe(e1);
    });

    test('空のスタックから pop すると null を返す', () => {
      expect(stack.pop()).toBeNull();
    });

    test('pop 後に size が減る', () => {
      stack.push(makeEntry(1));
      stack.push(makeEntry(2));
      stack.pop();
      expect(stack.size()).toBe(1);
    });

    test('全て pop した後は isEmpty=true', () => {
      stack.push(makeEntry(1));
      stack.pop();
      expect(stack.isEmpty()).toBe(true);
    });
  });

  // ── peek ────────────────────────────────────────────────────────────────
  describe('peek()', () => {
    test('最新エントリを返す（削除しない）', () => {
      const entry = makeEntry(1);
      stack.push(entry);
      expect(stack.peek()).toBe(entry);
      expect(stack.size()).toBe(1);
    });

    test('空のスタックの peek は null を返す', () => {
      expect(stack.peek()).toBeNull();
    });

    test('peek を何度呼んでも size は変わらない', () => {
      stack.push(makeEntry(1));
      stack.peek();
      stack.peek();
      expect(stack.size()).toBe(1);
    });
  });

  // ── clear ─────────────────────────────────────────────────────────────
  describe('clear()', () => {
    test('clear 後は isEmpty=true, size=0', () => {
      stack.push(makeEntry(1));
      stack.push(makeEntry(2));
      stack.clear();
      expect(stack.isEmpty()).toBe(true);
      expect(stack.size()).toBe(0);
    });

    test('clear 後に pop すると null を返す', () => {
      stack.push(makeEntry(1));
      stack.clear();
      expect(stack.pop()).toBeNull();
    });

    test('clear 後に再度 push できる', () => {
      stack.push(makeEntry(1));
      stack.clear();
      stack.push(makeEntry(2));
      expect(stack.size()).toBe(1);
      expect(stack.peek().recordId).toBe('id2');
    });
  });
});
