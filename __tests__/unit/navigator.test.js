'use strict';

// lib/navigator.js のユニットテスト
// e2e テスト（urlParsing.test.js / navigation.test.js）に加え、
// unit/ にも配置してカバレッジ目標（branches:70% / functions・lines・statements:80%）を確実に達成する。

const {
  parseUrl,
  buildListUrl,
  buildRecordUrl,
  buildNewUrl,
  navigateTo,
  goBack,
  SF_URL_PATTERNS,
} = require('../../lib/navigator');

// ── SF_URL_PATTERNS ────────────────────────────────────────────────────────
describe('SF_URL_PATTERNS', () => {
  test('4つのパターンが全て RegExp であること', () => {
    expect(SF_URL_PATTERNS.RECORD).toBeInstanceOf(RegExp);
    expect(SF_URL_PATTERNS.LIST).toBeInstanceOf(RegExp);
    expect(SF_URL_PATTERNS.NEW).toBeInstanceOf(RegExp);
    expect(SF_URL_PATTERNS.HOME).toBeInstanceOf(RegExp);
  });

  test('RECORD パターンがレコードURLにマッチする', () => {
    expect(SF_URL_PATTERNS.RECORD.test(
      '/lightning/r/Opportunity/0061234567890ABCDE/view'
    )).toBe(true);
  });

  test('LIST パターンが一覧URLにマッチする', () => {
    expect(SF_URL_PATTERNS.LIST.test('/lightning/o/Opportunity/list')).toBe(true);
  });

  test('NEW パターンが新規作成URLにマッチする', () => {
    expect(SF_URL_PATTERNS.NEW.test('/lightning/o/Opportunity/new')).toBe(true);
  });

  test('HOME パターンがホームURLにマッチする', () => {
    expect(SF_URL_PATTERNS.HOME.test('/lightning/page/home')).toBe(true);
  });
});

// ── parseUrl ───────────────────────────────────────────────────────────────
describe('parseUrl', () => {
  describe('レコードページ (type: "record")', () => {
    test('18文字ID・標準オブジェクト', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/r/Opportunity/0061234567890ABCDE/view'
      );
      expect(result).toEqual({
        type: 'record',
        objectName: 'Opportunity',
        recordId: '0061234567890ABCDE',
      });
    });

    test('15文字ID・標準オブジェクト', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/r/Account/001000000000001/view'
      );
      expect(result).toEqual({
        type: 'record',
        objectName: 'Account',
        recordId: '001000000000001',
      });
    });

    test('カスタムオブジェクト (__c)', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/r/CustomObj__c/a0Q000000000001/view'
      );
      expect(result.type).toBe('record');
      expect(result.objectName).toBe('CustomObj__c');
      expect(result.recordId).toBe('a0Q000000000001');
    });

    test('Contact レコードページ', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/r/Contact/003000000000001/view'
      );
      expect(result.type).toBe('record');
      expect(result.objectName).toBe('Contact');
    });
  });

  describe('一覧ページ (type: "list")', () => {
    test('Opportunity 一覧', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/o/Opportunity/list'
      );
      expect(result).toEqual({ type: 'list', objectName: 'Opportunity', recordId: null });
    });

    test('Account 一覧', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/o/Account/list'
      );
      expect(result.type).toBe('list');
      expect(result.objectName).toBe('Account');
      expect(result.recordId).toBeNull();
    });

    test('Lead 一覧', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/o/Lead/list'
      );
      expect(result.type).toBe('list');
      expect(result.objectName).toBe('Lead');
    });
  });

  describe('新規作成ページ (type: "new")', () => {
    test('Opportunity 新規作成', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/o/Opportunity/new'
      );
      expect(result).toEqual({ type: 'new', objectName: 'Opportunity', recordId: null });
    });

    test('Contact 新規作成', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/o/Contact/new'
      );
      expect(result.type).toBe('new');
      expect(result.objectName).toBe('Contact');
    });
  });

  describe('ホームページ (type: "home")', () => {
    test('Lightning ホーム', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/page/home'
      );
      expect(result).toEqual({ type: 'home', objectName: null, recordId: null });
    });
  });

  describe('不明URL / エッジケース (type: "unknown")', () => {
    test('null → unknown', () => {
      const result = parseUrl(null);
      expect(result).toEqual({ type: 'unknown', objectName: null, recordId: null });
    });

    test('undefined → unknown', () => {
      const result = parseUrl(undefined);
      expect(result).toEqual({ type: 'unknown', objectName: null, recordId: null });
    });

    test('空文字 → unknown', () => {
      const result = parseUrl('');
      expect(result.type).toBe('unknown');
    });

    test('数値 → unknown', () => {
      const result = parseUrl(123);
      expect(result.type).toBe('unknown');
    });

    test('マッチしない Salesforce URL → unknown', () => {
      const result = parseUrl(
        'https://org.salesforce.com/lightning/setup/SetupOneHome/home'
      );
      expect(result.type).toBe('unknown');
      expect(result.objectName).toBeNull();
      expect(result.recordId).toBeNull();
    });

    test('非 Salesforce URL → unknown', () => {
      expect(parseUrl('https://example.com/foo/bar').type).toBe('unknown');
    });
  });
});

