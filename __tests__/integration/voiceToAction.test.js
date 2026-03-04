'use strict';

const { match }                            = require('../../lib/ruleEngine');
const { buildListUrl, buildRecordUrl, navigateTo, goBack } = require('../../lib/navigator');
const { resolve, RESULT_CATEGORY }         = require('../../lib/recordResolver');
const { createWidget, STATES }             = require('../../ui/widget');
const { createCandidateList }              = require('../../ui/candidateList');
const { OBJECT_DISPLAY_FIELDS }            = require('../../lib/salesforceApi');
const { validateLLMOutput, resolveIntent } = require('../../lib/intentResolver');

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

  // ── 0件・複数件 → ウィジェット内完結フロー ──────────────────────────────
  describe('0件・複数件 → ウィジェット内完結フロー', () => {
    let widget;
    let cl;

    beforeEach(() => {
      const existing = document.getElementById('vfa-widget');
      if (existing) existing.remove();
      const existingCL = document.getElementById('vfa-candidate-list');
      if (existingCL) existingCL.remove();
      widget = createWidget();
      cl = null;
      jest.useFakeTimers();
    });

    afterEach(() => {
      widget.destroy();
      if (cl) cl.destroy();
      jest.useRealTimers();
    });

    test('0件 → resolve が not_found を返す', () => {
      const resolved = resolve([]);
      expect(resolved.category).toBe(RESULT_CATEGORY.NOT_FOUND);
    });

    test('0件（初回）→ editing 状態に遷移しキーワードが入力欄にセットされる', () => {
      const keyword = 'たなか商事';
      const resolved = resolve([]);
      expect(resolved.category).toBe(RESULT_CATEGORY.NOT_FOUND);

      // content.js の not_found 初回分岐をシミュレート
      const onConfirm = jest.fn();
      widget.setState(STATES.EDITING, { keyword, sfObject: 'Account', onConfirm, onCancel: jest.fn() });
      expect(widget.getState()).toBe(STATES.EDITING);
      const input = document.getElementById('vfa-widget').querySelector('.vfa-edit-input');
      expect(input.value).toBe(keyword);
    });

    test('0件（初回）→ editing から Enter で onConfirm が呼ばれる', () => {
      const keyword = 'たなか商事';
      const onConfirm = jest.fn();
      widget.setState(STATES.EDITING, { keyword, sfObject: 'Account', onConfirm, onCancel: jest.fn() });
      const input = document.getElementById('vfa-widget').querySelector('.vfa-edit-input');
      input.value = '田中商事';
      input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
      expect(onConfirm).toHaveBeenCalledWith('田中商事', 'Account');
    });

    test('0件（再検索）→ success 状態に遷移し「検索不一致」が表示される', () => {
      const keyword = '田中商事';
      // isRetry=true の分岐をシミュレート
      widget.setState(STATES.SUCCESS, { message: `検索不一致：「${keyword}」は見つかりませんでした` });
      expect(widget.getState()).toBe(STATES.SUCCESS);
      expect(document.getElementById('vfa-widget').querySelector('.vfa-message').textContent)
        .toContain('検索不一致');
    });

    test('0件（再検索）→ 3秒後に idle へ自動遷移する', () => {
      const keyword = '田中商事';
      widget.setState(STATES.SUCCESS, { message: `検索不一致：「${keyword}」は見つかりませんでした` });
      jest.advanceTimersByTime(3000);
      expect(widget.getState()).toBe(STATES.IDLE);
    });

    test('2-5件 → selecting 状態に遷移し candidateList が表示される', () => {
      const records = [
        { Id: 'acc001', Name: 'ABC株式会社' },
        { Id: 'acc002', Name: 'ABC商事' },
      ];
      const resolved = resolve(records);
      expect(resolved.category).toBe(RESULT_CATEGORY.MULTIPLE);

      cl = createCandidateList();
      let selected = null;
      cl.show(records, (_idx, record) => { selected = record; });

      widget.setState(STATES.SELECTING, { message: resolved.message });
      expect(widget.getState()).toBe(STATES.SELECTING);
      expect(document.getElementById('vfa-candidate-list').style.display).toBe('block');

      // 音声番号選択（「1番」）をシミュレート
      const result = cl.selectByNumber(1);
      expect(result).toBe(true);
      expect(selected).toEqual(records[0]);
    });

    test('6件以上 → error 状態に遷移し絞り込みメッセージが表示される', () => {
      const records = Array.from({ length: 7 }, (_, i) => ({ Id: `id${i}`, Name: `ABC${i}` }));
      const resolved = resolve(records);
      expect(resolved.category).toBe(RESULT_CATEGORY.TOO_MANY);

      widget.setState(STATES.ERROR, { message: resolved.message });
      expect(widget.getState()).toBe(STATES.ERROR);
      expect(document.getElementById('vfa-widget').querySelector('.vfa-message').textContent)
        .toContain('絞り込');
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

  // ── ヘルプコマンド ────────────────────────────────────────────────────────
  describe('ヘルプコマンド（#73）', () => {
    test('「ヘルプ」は ruleEngine で action: help に変換される', () => {
      const intent = match('ヘルプ');
      expect(intent).not.toBeNull();
      expect(intent.action).toBe('help');
    });

    test('「使い方」は ruleEngine で action: help に変換される', () => {
      const intent = match('使い方');
      expect(intent).not.toBeNull();
      expect(intent.action).toBe('help');
    });

    test('help intent を受けたウィジェットは success 状態で自動消滅しない', () => {
      jest.useFakeTimers();
      const existing = document.getElementById('vfa-widget');
      if (existing) existing.remove();
      const w = createWidget();

      // ヘルプ表示: duration: null で自動消滅しない
      w.setState(STATES.SUCCESS, { message: 'ヘルプ一覧', duration: null });
      jest.advanceTimersByTime(60000);
      expect(w.getState()).toBe(STATES.SUCCESS);

      w.destroy();
      jest.useRealTimers();
    });
  });

  // ── LLM フォールバック（#76）─────────────────────────────────────────────
  describe('LLMフォールバック（#76）', () => {
    const WORKER_URL = 'https://voiceforce-worker.iwasatat0107.workers.dev';
    const USER_ID    = 'ext-test-user';

    beforeEach(() => {
      global.fetch = jest.fn();
    });

    afterEach(() => {
      jest.resetAllMocks();
    });

    test('ruleEngine が null → resolveIntent を呼び出し navigate レスポンスを受け取る', async () => {
      const llmResponse = { action: 'navigate', target: 'list', object: 'Opportunity', confidence: 0.92, message: '商談一覧を開きます' };
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => llmResponse });

      const result = await resolveIntent('パイプラインを見せて', '', WORKER_URL, USER_ID);
      expect(result.action).toBe('navigate');
      expect(result.object).toBe('Opportunity');
      expect(validateLLMOutput(result, null)).toBe(true);
    });

    test('resolveIntent が search レスポンスを返す → validateLLMOutput が true を返す', async () => {
      const llmResponse = { action: 'search', object: 'Account', search_term: '田中商事', confidence: 0.88 };
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => llmResponse });

      const result = await resolveIntent('田中商事を調べて', '', WORKER_URL, USER_ID);
      expect(validateLLMOutput(result, null)).toBe(true);
      expect(result.search_term).toBe('田中商事');
    });

    test('resolveIntent が unknown レスポンスを返す → validateLLMOutput が true を返す', async () => {
      const llmResponse = { action: 'unknown', confidence: 0.1, message: '操作を認識できませんでした' };
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => llmResponse });

      const result = await resolveIntent('今日の天気は？', '', WORKER_URL, USER_ID);
      expect(validateLLMOutput(result, null)).toBe(true);
      expect(result.action).toBe('unknown');
    });

    test('LLM が不正なaction（"delete"）を返した場合 validateLLMOutput が false を返す', async () => {
      const injectedResponse = { action: 'delete', object: 'Account', confidence: 0.9 };
      global.fetch.mockResolvedValueOnce({ ok: true, json: async () => injectedResponse });

      const result = await resolveIntent('テスト', '', WORKER_URL, USER_ID);
      expect(validateLLMOutput(result, null)).toBe(false);
    });

    test('Worker が 429 を返した場合エラーに .status=429 が付与される', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: false, status: 429,
        json: async () => ({ error: 'Rate limit exceeded. Please try again later.' }),
      });

      let err;
      try { await resolveIntent('テスト', '', WORKER_URL, USER_ID); }
      catch (e) { err = e; }
      expect(err).toBeDefined();
      expect(err.status).toBe(429);
    });

    test('ネットワークエラー時は Error がスローされる', async () => {
      global.fetch.mockRejectedValueOnce(new Error('fetch failed'));
      await expect(resolveIntent('テスト', '', WORKER_URL, USER_ID))
        .rejects.toThrow('fetch failed');
    });

    test('LLMフォールバックの入口: ruleEngine が null を返す発話の確認', () => {
      // これらの発話は ruleEngine ではハンドルできない → LLM フォールバックへ
      expect(match('今月のパイプラインを教えて')).toBeNull();
      expect(match('山田さんの商談を更新して')).toBeNull();
      expect(match('')).toBeNull();
    });
  });

  // ── レコード作成フロー（#92）──────────────────────────────────────────────
  describe('レコード作成フロー（#92）', () => {
    let widget;

    beforeEach(() => {
      const existing = document.getElementById('vfa-widget');
      if (existing) existing.remove();
      widget = createWidget();
    });

    afterEach(() => {
      widget.destroy();
    });

    test('STATES.FIELD_INPUT が定義されている', () => {
      expect(STATES.FIELD_INPUT).toBe('field-input');
    });

    test('LLM create レスポンス（Name あり）→ confirm 状態に遷移できる', () => {
      const llmIntent = { action: 'create', object: 'Account', fields: { Name: 'ABC株式会社' }, missing_fields: [], confidence: 0.9 };
      // missing_fields が空のとき → confirm 状態へ
      widget.setState(STATES.CONFIRM, {
        message: `取引先を作成します\n─────\n取引先名: ${llmIntent.fields.Name}\n─────\n「はい」で確定`,
        onConfirm: jest.fn(),
      });
      expect(widget.getState()).toBe(STATES.CONFIRM);
    });

    test('LLM create レスポンス（Name なし）→ field-input 状態に遷移できる', () => {
      const llmIntent = { action: 'create', object: 'Account', fields: {}, missing_fields: ['Name'], confidence: 0.8 };
      widget.setState(STATES.FIELD_INPUT, {
        fields: llmIntent.missing_fields.map(key => ({ label: key === 'Name' ? '取引先名' : key, key, value: '' })),
        onSubmit: jest.fn(),
        onCancel: jest.fn(),
      });
      expect(widget.getState()).toBe(STATES.FIELD_INPUT);
      const el = document.getElementById('vfa-widget');
      const inputs = el.querySelectorAll('.vfa-field-form input');
      expect(inputs.length).toBe(1);
      expect(inputs[0].getAttribute('data-key')).toBe('Name');
    });

    test('field-input で値を入力して確定 → onSubmit が呼ばれる', () => {
      const onSubmit = jest.fn();
      widget.setState(STATES.FIELD_INPUT, {
        fields: [{ label: '取引先名', key: 'Name', value: '' }],
        onSubmit,
        onCancel: jest.fn(),
      });
      const el = document.getElementById('vfa-widget');
      const input = el.querySelector('.vfa-field-form input[data-key="Name"]');
      input.value = 'テスト株式会社';
      el.querySelector('.vfa-btn-field-submit').click();
      expect(onSubmit).toHaveBeenCalledWith({ Name: 'テスト株式会社' });
    });

    test('confirm の「はい」クリックで onConfirm(true) が呼ばれる', () => {
      const onConfirm = jest.fn();
      widget.setState(STATES.CONFIRM, { message: '取引先を作成します', onConfirm });
      const el = document.getElementById('vfa-widget');
      el.querySelector('.vfa-btn-yes').click();
      expect(onConfirm).toHaveBeenCalledWith(true);
    });

    test('confirm の「いいえ」クリックで onConfirm(false) が呼ばれる', () => {
      const onConfirm = jest.fn();
      widget.setState(STATES.CONFIRM, { message: '取引先を作成します', onConfirm });
      const el = document.getElementById('vfa-widget');
      el.querySelector('.vfa-btn-no').click();
      expect(onConfirm).toHaveBeenCalledWith(false);
    });

    test('validateLLMOutput: create レスポンス（object あり）はホワイトリストを通過する', () => {
      const llmIntent = { action: 'create', object: 'Account', fields: { Name: 'ABC' }, missing_fields: [], confidence: 0.9 };
      expect(validateLLMOutput(llmIntent, null)).toBe(true);
    });
  });

  // ── 未認識コマンド（#74）──────────────────────────────────────────────────
  describe('未認識コマンド（#74）', () => {
    test('ruleEngine にマッチしない発話は null を返す', () => {
      expect(match('今月のパイプラインを教えて')).toBeNull();
      expect(match('山田さんの商談を更新して')).toBeNull();
      expect(match('')).toBeNull();
    });

    test('ruleEngine が null のとき error state でガイドメッセージを表示する', () => {
      jest.useFakeTimers();
      const existing = document.getElementById('vfa-widget');
      if (existing) existing.remove();
      const w = createWidget();

      const transcript = '今月のパイプラインを教えて';
      w.setState(STATES.ERROR, {
        message: `「${transcript}」は未対応のコマンドです\n「ヘルプ」と言うと使い方を確認できます`,
      });

      expect(w.getState()).toBe(STATES.ERROR);
      const el = document.getElementById('vfa-widget');
      expect(el.querySelector('.vfa-message').textContent)
        .toContain('未対応のコマンドです');
      expect(el.querySelector('.vfa-message').textContent)
        .toContain('ヘルプ');

      w.destroy();
      jest.useRealTimers();
    });
  });
});
