'use strict';

const { validateLLMOutput, resolveIntent, VALID_ACTIONS } = require('../../lib/intentResolver');
const llmResponses = require('../mocks/llmResponses');

// ---------------------------------------------------------------------------
// テスト用メタデータモック
// ---------------------------------------------------------------------------
const metadata = {
  objects: ['Opportunity', 'Account', 'Contact', 'Lead', 'Task', 'Event'],
  getFields(obj) {
    const fields = {
      Opportunity: ['Name', 'Amount', 'CloseDate', 'StageName', 'AccountId', 'OwnerId'],
      Account:     ['Name', 'BillingCity', 'Phone', 'Industry', 'Type'],
      Contact:     ['FirstName', 'LastName', 'Email', 'Phone', 'AccountId'],
      Lead:        ['FirstName', 'LastName', 'Company', 'Email', 'Phone', 'Status'],
      Task:        ['Subject', 'ActivityDate', 'Status', 'OwnerId'],
      Event:       ['Subject', 'ActivityDateTime', 'EndDateTime', 'OwnerId'],
    };
    return fields[obj] || [];
  },
};

// ===========================================================================
// VALID_ACTIONS
// ===========================================================================
describe('VALID_ACTIONS', () => {
  test('定義済みアクション6種が含まれている', () => {
    expect(VALID_ACTIONS).toEqual(['navigate', 'search', 'create', 'update', 'summary', 'unknown']);
  });
});

// ===========================================================================
// validateLLMOutput
// ===========================================================================
describe('validateLLMOutput', () => {

  // ── actionホワイトリスト ────────────────────────────────────────────────
  describe('actionホワイトリスト', () => {
    test.each(VALID_ACTIONS)('有効なaction "%s" は通過する', (action) => {
      expect(validateLLMOutput({ action, confidence: 0.9 }, metadata)).toBe(true);
    });

    test('無効なaction "delete" は弾かれる', () => {
      expect(validateLLMOutput({ action: 'delete', confidence: 0.9 }, metadata)).toBe(false);
    });

    test('actionが未定義のオブジェクトは弾かれる', () => {
      expect(validateLLMOutput({ confidence: 0.9 }, metadata)).toBe(false);
    });

    test('プロンプトインジェクション試行（action: "delete"）は弾かれる', () => {
      expect(validateLLMOutput(llmResponses.injectionAttempt, metadata)).toBe(false);
    });
  });

  // ── confidenceの範囲確認 ─────────────────────────────────────────────
  describe('confidence範囲確認', () => {
    test('confidence=0 は通過する', () => {
      expect(validateLLMOutput({ action: 'unknown', confidence: 0 }, metadata)).toBe(true);
    });

    test('confidence=1 は通過する', () => {
      expect(validateLLMOutput({ action: 'navigate', confidence: 1 }, metadata)).toBe(true);
    });

    test('confidence=0.5 は通過する', () => {
      expect(validateLLMOutput({ action: 'search', confidence: 0.5 }, metadata)).toBe(true);
    });

    test('confidence < 0 は弾かれる', () => {
      expect(validateLLMOutput({ action: 'navigate', confidence: -0.1 }, metadata)).toBe(false);
    });

    test('confidence > 1 は弾かれる', () => {
      expect(validateLLMOutput({ action: 'navigate', confidence: 1.1 }, metadata)).toBe(false);
    });

    test('confidenceが未定義は弾かれる', () => {
      expect(validateLLMOutput({ action: 'navigate' }, metadata)).toBe(false);
    });

    test('confidenceが文字列は弾かれる', () => {
      expect(validateLLMOutput({ action: 'navigate', confidence: 'high' }, metadata)).toBe(false);
    });
  });

  // ── objectホワイトリスト ────────────────────────────────────────────────
  describe('objectホワイトリスト', () => {
    test('有効なobject "Opportunity" は通過する', () => {
      const json = { action: 'navigate', object: 'Opportunity', confidence: 0.9 };
      expect(validateLLMOutput(json, metadata)).toBe(true);
    });

    test('無効なobjectは弾かれる', () => {
      const json = { action: 'navigate', object: 'NonExistentObject', confidence: 0.9 };
      expect(validateLLMOutput(json, metadata)).toBe(false);
    });

    test('objectなし（unknownアクション）は通過する', () => {
      expect(validateLLMOutput({ action: 'unknown', confidence: 0.0 }, metadata)).toBe(true);
    });

    test('metadataがnullのときobjectチェックをスキップして通過する', () => {
      const json = { action: 'navigate', object: 'Opportunity', confidence: 0.9 };
      expect(validateLLMOutput(json, null)).toBe(true);
    });
  });

  // ── fieldsホワイトリスト ─────────────────────────────────────────────
  describe('fieldsホワイトリスト', () => {
    test('有効なfieldsは通過する', () => {
      const json = {
        action:     'update',
        object:     'Opportunity',
        fields:     { Amount: 5000000, StageName: '成約' },
        confidence: 0.9,
      };
      expect(validateLLMOutput(json, metadata)).toBe(true);
    });

    test('無効なfield名は弾かれる', () => {
      const json = {
        action:     'update',
        object:     'Opportunity',
        fields:     { EvilField: 'hack' },
        confidence: 0.9,
      };
      expect(validateLLMOutput(json, metadata)).toBe(false);
    });

    test('objectなしでfieldsがある場合は弾かれる', () => {
      const json = { action: 'update', fields: { Name: 'test' }, confidence: 0.9 };
      expect(validateLLMOutput(json, metadata)).toBe(false);
    });

    test('metadataがnullのときfieldsチェックをスキップして通過する', () => {
      const json = {
        action:     'update',
        object:     'Opportunity',
        fields:     { Amount: 5000000 },
        confidence: 0.9,
      };
      expect(validateLLMOutput(json, null)).toBe(true);
    });
  });

  // ── 入力値のエッジケース ─────────────────────────────────────────────
  describe('入力値のエッジケース', () => {
    test('nullは弾かれる', () => {
      expect(validateLLMOutput(null, metadata)).toBe(false);
    });

    test('undefinedは弾かれる', () => {
      expect(validateLLMOutput(undefined, metadata)).toBe(false);
    });

    test('文字列は弾かれる', () => {
      expect(validateLLMOutput('navigate', metadata)).toBe(false);
    });

    test('配列は弾かれる', () => {
      expect(validateLLMOutput([], metadata)).toBe(false);
    });
  });

  // ── モックレスポンス全種の検証 ──────────────────────────────────────
  describe('モックレスポンス検証', () => {
    test('navigate レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.navigate, metadata)).toBe(true);
    });

    test('navigateList レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.navigateList, metadata)).toBe(true);
    });

    test('search レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.search, metadata)).toBe(true);
    });

    test('create レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.create, metadata)).toBe(true);
    });

    test('update レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.update, metadata)).toBe(true);
    });

    test('summary レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.summary, metadata)).toBe(true);
    });

    test('unknown レスポンスは通過する', () => {
      expect(validateLLMOutput(llmResponses.unknown, metadata)).toBe(true);
    });

    test('injectionAttempt は弾かれる', () => {
      expect(validateLLMOutput(llmResponses.injectionAttempt, metadata)).toBe(false);
    });
  });
});

