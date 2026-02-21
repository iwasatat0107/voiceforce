'use strict';

const { classifyError, showError, ERROR_CATEGORY } = require('../../lib/errorHandler');
const { resolveIntent } = require('../../lib/intentResolver');

describe('エラーハンドリング統合テスト', () => {
  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  // ── Worker 429: 利用制限超過 ─────────────────────────────────────────────
  describe('Worker 429 (利用制限超過)', () => {
    test('classifyError: status 429 → FREE_PLAN_LIMIT カテゴリ', () => {
      const err = new Error('Daily limit exceeded');
      err.status = 429;

      const result = classifyError(err);
      expect(result.category).toBe(ERROR_CATEGORY.FREE_PLAN_LIMIT);
      expect(result.message).toContain('利用制限');
    });

    test('resolveIntent が 429 を受け取ると error.status = 429 でスローする', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Daily limit exceeded' }),
      });

      await expect(
        resolveIntent('商談一覧', '', 'https://worker.example.com', 'user1')
      ).rejects.toMatchObject({ status: 429 });
    });

    test('resolveIntent 429 → classifyError → FREE_PLAN_LIMIT', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Daily limit exceeded' }),
      });

      let caught;
      try {
        await resolveIntent('商談一覧', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      const result = classifyError(caught);
      expect(result.category).toBe(ERROR_CATEGORY.FREE_PLAN_LIMIT);
    });

    test('resolveIntent 429 → showError → widget に利用制限メッセージが表示される', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 429,
        json: async () => ({ error: 'Daily limit exceeded' }),
      });

      const mockWidget = { setState: jest.fn() };
      let caught;
      try {
        await resolveIntent('商談一覧', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      showError(mockWidget, caught);
      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('利用制限') })
      );
    });
  });

  // ── Worker 502: LLM サービス一時停止 ────────────────────────────────────
  describe('Worker 502 (音声解析サービス一時停止)', () => {
    test('resolveIntent 502 → classifyError → SERVER_ERROR + 音声解析メッセージ', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 502,
        json: async () => ({ error: 'Bad Gateway' }),
      });

      let caught;
      try {
        await resolveIntent('商談を作成', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      const result = classifyError(caught);
      expect(result.category).toBe(ERROR_CATEGORY.SERVER_ERROR);
      expect(result.message).toContain('音声解析');
    });

    test('resolveIntent 503 → classifyError → SERVER_ERROR', async () => {
      global.fetch.mockResolvedValue({
        ok: false,
        status: 503,
        json: async () => ({ error: 'Service Unavailable' }),
      });

      let caught;
      try {
        await resolveIntent('商談を作成', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      const result = classifyError(caught);
      expect(result.category).toBe(ERROR_CATEGORY.SERVER_ERROR);
    });
  });

  // ── ネットワーク切断 ─────────────────────────────────────────────────────
  describe('ネットワーク切断 (TypeError)', () => {
    test('fetch TypeError → classifyError → NETWORK カテゴリ', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      let caught;
      try {
        await resolveIntent('商談一覧', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      const result = classifyError(caught);
      expect(result.category).toBe(ERROR_CATEGORY.NETWORK);
      expect(result.message).toContain('ネットワーク');
    });

    test('fetch TypeError → showError → widget にネットワークエラーメッセージが表示される', async () => {
      global.fetch.mockRejectedValue(new TypeError('Failed to fetch'));

      const mockWidget = { setState: jest.fn() };
      let caught;
      try {
        await resolveIntent('商談一覧', '', 'https://worker.example.com', 'user1');
      } catch (e) {
        caught = e;
      }

      showError(mockWidget, caught);
      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('ネットワーク') })
      );
    });
  });

  // ── Salesforce API エラー統合 ────────────────────────────────────────────
  describe('Salesforce API エラー統合', () => {
    test('TOKEN_EXPIRED → showError → 再ログインメッセージ', () => {
      const sfError = new Error('Session expired');
      sfError.code = 'TOKEN_EXPIRED';
      const mockWidget = { setState: jest.fn() };

      showError(mockWidget, sfError);

      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('再度ログイン') })
      );
    });

    test('CONFLICT → classifyError → CONFLICT カテゴリ + 競合メッセージ', () => {
      const sfError = new Error('Conflict');
      sfError.code = 'CONFLICT';

      const result = classifyError(sfError);
      expect(result.category).toBe(ERROR_CATEGORY.CONFLICT);
      expect(result.message).toContain('別のユーザー');
    });

    test('PERMISSION_DENIED → showError → アクセス権限メッセージ', () => {
      const sfError = new Error('Forbidden');
      sfError.code = 'PERMISSION_DENIED';
      const mockWidget = { setState: jest.fn() };

      showError(mockWidget, sfError);

      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('アクセス権限') })
      );
    });
  });

  // ── 音声認識エラー統合 ───────────────────────────────────────────────────
  describe('音声認識エラー統合', () => {
    test('"no-speech" → showError → 音声未検出メッセージ', () => {
      const mockWidget = { setState: jest.fn() };
      showError(mockWidget, 'no-speech');

      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('音声が検出されませんでした') })
      );
    });

    test('"not-allowed" → showError → マイク許可メッセージ', () => {
      const mockWidget = { setState: jest.fn() };
      showError(mockWidget, 'not-allowed');

      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('マイク') })
      );
    });

    test('"audio-capture" → showError → マイク未接続メッセージ', () => {
      const mockWidget = { setState: jest.fn() };
      showError(mockWidget, 'audio-capture');

      expect(mockWidget.setState).toHaveBeenCalledWith(
        'error',
        expect.objectContaining({ message: expect.stringContaining('マイクが見つかりません') })
      );
    });
  });
});
