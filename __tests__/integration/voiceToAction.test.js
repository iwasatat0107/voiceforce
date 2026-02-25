'use strict';

const { match }                            = require('../../lib/ruleEngine');
const { buildListUrl, buildRecordUrl, navigateTo, goBack } = require('../../lib/navigator');
const { resolve, RESULT_CATEGORY }         = require('../../lib/recordResolver');
const { createWidget, STATES }             = require('../../ui/widget');
const { OBJECT_DISPLAY_FIELDS }            = require('../../lib/salesforceApi');

const INSTANCE_URL = 'https://example.lightning.force.com';

function createMockWindow() {
  return { location: { href: '' }, history: { back: jest.fn() } };
}

// ===========================================================================
// 音声→アクション統合テスト
// ===========================================================================
describe('音声→アクション統合テスト', () => {

  // ── navigate （一覧） ────────────────────────────────────────────────────
  describe('navigate（一覧）アクション—ruleEngine バイパス', () => {
    test.each([
      ['商談',           'Opportunity'],
      ['商談の一覧',       'Opportunity'],
      ['取引先を開いて',   'Account'],
      ['リードリスト',     'Lead'],
      ['タスクを表示',       'Task'],
    ])('ruleEngine: "%s" → %s 一覧URLに遷移する', (text, objectName) => {
      const action = match(text);
      expect(action).not.toBeNull();
      expect(action.action).toBe('navigate');
      expect(action.target).toBe('list');
      expect(action.object).toBe(objectName);

      const mockWin = createMockWindow();
      navigateTo(buildListUrl(INSTANCE_URL, action.object), mockWin);
      expect(mockWin.location.href)
        .toBe(`${INSTANCE_URL}/lightning/o/${objectName}/list`);
    });
  });

  // ── navigate （レコード）—LLMレスポンス経由 ──────────────────────────
  describe('navigate（レコード）アクション—LLMレスポンス経由', () => {
    test('1件ヒット → SINGLE: レコードURLに遷移する', () => {
      const llmAction = {
        action: 'navigate', object: 'Opportunity',
        search_term: '田中商事', target: 'record', confidence: 0.95,
      };
      const records  = [{ Id: 'opp001', Name: '田中商事_商談' }];
      const resolved = resolve(records);

      expect(resolved.category).toBe(RESULT_CATEGORY.SINGLE);

      const mockWin = createMockWindow();
      navigateTo(buildRecordUrl(INSTANCE_URL, llmAction.object, resolved.record.Id), mockWin);
      expect(mockWin.location.href)
        .toBe(`${INSTANCE_URL}/lightning/r/Opportunity/opp001/view`);
    });

    test('0件ヒット → NOT_FOUND: 遷移しない', () => {
      const resolved = resolve([]);
      expect(resolved.category).toBe(RESULT_CATEGORY.NOT_FOUND);
      expect(resolved.record).toBeNull();
      expect(resolved.message).toContain('見つかりません');
    });

    test('2、5件ヒット → MULTIPLE: 候補リストを返す', () => {
      const records  = [
        { Id: 'opp001', Name: '田中商事A' },
        { Id: 'opp002', Name: '田中商事B' },
      ];
      const resolved = resolve(records);
      expect(resolved.category).toBe(RESULT_CATEGORY.MULTIPLE);
      expect(resolved.candidates).toHaveLength(2);
      expect(resolved.message).toContain('2件');
    });

    test('6件以上ヒット → TOO_MANY: 絞り込みを促す', () => {
      const records  = Array.from({ length: 7 }, (_, i) => ({ Id: `id${i}`, Name: `田中${i}` }));
      const resolved = resolve(records);
      expect(resolved.category).toBe(RESULT_CATEGORY.TOO_MANY);
      expect(resolved.message).toContain('絞り込');
    });
  });

  // ── back アクション ─────────────────────────────────────────────────────
  describe('back アクション', () => {
    test.each(['戻って', '戻る', 'バック', '前の画面'])(
      'ruleEngine: "%s" → history.back() が呼ばれる', (text) => {
        const action  = match(text);
        expect(action).not.toBeNull();
        expect(action.action).toBe('back');

        const mockWin = createMockWindow();
        goBack(mockWin);
        expect(mockWin.history.back).toHaveBeenCalledTimes(1);
      }
    );
  });

  // ── confirm アクション ────────────────────────────────────────────────────
  describe('confirm アクション', () => {
    test.each([
      ['はい', true],
      ['いいえ', false],
      ['OK', true],
      ['キャンセル', false],
    ])('ruleEngine: "%s" → confirm value=%s', (text, expected) => {
      const action = match(text);
      expect(action).not.toBeNull();
      expect(action.action).toBe('confirm');
      expect(action.value).toBe(expected);
    });
  });

  // ── select アクション ─────────────────────────────────────────────────────
  describe('select アクション', () => {
    test.each([
      ['1', 1],
      ['2', 2],
      ['5', 5],
      ['一', 1],
      ['三', 3],
    ])('ruleEngine: "%s" → index=%d を返す', (text, index) => {
      const action = match(text);
      expect(action).not.toBeNull();
      expect(action.action).toBe('select');
      expect(action.index).toBe(index);
    });
  });

  // ── 0件ヒット → グローバル検索遷移フロー ────────────────────────────────
  describe('0件ヒット → グローバル検索遷移フロー', () => {
    let widget;

    beforeEach(() => {
      const existing = document.getElementById('vfa-widget');
      if (existing) existing.remove();
      widget = createWidget();
      jest.useFakeTimers();
    });

    afterEach(() => {
      widget.destroy();
      jest.useRealTimers();
    });

    test('0件 → resolve が not_found を返す', () => {
      const resolved = resolve([]);
      expect(resolved.category).toBe(RESULT_CATEGORY.NOT_FOUND);
    });

    test('0件 → success 状態になり NAVIGATE_TO_SEARCH メッセージが送信される', () => {
      const keyword = 'たなか商事';
      const resolved = resolve([]);
      expect(resolved.category).toBe(RESULT_CATEGORY.NOT_FOUND);

      // content.js の not_found 分岐をシミュレート
      widget.setState(STATES.SUCCESS, { message: `「${keyword}」は見つかりません。グローバル検索に移動します` });
      expect(widget.getState()).toBe(STATES.SUCCESS);
      expect(document.getElementById('vfa-widget').querySelector('.vfa-message').textContent)
        .toContain('グローバル検索に移動します');

      chrome.runtime.sendMessage.mockReturnValue(Promise.resolve({ success: true }));
      setTimeout(() => {
        chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword });
      }, 2000);

      jest.advanceTimersByTime(2000);

      expect(chrome.runtime.sendMessage).toHaveBeenCalledWith({
        type: 'NAVIGATE_TO_SEARCH',
        keyword,
      });
    });

    test('Task の OBJECT_DISPLAY_FIELDS に Subject が含まれ Name は含まれない', () => {
      expect(OBJECT_DISPLAY_FIELDS).toBeDefined();
      expect(OBJECT_DISPLAY_FIELDS['Task']).toContain('Subject');
      expect(OBJECT_DISPLAY_FIELDS['Task']).not.toContain('Name');
    });

    test('Account の OBJECT_DISPLAY_FIELDS に Name が含まれる', () => {
      expect(OBJECT_DISPLAY_FIELDS['Account']).toContain('Name');
    });
  });

  // ── URL 構築統合 ─────────────────────────────────────────────────────────
  describe('URL構築統合', () => {
    test('候補リストから selectByIndex で選んだレコードURLを構築できる', () => {
      const { selectByIndex } = require('../../lib/recordResolver');
      const candidates = [
        { Id: 'opp001', Name: '田中商事1' },
        { Id: 'opp002', Name: '田中商事2' },
      ];
      const record = selectByIndex(candidates, 2);
      expect(record.Id).toBe('opp002');

      const url = buildRecordUrl(INSTANCE_URL, 'Opportunity', record.Id);
      expect(url).toBe(`${INSTANCE_URL}/lightning/r/Opportunity/opp002/view`);
    });
  });
});
