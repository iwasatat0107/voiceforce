'use strict';

const { createCandidateList } = require('../../ui/candidateList');

// ---------------------------------------------------------------------------
// テスト用フィクスチャ
// ---------------------------------------------------------------------------
const CANDIDATES = [
  { Id: 'id1', Name: '田中商事' },
  { Id: 'id2', Name: 'ABC株式会社' },
  { Id: 'id3', Name: 'テスト商会' },
];

// ===========================================================================
// createCandidateList
// ===========================================================================
describe('createCandidateList', () => {
  let list;

  beforeEach(() => {
    list = createCandidateList();
  });

  afterEach(() => {
    list.destroy();
  });

  // ── DOM 初期状態 ────────────────────────────────────────────────────────
  describe('初期状態', () => {
    test('document.body に #vfa-candidate-list が追加される', () => {
      expect(document.getElementById('vfa-candidate-list')).not.toBeNull();
    });

    test('初期状態は非表示', () => {
      const el = document.getElementById('vfa-candidate-list');
      expect(el.style.display).toBe('none');
    });

    test('role="list" 属性が設定されている', () => {
      const el = document.getElementById('vfa-candidate-list');
      expect(el.getAttribute('role')).toBe('list');
    });
  });

  // ── show ────────────────────────────────────────────────────────────────
  describe('show()', () => {
    test('候補を渡すと表示される', () => {
      list.show(CANDIDATES, jest.fn());
      const el = document.getElementById('vfa-candidate-list');
      expect(el.style.display).toBe('block');
    });

    test('候補の数だけアイテムが生成される', () => {
      list.show(CANDIDATES, jest.fn());
      const items = document.querySelectorAll('.vfa-candidate-item');
      expect(items.length).toBe(CANDIDATES.length);
    });

    test('各アイテムに番号が表示される', () => {
      list.show(CANDIDATES, jest.fn());
      const nums = document.querySelectorAll('.vfa-candidate-num');
      expect(nums[0].textContent).toBe('1');
      expect(nums[1].textContent).toBe('2');
      expect(nums[2].textContent).toBe('3');
    });

    test('各アイテムに Name が表示される（XSS防止: textContent）', () => {
      list.show(CANDIDATES, jest.fn());
      const names = document.querySelectorAll('.vfa-candidate-name');
      expect(names[0].textContent).toBe('田中商事');
      expect(names[1].textContent).toBe('ABC株式会社');
    });

    test('Name がなく Subject があるレコードは Subject を表示する', () => {
      list.show([{ Id: 'id1', Subject: '電話フォローアップ' }], jest.fn());
      const name = document.querySelector('.vfa-candidate-name');
      expect(name.textContent).toBe('電話フォローアップ');
    });

    test('Name も Subject もない場合は Id を表示する', () => {
      list.show([{ Id: 'unknown-id' }], jest.fn());
      const name = document.querySelector('.vfa-candidate-name');
      expect(name.textContent).toBe('unknown-id');
    });

    test('data-index 属性が 1-based で設定される', () => {
      list.show(CANDIDATES, jest.fn());
      const items = document.querySelectorAll('.vfa-candidate-item');
      expect(items[0].getAttribute('data-index')).toBe('1');
      expect(items[2].getAttribute('data-index')).toBe('3');
    });

    test('空配列を渡すと非表示のまま', () => {
      list.show([], jest.fn());
      const el = document.getElementById('vfa-candidate-list');
      expect(el.style.display).toBe('none');
    });

    test('再 show で前の候補が上書きされる', () => {
      list.show(CANDIDATES, jest.fn());
      list.show([{ Id: 'new', Name: '新候補' }], jest.fn());
      const items = document.querySelectorAll('.vfa-candidate-item');
      expect(items.length).toBe(1);
      expect(document.querySelector('.vfa-candidate-name').textContent).toBe('新候補');
    });

    test('onSelect が null でも例外が出ない', () => {
      expect(() => list.show(CANDIDATES, null)).not.toThrow();
    });
  });

  // ── クリックイベント ─────────────────────────────────────────────────────
  describe('クリックイベント', () => {
    test('アイテムをクリックすると onSelect が呼ばれる', () => {
      const onSelect = jest.fn();
      list.show(CANDIDATES, onSelect);
      const items = document.querySelectorAll('.vfa-candidate-item');
      items[1].click();
      expect(onSelect).toHaveBeenCalledWith(2, CANDIDATES[1]);
    });

    test('1番目クリックで index=1, record=CANDIDATES[0] が渡される', () => {
      const onSelect = jest.fn();
      list.show(CANDIDATES, onSelect);
      document.querySelectorAll('.vfa-candidate-item')[0].click();
      expect(onSelect).toHaveBeenCalledWith(1, CANDIDATES[0]);
    });
  });

  // ── hide ────────────────────────────────────────────────────────────────
  describe('hide()', () => {
    test('hide() で非表示になる', () => {
      list.show(CANDIDATES, jest.fn());
      list.hide();
      const el = document.getElementById('vfa-candidate-list');
      expect(el.style.display).toBe('none');
    });

    test('hide() でアイテムがクリアされる', () => {
      list.show(CANDIDATES, jest.fn());
      list.hide();
      const items = document.querySelectorAll('.vfa-candidate-item');
      expect(items.length).toBe(0);
    });
  });

  // ── selectByNumber ───────────────────────────────────────────────────────
  describe('selectByNumber()', () => {
    test('有効な番号で onSelect が呼ばれ true を返す', () => {
      const onSelect = jest.fn();
      list.show(CANDIDATES, onSelect);
      const result = list.selectByNumber(2);
      expect(result).toBe(true);
      expect(onSelect).toHaveBeenCalledWith(2, CANDIDATES[1]);
    });

    test('1番を選択すると CANDIDATES[0] が渡される', () => {
      const onSelect = jest.fn();
      list.show(CANDIDATES, onSelect);
      list.selectByNumber(1);
      expect(onSelect).toHaveBeenCalledWith(1, CANDIDATES[0]);
    });

    test('範囲外の番号（0）は false を返す', () => {
      list.show(CANDIDATES, jest.fn());
      expect(list.selectByNumber(0)).toBe(false);
    });

    test('範囲外の番号（4 > length 3）は false を返す', () => {
      list.show(CANDIDATES, jest.fn());
      expect(list.selectByNumber(4)).toBe(false);
    });

    test('候補が表示されていない状態では false を返す', () => {
      expect(list.selectByNumber(1)).toBe(false);
    });

    test('数値以外は false を返す', () => {
      list.show(CANDIDATES, jest.fn());
      expect(list.selectByNumber('1')).toBe(false);
    });
  });

  // ── destroy ─────────────────────────────────────────────────────────────
  describe('destroy()', () => {
    test('destroy() で DOM から要素が削除される', () => {
      list.destroy();
      expect(document.getElementById('vfa-candidate-list')).toBeNull();
    });
  });
});