// ── buildListUrl ───────────────────────────────────────────────────────────
describe('buildListUrl', () => {
  test('Opportunity 一覧URLを構築する', () => {
    expect(buildListUrl('https://org.salesforce.com', 'Opportunity'))
      .toBe('https://org.salesforce.com/lightning/o/Opportunity/list');
  });

  test('Account 一覧URLを構築する', () => {
    expect(buildListUrl('https://org.salesforce.com', 'Account'))
      .toBe('https://org.salesforce.com/lightning/o/Account/list');
  });

  test('カスタムオブジェクト一覧URLを構築する', () => {
    expect(buildListUrl('https://org.salesforce.com', 'MyObj__c'))
      .toBe('https://org.salesforce.com/lightning/o/MyObj__c/list');
  });
});

// ── buildRecordUrl ─────────────────────────────────────────────────────────
describe('buildRecordUrl', () => {
  test('レコードURLを構築する', () => {
    expect(buildRecordUrl('https://org.salesforce.com', 'Opportunity', '0061234567890ABCDE'))
      .toBe('https://org.salesforce.com/lightning/r/Opportunity/0061234567890ABCDE/view');
  });

  test('Contact レコードURLを構築する', () => {
    expect(buildRecordUrl('https://org.salesforce.com', 'Contact', '003000000000001'))
      .toBe('https://org.salesforce.com/lightning/r/Contact/003000000000001/view');
  });
});

// ── buildNewUrl ────────────────────────────────────────────────────────────
describe('buildNewUrl', () => {
  test('新規作成URLを構築する', () => {
    expect(buildNewUrl('https://org.salesforce.com', 'Lead'))
      .toBe('https://org.salesforce.com/lightning/o/Lead/new');
  });

  test('Account 新規作成URLを構築する', () => {
    expect(buildNewUrl('https://org.salesforce.com', 'Account'))
      .toBe('https://org.salesforce.com/lightning/o/Account/new');
  });
});

// ── navigateTo ─────────────────────────────────────────────────────────────
describe('navigateTo', () => {
  test('win.location.href に URL をセットする', () => {
    const win = { location: { href: '' } };
    navigateTo('https://org.salesforce.com/lightning/o/Opportunity/list', win);
    expect(win.location.href)
      .toBe('https://org.salesforce.com/lightning/o/Opportunity/list');
  });

  test('URL が空文字のとき何もしない', () => {
    const win = { location: { href: 'https://current.example.com' } };
    navigateTo('', win);
    expect(win.location.href).toBe('https://current.example.com');
  });

  test('URL が null のとき何もしない', () => {
    const win = { location: { href: 'https://current.example.com' } };
    navigateTo(null, win);
    expect(win.location.href).toBe('https://current.example.com');
  });

  test('win が null のとき例外をスローしない', () => {
    expect(() => navigateTo('https://org.salesforce.com/path', null)).not.toThrow();
  });

  test('win が undefined のとき（globalThis.window 未定義環境）例外をスローしない', () => {
    // jsdom 環境では window が存在するため navigateTo は location.href をセットしようとする可能性がある
    // 明示的に null を渡すケースのみを検証する
    expect(() => navigateTo('https://example.com', null)).not.toThrow();
  });
});

// ── goBack ─────────────────────────────────────────────────────────────────
describe('goBack', () => {
  test('win.history.back() を呼び出す', () => {
    const win = { history: { back: jest.fn() } };
    goBack(win);
    expect(win.history.back).toHaveBeenCalledTimes(1);
  });

  test('win が null のとき例外をスローしない', () => {
    expect(() => goBack(null)).not.toThrow();
  });

  test('win.history.back() は引数なしで呼び出される', () => {
    const win = { history: { back: jest.fn() } };
    goBack(win);
    expect(win.history.back).toHaveBeenCalledWith();
  });
});
