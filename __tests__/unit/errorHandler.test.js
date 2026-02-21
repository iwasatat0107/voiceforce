'use strict';

const {
  classifyError,
  showError,
  ERROR_CATEGORY,
  SPEECH_ERROR_MESSAGES,
} = require('../../lib/errorHandler');

describe('classifyError', () => {
  // ── null / undefined ──────────────────────────────────────────────────────
  describe('null / undefined 入力', () => {
    test('null → UNKNOWN カテゴリ', () => {
      const result = classifyError(null);
      expect(result.category).toBe(ERROR_CATEGORY.UNKNOWN);
      expect(result.message).toBeTruthy();
    });

    test('undefined → UNKNOWN カテゴリ', () => {
      const result = classifyError(undefined);
      expect(result.category).toBe(ERROR_CATEGORY.UNKNOWN);
      expect(result.message).toBeTruthy();
    });
  });

  // ── 音声認識エラー（文字列）────────────────────────────────────────────
  describe('音声認識エラー (string)', () => {
    test.each(Object.keys(SPEECH_ERROR_MESSAGES))(
      '既知コード "%s" → SPEECH カテゴリ + 対応メッセージ',
      (code) => {
        const result = classifyError(code);
        expect(result.category).toBe(ERROR_CATEGORY.SPEECH);
        expect(result.message).toBe(SPEECH_ERROR_MESSAGES[code]);
      }
    );

    test('未知コード → SPEECH カテゴリ + フォールバックメッセージ', () => {
      const result = classifyError('some-unknown-speech-error');
      expect(result.category).toBe(ERROR_CATEGORY.SPEECH);
      expect(result.message).toBeTruthy();
    });
  });

  // ── TypeError (fetch 失敗)────────────────────────────────────────────────
  describe('TypeError (ネットワーク切断)', () => {
    test('TypeError → NETWORK カテゴリ', () => {
      const result = classifyError(new TypeError('Failed to fetch'));
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
      expect(result.message).toContain('ネットワーク');
    });

    test('TypeError のメッセージによらず NETWORK カテゴリ', () => {
      const result = classifyError(new TypeError('NetworkError when attempting to fetch resource'));
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
    });
  });

  // ── Salesforce API エラーコード ──────────────────────────────────────────
  describe('Salesforce API エラーコード', () => {
    test('TOKEN_EXPIRED → AUTH カテゴリ', () => {
      const err = new Error();
      err.code = 'TOKEN_EXPIRED';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.AUTH);
      expect(result.message).toContain('再度ログイン');
    });

    test('PERMISSION_DENIED → PERMISSION カテゴリ', () => {
      const err = new Error();
      err.code = 'PERMISSION_DENIED';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.PERMISSION);
      expect(result.message).toContain('アクセス権限');
    });

    test('RATE_LIMITED → RATE_LIMIT カテゴリ', () => {
      const err = new Error();
      err.code = 'RATE_LIMITED';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.RATE_LIMIT);
      expect(result.message).toContain('上限');
    });

    test('CONFLICT → CONFLICT カテゴリ', () => {
      const err = new Error();
      err.code = 'CONFLICT';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.CONFLICT);
      expect(result.message).toContain('別のユーザー');
    });

    test('NOT_FOUND → NOT_FOUND カテゴリ', () => {
      const err = new Error();
      err.code = 'NOT_FOUND';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.NOT_FOUND);
      expect(result.message).toContain('見つかりません');
    });

    test('SERVER_ERROR → SERVER_ERROR カテゴリ', () => {
      const err = new Error();
      err.code = 'SERVER_ERROR';
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.SERVER_ERROR);
      expect(result.message).toContain('サーバーエラー');
    });
  });

  // ── Worker HTTP ステータスエラー ─────────────────────────────────────────
  describe('Cloudflare Worker HTTP ステータスエラー', () => {
    test('status 429 → FREE_PLAN_LIMIT カテゴリ', () => {
      const err = new Error('Limit exceeded');
      err.status = 429;
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.FREE_PLAN_LIMIT);
      expect(result.message).toContain('利用制限');
    });

    test('status 401 → AUTH カテゴリ', () => {
      const err = new Error('Unauthorized');
      err.status = 401;
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.AUTH);
      expect(result.message).toContain('再度ログイン');
    });

    test('status 502 → SERVER_ERROR カテゴリ', () => {
      const err = new Error('Bad Gateway');
      err.status = 502;
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.SERVER_ERROR);
      expect(result.message).toContain('音声解析');
    });

    test('status 503 → SERVER_ERROR カテゴリ', () => {
      const err = new Error('Service Unavailable');
      err.status = 503;
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.SERVER_ERROR);
      expect(result.message).toContain('音声解析');
    });
  });

  // ── 汎用ネットワークエラー（メッセージ文字列マッチ）──────────────────
  describe('汎用ネットワークエラー（メッセージマッチ）', () => {
    test('"Failed to fetch" → NETWORK カテゴリ', () => {
      const err = new Error('Failed to fetch');
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
    });

    test('"network error" → NETWORK カテゴリ', () => {
      const err = new Error('network error occurred');
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
    });

    test('大文字小文字を区別しない', () => {
      const err = new Error('Network Error');
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
    });
  });

  // ── 未知エラー ────────────────────────────────────────────────────────
  describe('未知エラー', () => {
    test('不明メッセージ → UNKNOWN カテゴリ + error.message を返す', () => {
      const err = new Error('Something unexpected happened');
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.UNKNOWN);
      expect(result.message).toBe('Something unexpected happened');
    });

    test('メッセージなし Error → UNKNOWN カテゴリ + デフォルトメッセージ', () => {
      const err = new Error();
      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.UNKNOWN);
      expect(result.message).toBeTruthy();
    });
  });
});

// ── showError ──────────────────────────────────────────────────────────────
describe('showError', () => {
  test('AUTH エラー → widget.setState("error") + 再ログインメッセージ', () => {
    const mockWidget = { setState: jest.fn() };
    const err = new Error();
    err.code = 'TOKEN_EXPIRED';

    showError(mockWidget, err);

    expect(mockWidget.setState).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('再度ログイン') })
    );
  });

  test('音声エラー文字列 → widget.setState("error") + 該当メッセージ', () => {
    const mockWidget = { setState: jest.fn() };

    showError(mockWidget, 'no-speech');

    expect(mockWidget.setState).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: SPEECH_ERROR_MESSAGES['no-speech'] })
    );
  });

  test('TypeError → widget.setState("error") + ネットワークメッセージ', () => {
    const mockWidget = { setState: jest.fn() };

    showError(mockWidget, new TypeError('Failed to fetch'));

    expect(mockWidget.setState).toHaveBeenCalledWith(
      'error',
      expect.objectContaining({ message: expect.stringContaining('ネットワーク') })
    );
  });

  test('null → widget.setState("error") + デフォルトメッセージ', () => {
    const mockWidget = { setState: jest.fn() };

    showError(mockWidget, null);

    expect(mockWidget.setState).toHaveBeenCalledWith('error', expect.objectContaining({ message: expect.any(String) }));
  });
});
