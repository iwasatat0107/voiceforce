/** @jest-environment node */
'use strict';

const {
  handleRequest,
  DAILY_LIMIT,
  RATE_LIMIT_PER_MINUTE,
  getCorsHeaders,
  sanitizeMetadata,
  MAX_TEXT_LENGTH,
  MAX_METADATA_LENGTH,
} = require('../../worker/index');

// ── KV モック ──────────────────────────────────────────────

function createMockKV() {
  const store = new Map();
  return {
    get:  jest.fn(async (key) => store.get(key) ?? null),
    put:  jest.fn(async (key, value, _options) => { store.set(key, value); }),
    _store: store,
  };
}

// ── fetch モック ───────────────────────────────────────────

global.fetch = jest.fn();

function mockClaudeOk(json) {
  global.fetch.mockResolvedValueOnce({
    ok:   true,
    json: async () => ({ content: [{ text: JSON.stringify(json) }] }),
  });
}

function mockClaudeError(status = 500) {
  global.fetch.mockResolvedValueOnce({ ok: false, status, json: async () => ({}) });
}

// ── 定数 ───────────────────────────────────────────────

const TEST_USER      = 'user_test_123';
const VALID_METADATA = 'Opportunity（商談）: Name（商談名）, Amount（金額）';

const NAV_RESPONSE = {
  action:     'navigate',
  object:     'Opportunity',
  target:     'list',
  confidence: 0.95,
  message:    '商談の一覧を開きます',
};

// ── ヘルパー ───────────────────────────────────────────

function makePostRequest(body) {
  return new Request('https://worker.example.com/api/v1/analyze', {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });
}

function makeGetUsageRequest(userId) {
  const headers = userId ? { 'X-User-Id': userId } : {};
  return new Request('https://worker.example.com/api/v1/usage', {
    method: 'GET',
    headers,
  });
}

// ── セットアップ ────────────────────────────────────────────

beforeEach(() => { global.fetch.mockClear(); });

