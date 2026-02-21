'use strict';

/* global USAGE_KV, CLAUDE_API_KEY, addEventListener */

// ── 定数 ────────────────────────────────────────────────────────

const DAILY_LIMIT          = 10;
const RATE_LIMIT_PER_MINUTE = 10;
const CLAUDE_API_URL        = 'https://api.anthropic.com/v1/messages';
const CLAUDE_MODEL          = 'claude-haiku-4-5-20251001';

// ── システムプロンプト（固定部分） ──────────────────────────────────────────

const SYSTEM_PROMPT = `あなたはSalesforceの音声操作アシスタントです。
ユーザーの音声入力（テキストに変換済み）を受け取り、
Salesforceに対する操作指示をJSON形式で出力してください。

必ず以下のルールに従ってください：
- 出力はJSON形式のみ。説明文やMarkdownは一切含めない
- 日本語の発話を正確に解釈する
- 曖昧な場合は推測せず、confidenceを下げて確認を促すmessageを返す
- 1回の発話に対して 1 つのアクションのみ返す

## 対応するアクション

1. navigate - レコードまたはオブジェクトの一覧画面に遷移する
2. search   - 条件に合うレコードを検索する
3. create   - 新規レコードを作成する
4. update   - 既存レコードの項目を更新する
5. summary  - 情報を要約・集計して回答する
6. unknown  - Salesforce操作と判断できない場合

## 出力JSONスキーマ

■ navigate
{"action":"navigate","object":"APIオブジェクト名","search_term":"レコード特定キーワードまたはnull","target":"record|list","confidence":0.0-1.0,"message":"日本語フィードバック"}

■ search
{"action":"search","object":"APIオブジェクト名","conditions":{},"keyword":"キーワードまたはnull","confidence":0.0-1.0,"message":"日本語フィードバック"}

■ create
{"action":"create","object":"APIオブジェクト名","fields":{},"missing_fields":[],"confidence":0.0-1.0,"message":"日本語フィードバック"}

■ update
{"action":"update","object":"APIオブジェクト名","search_term":"対象レコード特定キーワード","fields":{},"confidence":0.0-1.0,"message":"日本語フィードバック"}

■ summary
{"action":"summary","summary_type":"today_schedule|pipeline|recent_activities|count|custom","object":"APIオブジェクト名またはnull","conditions":{},"confidence":0.0-1.0,"message":"日本語フィードバック"}

■ unknown
{"action":"unknown","confidence":0.0,"message":"日本語フィードバック"}

## 判定ルール

【オブジェクト解決】
- ユーザーは日本語ラベル（「商談」「取引先」等）で話す
- 後述の「利用可能なオブジェクト一覧」を参照し、ラベルからAPI名に変換する

【数値の正規化】
- 「500万」→ 5000000 / 「1千万」→ 10000000

【安全性ルール】
- updateのmessageには必ず変更内容の確認を含める

=== 利用可能なオブジェクト一覧 ===
{{DYNAMIC_METADATA}}`;

// ── CORS ──────────────────────────────────────────────────────────────

const CORS_HEADERS = {
  'Access-Control-Allow-Origin':  '*',
  'Access-Control-Allow-Methods': 'POST, GET, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-User-Id',
  'Access-Control-Max-Age':       '86400',
};

// ── ユーティリティ ─────────────────────────────────────────────────────

function jsonResponse(body, status) {
  const code = (status !== undefined) ? status : 200;
  return new Response(JSON.stringify(body), {
    status:  code,
    headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS),
  });
}

function getRateKey(userId) {
  const minute = Math.floor(Date.now() / 60000);
  return `rate:${userId}:${minute}`;
}

function getUsageKey(userId) {
  const today = new Date().toISOString().split('T')[0];
  return `usage:${userId}:${today}`;
}

// ── KV 操作 ───────────────────────────────────────────────────────

