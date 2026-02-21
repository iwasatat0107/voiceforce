'use strict';

const { parseUrl, SF_URL_PATTERNS } = require('../../lib/navigator');

const INSTANCE_URL = 'https://example.lightning.force.com';

// ===========================================================================
// SF_URL_PATTERNS
// ===========================================================================
describe('SF_URL_PATTERNS', () => {
  test('RECORD パターンが定義されている', () => {
    expect(SF_URL_PATTERNS.RECORD).toBeInstanceOf(RegExp);
  });
  test('LIST パターンが定義されている', () => {
    expect(SF_URL_PATTERNS.LIST).toBeInstanceOf(RegExp);
  });
  test('NEW パターンが定義されている', () => {
    expect(SF_URL_PATTERNS.NEW).toBeInstanceOf(RegExp);
  });
  test('HOME パターンが定義されている', () => {
    expect(SF_URL_PATTERNS.HOME).toBeInstanceOf(RegExp);
  });
});

// ===========================================================================
// parseUrl
// ===========================================================================
describe('parseUrl', () => {

  // ── レコードページ ───────────────────────────────────────────────────────────
  describe('レコードページ (/lightning/r/.../view)', () => {
    test('Opportunity レコードページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/r/Opportunity/006000000000001/view`);
      expect(result.type).toBe('record');
      expect(result.objectName).toBe('Opportunity');
      expect(result.recordId).toBe('006000000000001');
    });

    test('Account レコードページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/r/Account/001000000000001/view`);
      expect(result.type).toBe('record');
      expect(result.objectName).toBe('Account');
    });

    test('18桁のレコードIDを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/r/Opportunity/006000000000001AAA/view`);
      expect(result.type).toBe('record');
      expect(result.recordId).toBe('006000000000001AAA');
    });

    test('カスタムオブジェクト(__c)のレコードページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/r/Custom_Object__c/a01000000000001/view`);
      expect(result.type).toBe('record');
      expect(result.objectName).toBe('Custom_Object__c');
    });
  });

  // ── 一覧ページ ───────────────────────────────────────────────────────────
  describe('一覧ページ (/lightning/o/.../list)', () => {
    test('Opportunity 一覧ページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/o/Opportunity/list`);
      expect(result.type).toBe('list');
      expect(result.objectName).toBe('Opportunity');
      expect(result.recordId).toBeNull();
    });

    test('Account 一覧ページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/o/Account/list`);
      expect(result.type).toBe('list');
      expect(result.objectName).toBe('Account');
    });

    test('Contact 一覧ページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/o/Contact/list`);
      expect(result.type).toBe('list');
      expect(result.objectName).toBe('Contact');
    });
  });

  // ── 新規作成ページ ──────────────────────────────────────────────────────
  describe('新規作成ページ (/lightning/o/.../new)', () => {
    test('新規作成ページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/o/Opportunity/new`);
      expect(result.type).toBe('new');
      expect(result.objectName).toBe('Opportunity');
      expect(result.recordId).toBeNull();
    });
  });

  // ── ホームページ ───────────────────────────────────────────────────────────
  describe('ホームページ (/lightning/page/home)', () => {
    test('ホームページを解析できる', () => {
      const result = parseUrl(`${INSTANCE_URL}/lightning/page/home`);
      expect(result.type).toBe('home');
      expect(result.objectName).toBeNull();
      expect(result.recordId).toBeNull();
    });
  });

  // ── 不明なURL ──────────────────────────────────────────────────────────
  describe('不明なURL・無効入力', () => {
    test('Salesforce以外のURLは unknown を返す', () => {
      const result = parseUrl('https://example.com/some/page');
      expect(result.type).toBe('unknown');
      expect(result.objectName).toBeNull();
      expect(result.recordId).toBeNull();
    });

    test('null は unknown を返す', () => {
      expect(parseUrl(null).type).toBe('unknown');
    });

    test('空文字は unknown を返す', () => {
      expect(parseUrl('').type).toBe('unknown');
    });

    test('undefined は unknown を返す', () => {
      expect(parseUrl(undefined).type).toBe('unknown');
    });

    test('数値は unknown を返す', () => {
      expect(parseUrl(42).type).toBe('unknown');
    });
  });
});
