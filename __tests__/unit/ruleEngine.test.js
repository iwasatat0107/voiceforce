'use strict';

const ruleEngine = require('../../lib/ruleEngine');

describe('RuleEngine', () => {
  // ─── navigate patterns ────────────────────────────────────────────────────

  describe('navigate patterns - オブジェクト名のみ', () => {
    test.each([
      ['商談',           'Opportunity'],
      ['取引先',         'Account'],
      ['リード',         'Lead'],
      ['取引先責任者',   'Contact'],
      ['タスク',         'Task'],
      ['行動',           'Event'],
      ['ToDo',           'Task'],
    ])('「%s」→ navigate/%s/list', (input, object) => {
      const result = ruleEngine.match(input);
      expect(result).toEqual(expect.objectContaining({
        action: 'navigate',
        object,
        target: 'list',
        confidence: 1.0,
      }));
    });
  });

  describe('navigate patterns - 一覧/リスト付き', () => {
    test.each([
      ['商談の一覧',     'Opportunity'],
      ['商談一覧',       'Opportunity'],
      ['商談リスト',     'Opportunity'],
      ['商談のリスト',   'Opportunity'],
      ['取引先の一覧',   'Account'],
    ])('「%s」→ navigate/%s/list', (input, object) => {
      const result = ruleEngine.match(input);
      expect(result).toEqual(expect.objectContaining({
        action: 'navigate',
        object,
        target: 'list',
        confidence: 1.0,
      }));
    });
  });

  describe('navigate patterns - 動詞付き（をなし）', () => {
    test.each([
      ['商談出して',   'Opportunity'],
      ['商談開いて',   'Opportunity'],
      ['商談見せて',   'Opportunity'],
      ['商談表示',     'Opportunity'],
    ])('「%s」→ navigate/%s/list', (input, object) => {
      const result = ruleEngine.match(input);
      expect(result).toEqual(expect.objectContaining({
        action: 'navigate',
        object,
        target: 'list',
      }));
    });
  });

  describe('navigate patterns - 動詞付き（をあり）', () => {
    test.each([
      ['商談を開いて'],
      ['商談を出して'],
      ['商談を見せて'],
      ['商談を表示'],
    ])('「%s」→ navigate/Opportunity/list', (input) => {
      const result = ruleEngine.match(input);
      expect(result).toEqual(expect.objectContaining({
        action: 'navigate',
        object: 'Opportunity',
        target: 'list',
      }));
    });
  });

  describe('navigate patterns - 一覧＋動詞（DESIGN_DOC主要テストケース）', () => {
    test('「商談一覧出して」→ navigate/Opportunity/list (full object)', () => {
      const result = ruleEngine.match('商談一覧出して');
      expect(result).toEqual({
        action: 'navigate',
        object: 'Opportunity',
        target: 'list',
        confidence: 1.0,
        message: '商談の一覧を開きます',
      });
    });

    test.each([
      ['商談の一覧出して',   'Opportunity'],
      ['商談一覧を開いて',   'Opportunity'],
      ['商談の一覧を開いて', 'Opportunity'],
      ['取引先一覧出して',   'Account'],
    ])('「%s」→ navigate/%s/list', (input, object) => {
      const result = ruleEngine.match(input);
      expect(result).toEqual(expect.objectContaining({
        action: 'navigate',
        object,
        target: 'list',
      }));
    });
  });

  describe('navigate - message フィールド', () => {
    test('商談 → message に日本語ラベルが含まれる', () => {
      expect(ruleEngine.match('商談').message).toBe('商談の一覧を開きます');
    });

    test('取引先 → message', () => {
      expect(ruleEngine.match('取引先').message).toBe('取引先の一覧を開きます');
    });

    test('リード → message', () => {
      expect(ruleEngine.match('リード').message).toBe('リードの一覧を開きます');
    });
  });

  describe('navigate - マッチしないパターン（→ null）', () => {
    test('「田中商事の商談を開いて」→ null', () => {
      expect(ruleEngine.match('田中商事の商談を開いて')).toBeNull();
    });

    test('「田中商事の商談の金額を500万にして」→ null', () => {
      expect(ruleEngine.match('田中商事の商談の金額を500万にして')).toBeNull();
    });
  });

  // ─── confirm patterns ─────────────────────────────────────────────────────

  describe('confirm patterns - はい系', () => {
    test.each([
      ['はい'],
      ['うん'],
      ['OK'],
      ['オッケー'],
      ['いいよ'],
      ['お願い'],
      ['実行して'],
      ['そう'],
      ['ええ'],
    ])('「%s」→ confirm/true', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'confirm', value: true });
    });
  });

  describe('confirm patterns - いいえ系', () => {
    test.each([
      ['いいえ'],
      ['いや'],
      ['やめて'],
      ['キャンセル'],
      ['違う'],
      ['やめ'],
      ['だめ'],
      ['ダメ'],
    ])('「%s」→ confirm/false', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'confirm', value: false });
    });
  });

  // ─── back patterns ────────────────────────────────────────────────────────

  describe('back patterns', () => {
    test.each([
      ['戻って'],
      ['戻る'],
      ['バック'],
      ['前の画面'],
      ['前に戻って'],
    ])('「%s」→ back', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'back' });
    });
  });

  // ─── stop patterns ────────────────────────────────────────────────────────

  describe('stop patterns', () => {
    test.each([
      ['止めて'],
      ['停止'],
      ['ストップ'],
      ['終わり'],
      ['おしまい'],
    ])('「%s」→ stop', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'stop' });
    });
  });

  // ─── undo patterns ────────────────────────────────────────────────────────

  describe('undo patterns', () => {
    test.each([
      ['元に戻して'],
      ['アンドゥ'],
      ['取り消し'],
      ['取り消して'],
      ['やり直し'],
    ])('「%s」→ undo', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'undo' });
    });
  });

  // ─── select patterns ──────────────────────────────────────────────────────

  describe('select patterns - 半角数字', () => {
    test.each([
      ['1', 1],
      ['2', 2],
      ['3', 3],
      ['4', 4],
      ['5', 5],
    ])('「%s」→ select/%d', (input, expected) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'select', index: expected });
    });
  });

  describe('select patterns - 番付き', () => {
    test.each([
      ['1番', 1],
      ['2番', 2],
      ['3番', 3],
      ['4番', 4],
      ['5番', 5],
    ])('「%s」→ select/%d', (input, expected) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'select', index: expected });
    });
  });

  describe('select patterns - 漢数字', () => {
    test.each([
      ['一', 1],
      ['二', 2],
      ['三', 3],
      ['四', 4],
      ['五', 5],
    ])('「%s」→ select/%d', (input, expected) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'select', index: expected });
    });
  });

  describe('select patterns - 範囲外はマッチしない', () => {
    test.each([
      ['6'],
      ['0'],
      ['六'],
    ])('「%s」→ null（範囲外）', (input) => {
      expect(ruleEngine.match(input)).toBeNull();
    });
  });

  // ─── help patterns ────────────────────────────────────────────────────────

  describe('help patterns', () => {
    test.each([
      ['ヘルプ'],
      ['使い方'],
      ['何ができる'],
      ['help'],
    ])('「%s」→ help', (input) => {
      expect(ruleEngine.match(input)).toEqual({ action: 'help' });
    });
  });

  // ─── edge cases ───────────────────────────────────────────────────────────

  describe('edge cases', () => {
    test('空文字 → null', () => {
      expect(ruleEngine.match('')).toBeNull();
    });

    test('null → null', () => {
      expect(ruleEngine.match(null)).toBeNull();
    });

    test('undefined → null', () => {
      expect(ruleEngine.match(undefined)).toBeNull();
    });

    test('スペースのみ → null', () => {
      expect(ruleEngine.match('   ')).toBeNull();
    });

    test('記号のみ → null', () => {
      expect(ruleEngine.match('!!!!')).toBeNull();
    });

    test('前後のスペースはトリムして処理', () => {
      expect(ruleEngine.match(' はい ')).toEqual({ action: 'confirm', value: true });
    });

    test('長文 → null', () => {
      expect(ruleEngine.match('田中商事というお客さんの電話番号を変更してください')).toBeNull();
    });

    test('数値型 → null', () => {
      expect(ruleEngine.match(123)).toBeNull();
    });
  });

  // ─── 入力長制限（Fix 11） ──────────────────────────────────────────────
  describe('入力長制限', () => {
    test('500文字 → 正常処理（マッチしない文字列だが null を返す）', () => {
      const input = 'あ'.repeat(500);
      // 500文字の入力はマッチしないため null だが、ReDoS 防止で処理される
      expect(ruleEngine.match(input)).toBeNull();
    });

    test('501文字 → null（長さ制限で即座に拒否）', () => {
      const input = 'あ'.repeat(501);
      expect(ruleEngine.match(input)).toBeNull();
    });

    test('500文字でマッチする文字列 → 正常処理', () => {
      // 先頭に「はい」+ 残りスペースで500文字（トリム後は「はい」）
      const input = 'はい' + ' '.repeat(498);
      expect(ruleEngine.match(input)).toEqual({ action: 'confirm', value: true });
    });
  });
});
