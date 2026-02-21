/** @jest-environment node */
'use strict';

const { handleRequest, DAILY_LIMIT, RATE_LIMIT_PER_MINUTE } = require('../../worker/index');

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

    test('CORS ヘッダーが設定される', async () => {
      mockClaudeOk(NAV_RESPONSE);

      const res = await handleRequest(
        makePostRequest({ text: '商談を開いて', metadata: VALID_METADATA, user_id: TEST_USER }),
        env,
      );

      expect(res.headers.get('Access-Control-Allow-Origin')).toBeTruthy();
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
  });
});