// ===========================================================================
// resolveIntent
// ===========================================================================
describe('resolveIntent', () => {
  const workerUrl = 'https://worker.example.com';
  const userId    = 'user-001';
  const metaStr   = 'Opportunity, Account, Contact';

  beforeEach(() => {
    global.fetch = jest.fn();
  });

  afterEach(() => {
    jest.resetAllMocks();
  });

  test('正常系：Workerにリクエストを送り結果を返す', async () => {
    const mockResult = llmResponses.navigate;
    global.fetch.mockResolvedValueOnce({
      ok:   true,
      json: async () => mockResult,
    });

    const result = await resolveIntent('田中商事の商談開いて', metaStr, workerUrl, userId);

    expect(global.fetch).toHaveBeenCalledWith(
      `${workerUrl}/api/v1/analyze`,
      expect.objectContaining({
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ text: '田中商事の商談開いて', metadata: metaStr, user_id: userId }),
      })
    );
    expect(result).toEqual(mockResult);
  });

  test('Worker が 400 を返した場合エラーをスロー', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 400,
      json:   async () => ({ error: 'text is required and must be a non-empty string' }),
    });

    await expect(resolveIntent('', metaStr, workerUrl, userId))
      .rejects.toThrow('text is required');
  });

  test('レートリミット（429）でエラーをスロー', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 429,
      json:   async () => ({ error: 'Rate limit exceeded. Please try again later.' }),
    });

    await expect(resolveIntent('商談一覧', metaStr, workerUrl, userId))
      .rejects.toThrow('Rate limit exceeded');
  });

  test('Worker障害（502）でエラーをスロー', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 502,
      json:   async () => ({ error: 'LLM API error', details: 'Claude API error: 502' }),
    });

    await expect(resolveIntent('商談一覧', metaStr, workerUrl, userId))
      .rejects.toThrow('LLM API error');
  });

  test('エラーボディが不正JSONの場合 "Worker error: <status>" をスロー', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 502,
      json:   async () => { throw new SyntaxError('invalid json'); },
    });

    await expect(resolveIntent('商談一覧', metaStr, workerUrl, userId))
      .rejects.toThrow('Worker error: 502');
  });

  test('ネットワークエラーはそのままスロー', async () => {
    global.fetch.mockRejectedValueOnce(new Error('Network error'));

    await expect(resolveIntent('商談一覧', metaStr, workerUrl, userId))
      .rejects.toThrow('Network error');
  });

  test('スローされたエラーに .status プロパティが付与される', async () => {
    global.fetch.mockResolvedValueOnce({
      ok:     false,
      status: 429,
      json:   async () => ({ error: 'Rate limit exceeded. Please try again later.' }),
    });

    let thrownError;
    try {
      await resolveIntent('商談一覧', metaStr, workerUrl, userId);
    } catch (e) {
      thrownError = e;
    }
    expect(thrownError.status).toBe(429);
  });
});