async function checkAndIncrementRate(userId, kv) {
  const key     = getRateKey(userId);
  const current = parseInt((await kv.get(key)) || '0', 10);
  if (current >= RATE_LIMIT_PER_MINUTE) return false;
  await kv.put(key, String(current + 1), { expirationTtl: 120 });
  return true;
}

async function incrementUsage(userId, kv) {
  const key     = getUsageKey(userId);
  const current = parseInt((await kv.get(key)) || '0', 10);
  await kv.put(key, String(current + 1), { expirationTtl: 172800 }); // 48h TTL
}

// ── Claude API 呼び出し ────────────────────────────────────────────

async function callClaude(text, metadata, apiKey) {
  const systemPrompt = SYSTEM_PROMPT.replace('{{DYNAMIC_METADATA}}', metadata || '');

  const response = await fetch(CLAUDE_API_URL, {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      CLAUDE_MODEL,
      max_tokens: 500,
      system:     systemPrompt,
      messages:   [{ role: 'user', content: text }],
    }),
  });

  if (!response.ok) {
    throw new Error(`Claude API error: ${response.status}`);
  }

  const data        = await response.json();
  const textContent = data.content && data.content[0] && data.content[0].text;
  if (!textContent) throw new Error('Empty response from Claude');

  return JSON.parse(textContent);
}

// ── エンドポイントハンドラ ───────────────────────────────────────────────

async function handleAnalyze(request, env) {
  let body;
  try {
    body = await request.json();
  } catch (_) {
    return jsonResponse({ error: 'Invalid JSON body' }, 400);
  }

  const { text, metadata, user_id } = body;

  if (!text || typeof text !== 'string' || !text.trim()) {
    return jsonResponse({ error: 'text is required and must be a non-empty string' }, 400);
  }
  if (!user_id || typeof user_id !== 'string') {
    return jsonResponse({ error: 'user_id is required' }, 400);
  }

  const allowed = await checkAndIncrementRate(user_id, env.USAGE_KV);
  if (!allowed) {
    return jsonResponse({ error: 'Rate limit exceeded. Please try again later.' }, 429);
  }

  let result;
  try {
    result = await callClaude(text, metadata, env.CLAUDE_API_KEY);
  } catch (e) {
    return jsonResponse({ error: 'LLM API error', details: e.message }, 502);
  }

  await incrementUsage(user_id, env.USAGE_KV);

  return jsonResponse(result);
}

async function handleUsage(request, env) {
  const userId = request.headers.get('X-User-Id');
  if (!userId) {
    return jsonResponse({ error: 'X-User-Id header is required' }, 400);
  }

  const countStr   = await env.USAGE_KV.get(getUsageKey(userId));
  const todayCount = countStr ? parseInt(countStr, 10) : 0;

  return jsonResponse({ today_count: todayCount, daily_limit: DAILY_LIMIT, plan: 'free' });
}

// ── メインルーター ──────────────────────────────────────────────────

async function handleRequest(request, env) {
  const url    = new URL(request.url);
  const { method } = request;

  if (method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }

  if (method === 'POST' && url.pathname === '/api/v1/analyze') {
    return handleAnalyze(request, env);
  }

  if (method === 'GET' && url.pathname === '/api/v1/usage') {
    return handleUsage(request, env);
  }

  return new Response('Not Found', { status: 404 });
}

// ── モジュールエクスポート（Jest / Node.js） ────────────────────────────────

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { handleRequest, DAILY_LIMIT, RATE_LIMIT_PER_MINUTE };
} else if (typeof addEventListener !== 'undefined') {
  // Cloudflare Workers Service Worker format
  addEventListener('fetch', (event) => {
    const workerEnv = {
      USAGE_KV:       typeof USAGE_KV !== 'undefined'       ? USAGE_KV       : null,
      CLAUDE_API_KEY: typeof CLAUDE_API_KEY !== 'undefined' ? CLAUDE_API_KEY : null,
    };
    event.respondWith(handleRequest(event.request, workerEnv));
  });
}
