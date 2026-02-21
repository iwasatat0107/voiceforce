'use strict';

const {
  navigateTo,
  goBack,
  buildListUrl,
  buildRecordUrl,
  buildNewUrl,
} = require('../../lib/navigator');

const INSTANCE_URL = 'https://example.lightning.force.com';

function createMockWindow() {
  return { location: { href: '' }, history: { back: jest.fn() } };
}

// ===========================================================================
// buildListUrl
// ===========================================================================
describe('buildListUrl', () => {
  test('Opportunity 一覧URL を生成する', () => {
    expect(buildListUrl(INSTANCE_URL, 'Opportunity'))
      .toBe(`${INSTANCE_URL}/lightning/o/Opportunity/list`);
  });

  test('Account 一覧URL を生成する', () => {
    expect(buildListUrl(INSTANCE_URL, 'Account'))
      .toBe(`${INSTANCE_URL}/lightning/o/Account/list`);
  });

  test('Contact 一覧URL を生成する', () => {
    expect(buildListUrl(INSTANCE_URL, 'Contact'))
      .toBe(`${INSTANCE_URL}/lightning/o/Contact/list`);
  });
});

// ===========================================================================
// buildRecordUrl
// ===========================================================================
describe('buildRecordUrl', () => {
  test('レコード詳細URLを生成する', () => {
    expect(buildRecordUrl(INSTANCE_URL, 'Opportunity', '006000000000001'))
      .toBe(`${INSTANCE_URL}/lightning/r/Opportunity/006000000000001/view`);
  });

  test('Account レコードURLを生成する', () => {
    expect(buildRecordUrl(INSTANCE_URL, 'Account', '001abc'))
      .toBe(`${INSTANCE_URL}/lightning/r/Account/001abc/view`);
  });
});

// ===========================================================================
// buildNewUrl
// ===========================================================================
describe('buildNewUrl', () => {
  test('新規作成URLを生成する', () => {
    expect(buildNewUrl(INSTANCE_URL, 'Opportunity'))
      .toBe(`${INSTANCE_URL}/lightning/o/Opportunity/new`);
  });
});

// ===========================================================================
// navigateTo
// ===========================================================================
describe('navigateTo', () => {
  test('window.location.href を指定URLに設定する', () => {
    const mockWin = createMockWindow();
    const url = buildListUrl(INSTANCE_URL, 'Opportunity');
    navigateTo(url, mockWin);
    expect(mockWin.location.href).toBe(url);
  });

  test('レコードURLに遷移する', () => {
    const mockWin = createMockWindow();
    const url = buildRecordUrl(INSTANCE_URL, 'Opportunity', 'opp001');
    navigateTo(url, mockWin);
    expect(mockWin.location.href).toBe(url);
  });

  test('url が空文字の場合は何もしない', () => {
    const mockWin = createMockWindow();
    mockWin.location.href = 'original';
    navigateTo('', mockWin);
    expect(mockWin.location.href).toBe('original');
  });

  test('url が null の場合は何もしない', () => {
    const mockWin = createMockWindow();
    mockWin.location.href = 'original';
    navigateTo(null, mockWin);
    expect(mockWin.location.href).toBe('original');
  });

  test('win が null の場合は何もしない（例外なし）', () => {
    expect(() => navigateTo('https://example.com', null)).not.toThrow();
  });
});

// ===========================================================================
// goBack
// ===========================================================================
describe('goBack', () => {
  test('window.history.back() を呼び出す', () => {
    const mockWin = createMockWindow();
    goBack(mockWin);
    expect(mockWin.history.back).toHaveBeenCalledTimes(1);
  });

  test('複数回呼び出せる', () => {
    const mockWin = createMockWindow();
    goBack(mockWin);
    goBack(mockWin);
    expect(mockWin.history.back).toHaveBeenCalledTimes(2);
  });

  test('win が null の場合は何もしない（例外なし）', () => {
    expect(() => goBack(null)).not.toThrow();
  });
});
