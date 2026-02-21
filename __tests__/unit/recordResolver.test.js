'use strict';

const { categorize, resolve, selectByIndex, RESULT_CATEGORY } = require('../../lib/recordResolver');

// ---------------------------------------------------------------------------
// テスト用フィクスチャ
// ---------------------------------------------------------------------------
function makeRecords(n) {
  return Array.from({ length: n }, (_, i) => ({ Id: `id${i}`, Name: `レコード${i + 1}` }));
}

// ===========================================================================
// RESULT_CATEGORY
// ===========================================================================
describe('RESULT_CATEGORY', () => {
  test('4種のカテゴリが定義されている', () => {
    expect(RESULT_CATEGORY.NOT_FOUND).toBe('not_found');
    expect(RESULT_CATEGORY.SINGLE).toBe('single');
    expect(RESULT_CATEGORY.MULTIPLE).toBe('multiple');
    expect(RESULT_CATEGORY.TOO_MANY).toBe('too_many');
  });
});

// ===========================================================================
// categorize
// ===========================================================================
describe('categorize', () => {
  test('0件 → NOT_FOUND', () => {
    expect(categorize([])).toBe(RESULT_CATEGORY.NOT_FOUND);
  });

  test('1件 → SINGLE', () => {
    expect(categorize(makeRecords(1))).toBe(RESULT_CATEGORY.SINGLE);
  });

  test('2件 → MULTIPLE', () => {
    expect(categorize(makeRecords(2))).toBe(RESULT_CATEGORY.MULTIPLE);
  });

  test('5件 → MULTIPLE（上限）', () => {
    expect(categorize(makeRecords(5))).toBe(RESULT_CATEGORY.MULTIPLE);
  });

  test('6件 → TOO_MANY（下限）', () => {
    expect(categorize(makeRecords(6))).toBe(RESULT_CATEGORY.TOO_MANY);
  });

  test('10件 → TOO_MANY', () => {
    expect(categorize(makeRecords(10))).toBe(RESULT_CATEGORY.TOO_MANY);
  });

  test('配列以外 → NOT_FOUND', () => {
    expect(categorize(null)).toBe(RESULT_CATEGORY.NOT_FOUND);
    expect(categorize(undefined)).toBe(RESULT_CATEGORY.NOT_FOUND);
    expect(categorize('string')).toBe(RESULT_CATEGORY.NOT_FOUND);
    expect(categorize(42)).toBe(RESULT_CATEGORY.NOT_FOUND);
  });
});

// ===========================================================================
// resolve
// ===========================================================================
describe('resolve', () => {
  describe('NOT_FOUND（0件）', () => {
    let result;
    beforeEach(() => { result = resolve([]); });

    test('category が not_found', () => {
      expect(result.category).toBe(RESULT_CATEGORY.NOT_FOUND);
    });
    test('record が null', () => {
      expect(result.record).toBeNull();
    });
    test('candidates が空配列', () => {
      expect(result.candidates).toEqual([]);
    });
    test('message に再試行を促す文言がある', () => {
      expect(result.message).toContain('見つかりません');
    });
  });

  describe('SINGLE（1件）', () => {
    const records = makeRecords(1);
    let result;
    beforeEach(() => { result = resolve(records); });

    test('category が single', () => {
      expect(result.category).toBe(RESULT_CATEGORY.SINGLE);
    });
    test('record が records[0]', () => {
      expect(result.record).toBe(records[0]);
    });
    test('candidates が空配列', () => {
      expect(result.candidates).toEqual([]);
    });
    test('message が null', () => {
      expect(result.message).toBeNull();
    });
  });

  describe('MULTIPLE（2〜5件）', () => {
    const records = makeRecords(3);
    let result;
    beforeEach(() => { result = resolve(records); });

    test('category が multiple', () => {
      expect(result.category).toBe(RESULT_CATEGORY.MULTIPLE);
    });
    test('record が null', () => {
      expect(result.record).toBeNull();
    });
    test('candidates が全レコード', () => {
      expect(result.candidates).toBe(records);
    });
    test('message に件数と選択を促す文言がある', () => {
      expect(result.message).toContain('3件');
      expect(result.message).toContain('番号で選択');
    });

    test('5件のときも MULTIPLE', () => {
      const r = resolve(makeRecords(5));
      expect(r.category).toBe(RESULT_CATEGORY.MULTIPLE);
      expect(r.message).toContain('5件');
    });
  });

  describe('TOO_MANY（6+件）', () => {
    const records = makeRecords(7);
    let result;
    beforeEach(() => { result = resolve(records); });

    test('category が too_many', () => {
      expect(result.category).toBe(RESULT_CATEGORY.TOO_MANY);
    });
    test('record が null', () => {
      expect(result.record).toBeNull();
    });
    test('candidates が空配列', () => {
      expect(result.candidates).toEqual([]);
    });
    test('message に件数と絞り込みを促す文言がある', () => {
      expect(result.message).toContain('7件');
      expect(result.message).toContain('絞り込');
    });
  });

  describe('配列以外の入力', () => {
    test('null は NOT_FOUND として扱う', () => {
      expect(resolve(null).category).toBe(RESULT_CATEGORY.NOT_FOUND);
    });
  });
});

// ===========================================================================
// selectByIndex
// ===========================================================================
describe('selectByIndex', () => {
  const candidates = makeRecords(5);

  test('index=1 は candidates[0] を返す', () => {
    expect(selectByIndex(candidates, 1)).toBe(candidates[0]);
  });

  test('index=5 は candidates[4] を返す', () => {
    expect(selectByIndex(candidates, 5)).toBe(candidates[4]);
  });

  test('index=3 は candidates[2] を返す', () => {
    expect(selectByIndex(candidates, 3)).toBe(candidates[2]);
  });

  test('index=0 は null を返す（範囲外）', () => {
    expect(selectByIndex(candidates, 0)).toBeNull();
  });

  test('index が candidates.length を超える場合は null', () => {
    expect(selectByIndex(candidates, 6)).toBeNull();
  });

  test('index が負数の場合は null', () => {
    expect(selectByIndex(candidates, -1)).toBeNull();
  });

  test('index が数値以外の場合は null', () => {
    expect(selectByIndex(candidates, '1')).toBeNull();
    expect(selectByIndex(candidates, null)).toBeNull();
  });

  test('candidates が配列以外の場合は null', () => {
    expect(selectByIndex(null, 1)).toBeNull();
    expect(selectByIndex(undefined, 1)).toBeNull();
  });

  test('空配列からの選択は null', () => {
    expect(selectByIndex([], 1)).toBeNull();
  });
});