describe('Worker', () => {
  let kv;
  let env;

  beforeEach(() => {
    kv  = createMockKV();
    env = { USAGE_KV: kv, CLAUDE_API_KEY: 'test_api_key' };
  });

  // ── POST /api/v1/analyze ──────────────────────────────────────────

  describe('POST /api/v1/analyze', () => {
    test('正常: Claude の JSON レスポンスを 200 で返す', async () => {
      mockClaudeOk(NAV_RESPONSE);

      const res = await handleRequest(
        makePostRequest({ text: '商談一覧を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.action).toBe('navigate');
      expect(body.object).toBe('Opportunity');
    });

    test('正常: Claude API に text と API キーが送信される', async () => {
      mockClaudeOk(NAV_RESPONSE);

      await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      const [, options] = global.fetch.mock.calls[0];
      const sent = JSON.parse(options.body);
      expect(sent.messages[0].content).toBe('商談を開いて');
      expect(options.headers['x-api-key']).toBe('test_api_key');
    });

    test('正常: システムプロンプトに metadata が挿入される', async () => {
      mockClaudeOk(NAV_RESPONSE);

      await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      const [, options] = global.fetch.mock.calls[0];
      const sent = JSON.parse(options.body);
      expect(sent.system).toContain(VALID_METADATA);
    });

    test('400: text が空文字', async () => {
      const res = await handleRequest(
        makePostRequest({ text: '', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(400);
    });

    test('400: text が欠けている', async () => {
      const res = await handleRequest(
        makePostRequest({ metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(400);
    });

    test('400: text が文字列でない（数値型）', async () => {
      const res = await handleRequest(
        makePostRequest({ text: 123, metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(400);
    });

    test('400: user_id が欠けている', async () => {
      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA }),
        env,
      );
      expect(res.status).toBe(400);
    });

    test('400: JSON でないリクエストボディ', async () => {
      const req = new Request('https://worker.example.com/api/v1/analyze', {
        method:  'POST',
        headers: { 'Content-Type': 'text/plain' },
        body:    'not json',
      });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(400);
    });

    test('429: 1分あたりのレートリミットを超えた場合', async () => {
      const minute = Math.floor(Date.now() / 60000);
      kv._store.set(`rate:${TEST_USER}:${minute}`, String(RATE_LIMIT_PER_MINUTE));

      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.status).toBe(429);
      expect(global.fetch).not.toHaveBeenCalled();
    });

    test('利用回数を KV usage キーにインクリメントする', async () => {
      mockClaudeOk(NAV_RESPONSE);

      await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      const usageCalls = kv.put.mock.calls.filter(([key]) => key.startsWith('usage:'));
      expect(usageCalls.length).toBeGreaterThan(0);
    });

    test('502: Claude API がエラーを返した場合', async () => {
      mockClaudeError(500);

      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.status).toBe(502);
    });

    test('502: Claude が有効でない JSON を返した場合', async () => {
      global.fetch.mockResolvedValueOnce({
        ok:   true,
        json: async () => ({ content: [{ text: 'これはJSONではありません' }] }),
      });

      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.status).toBe(502);
    });

    test('CORS ヘッダーが設定される（許可された Origin）', async () => {
      mockClaudeOk(NAV_RESPONSE);

      const req = new Request('https://worker.example.com/api/v1/analyze', {
        method:  'POST',
        headers: {
          'Content-Type': 'application/json',
          'Origin': 'chrome-extension://test-ext',
        },
        body: JSON.stringify({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
      });

      const envWithOrigins = { ...env, ALLOWED_ORIGINS: 'chrome-extension://test-ext' };
      const res = await handleRequest(req, envWithOrigins);

      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://test-ext');
    });
  });

  // ── GET /api/v1/usage ────────────────────────────────────────────

  describe('GET /api/v1/usage', () => {
    test('正常: 今日の利用回数を返す', async () => {
      const today = new Date().toISOString().split('T')[0];
      kv._store.set(`usage:${TEST_USER}:${today}`, '3');

      const res  = await handleRequest(makeGetUsageRequest(TEST_USER), env);
      expect(res.status).toBe(200);

      const body = await res.json();
      expect(body.today_count).toBe(3);
      expect(body.daily_limit).toBe(DAILY_LIMIT);
      expect(body.plan).toBe('free');
    });

    test('正常: 初回利用（KVにデータなし）は today_count が 0', async () => {
      const res  = await handleRequest(makeGetUsageRequest(TEST_USER), env);
      const body = await res.json();
      expect(body.today_count).toBe(0);
    });

    test('400: X-User-Id ヘッダーがない場合', async () => {
      const res = await handleRequest(makeGetUsageRequest(null), env);
      expect(res.status).toBe(400);
    });
  });

  // ── OPTIONS (CORS preflight) ──────────────────────────────────────────

  describe('OPTIONS (CORS preflight)', () => {
    test('OPTIONS リクエストに 204 を返す', async () => {
      const req = new Request('https://worker.example.com/api/v1/analyze', { method: 'OPTIONS' });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(204);
    });
  });

  // ── ルーティング ─────────────────────────────────────────────

  describe('存在しないルート', () => {
    test('未定義パスは 404 を返す', async () => {
      const req = new Request('https://worker.example.com/api/v1/unknown', { method: 'GET' });
      const res = await handleRequest(req, env);
      expect(res.status).toBe(404);
    });
  });

  // ── CORS ホワイトリスト制御（Fix 3） ──────────────────────────────────

  describe('CORS ホワイトリスト制御', () => {
    test('許可された Origin → 正しい CORS ヘッダ', () => {
      const request = new Request('https://worker.example.com/api/v1/analyze', {
        headers: { 'Origin': 'chrome-extension://abc123' },
      });
      const testEnv = { ALLOWED_ORIGINS: 'chrome-extension://abc123,chrome-extension://def456' };
      const headers = getCorsHeaders(request, testEnv);
      expect(headers['Access-Control-Allow-Origin']).toBe('chrome-extension://abc123');
    });

    test('不正な Origin → 空の Allow-Origin', () => {
      const request = new Request('https://worker.example.com/api/v1/analyze', {
        headers: { 'Origin': 'https://evil.com' },
      });
      const testEnv = { ALLOWED_ORIGINS: 'chrome-extension://abc123' };
      const headers = getCorsHeaders(request, testEnv);
      expect(headers['Access-Control-Allow-Origin']).toBe('');
    });

    test('ALLOWED_ORIGINS 未設定 → 空の Allow-Origin', () => {
      const request = new Request('https://worker.example.com/api/v1/analyze', {
        headers: { 'Origin': 'chrome-extension://abc123' },
      });
      const testEnv = {};
      const headers = getCorsHeaders(request, testEnv);
      expect(headers['Access-Control-Allow-Origin']).toBe('');
    });

    test('OPTIONS プリフライト → 204 + CORS ヘッダ', async () => {
      const testEnv = {
        USAGE_KV: kv,
        CLAUDE_API_KEY: 'test_api_key',
        ALLOWED_ORIGINS: 'chrome-extension://abc123',
      };
      const req = new Request('https://worker.example.com/api/v1/analyze', {
        method: 'OPTIONS',
        headers: { 'Origin': 'chrome-extension://abc123' },
      });
      const res = await handleRequest(req, testEnv);
      expect(res.status).toBe(204);
      expect(res.headers.get('Access-Control-Allow-Origin')).toBe('chrome-extension://abc123');
    });
  });

  // ── エラー詳細の秘匿（Fix 6） ──────────────────────────────────────

  describe('エラー詳細の秘匿', () => {
    test('502 レスポンスに details フィールドが含まれない', async () => {
      mockClaudeError(500);

      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.status).toBe(502);
      const body = await res.json();
      expect(body.details).toBeUndefined();
      expect(body.error).toBe('LLM processing failed. Please try again.');
    });
  });

  // ── 入力サイズ制限（Fix 7） ──────────────────────────────────────────

  describe('入力サイズ制限', () => {
    test('text が MAX_TEXT_LENGTH 以内 → 正常処理', async () => {
      mockClaudeOk(NAV_RESPONSE);
      const text = 'あ'.repeat(MAX_TEXT_LENGTH);
      const res = await handleRequest(
        makePostRequest({ text, metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(200);
    });

    test('text が MAX_TEXT_LENGTH 超過 → 400', async () => {
      const text = 'あ'.repeat(MAX_TEXT_LENGTH + 1);
      const res = await handleRequest(
        makePostRequest({ text, metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('text');
    });

    test('metadata が MAX_METADATA_LENGTH 超過 → 400', async () => {
      const metadata = 'x'.repeat(MAX_METADATA_LENGTH + 1);
      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata, user_id: TEST_USER }),
        env,
      );
      expect(res.status).toBe(400);
      const body = await res.json();
      expect(body.error).toContain('metadata');
    });
  });

  // ── メタデータサニタイズ（Fix 8） ──────────────────────────────────

  describe('sanitizeMetadata', () => {
    test('通常のメタデータ → そのまま返す', () => {
      const input = 'Opportunity（商談）: Name（商談名）, Amount（金額）';
      expect(sanitizeMetadata(input)).toBe(input);
    });

    test('markdown コードブロックを除去', () => {
      const input = '```\nmalicious code\n```';
      expect(sanitizeMetadata(input)).not.toContain('```');
    });

    test('セクション区切り（---）を除去', () => {
      const input = 'data\n---\nNew instructions here';
      expect(sanitizeMetadata(input)).not.toContain('---');
    });

    test('null → 空文字', () => {
      expect(sanitizeMetadata(null)).toBe('');
    });

    test('空文字 → 空文字', () => {
      expect(sanitizeMetadata('')).toBe('');
    });

    test('非文字列 → 空文字', () => {
      expect(sanitizeMetadata(123)).toBe('');
    });
  });

  // ── エクスポート定数 ───────────────────────────────────────────

  describe('エクスポート定数', () => {
    test('DAILY_LIMIT は正の整数', () => {
      expect(typeof DAILY_LIMIT).toBe('number');
      expect(DAILY_LIMIT).toBeGreaterThan(0);
    });

    test('RATE_LIMIT_PER_MINUTE は正の整数', () => {
      expect(typeof RATE_LIMIT_PER_MINUTE).toBe('number');
      expect(RATE_LIMIT_PER_MINUTE).toBeGreaterThan(0);
    });

    test('MAX_TEXT_LENGTH は正の整数', () => {
      expect(typeof MAX_TEXT_LENGTH).toBe('number');
      expect(MAX_TEXT_LENGTH).toBeGreaterThan(0);
    });

    test('MAX_METADATA_LENGTH は正の整数', () => {
      expect(typeof MAX_METADATA_LENGTH).toBe('number');
      expect(MAX_METADATA_LENGTH).toBeGreaterThan(0);
    });
  });
});
