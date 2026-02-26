'use strict';

const API_VERSION = 'v59.0';

const OBJECT_DISPLAY_FIELDS = {
  'Account':     ['Id', 'Name'],
  'Contact':     ['Id', 'Name', 'Email'],
  'Lead':        ['Id', 'Name', 'Company'],
  'Opportunity': ['Id', 'Name', 'StageName'],
  'Task':        ['Id', 'Subject', 'Status'],
};

const SF_ERROR_CODES = {
  TOKEN_EXPIRED:     'TOKEN_EXPIRED',
  PERMISSION_DENIED: 'PERMISSION_DENIED',
  RATE_LIMITED:      'RATE_LIMITED',
  CONFLICT:          'CONFLICT',
  NOT_FOUND:         'NOT_FOUND',
  SERVER_ERROR:      'SERVER_ERROR',
  UNKNOWN_ERROR:     'UNKNOWN_ERROR',
};

function createHeaders(accessToken) {
  return {
    'Authorization': `Bearer ${accessToken}`,
    'Content-Type': 'application/json',
    'Accept': 'application/json',
  };
}

async function handleResponse(response) {
  if (response.ok) {
    if (response.status === 204) return null;
    return response.json();
  }

  const error = new Error();

  if (response.status === 401) {
    error.code = SF_ERROR_CODES.TOKEN_EXPIRED;
    error.message = 'アクセストークンの有効期限が切れています';
  } else if (response.status === 404) {
    error.code = SF_ERROR_CODES.NOT_FOUND;
    error.message = 'レコードが見つかりません';
  } else if (response.status === 429) {
    error.code = SF_ERROR_CODES.RATE_LIMITED;
    error.message = 'リクエスト数の上限に達しました。しばらく待ってから再試行してください';
  } else if (response.status >= 500) {
    error.code = SF_ERROR_CODES.SERVER_ERROR;
    error.message = 'Salesforceサーバーエラーが発生しました';
  } else {
    let body = [];
    try { body = await response.json(); } catch (_) { /* ignore */ }
    error.code = (response.status === 403)
      ? SF_ERROR_CODES.PERMISSION_DENIED
      : (body[0]?.errorCode || SF_ERROR_CODES.UNKNOWN_ERROR);
    error.message = body[0]?.message || '不明なエラーが発生しました';
    error.sfErrorCode = body[0]?.errorCode;
  }

  throw error;
}

function escapeSOSL(term) {
  return term.replace(/[?&|!{}[\]()^~*:\\'"+-]/g, '\\$&');
}

// ワイルドカード検索用エスケープ（* は末尾ワイルドカードとして保持するためエスケープしない）
function escapeSOSLWild(term) {
  return term.replace(/[?&|!{}[\]()^~:\\'"+-]/g, '\\$&');
}

// 音声認識で変換される法人格（漢字・ひらがな・略称）を除去する
const COMPANY_SUFFIX_RE = /\s*(株式会社|有限会社|合同会社|一般社団法人|特定非営利活動法人|かぶしきがいしゃ|ゆうげんがいしゃ|ごうどうがいしゃ|[（(]株[)）]|㈱)\s*/g;

function stripCompanySuffix(keyword) {
  const result = keyword.replace(COMPANY_SUFFIX_RE, ' ').trim();
  return result || keyword; // 全体が法人格のみの場合は元の文字列を返す
}

// ひらがな → カタカナ（U+3041-U+3096 → +0x60 → U+30A1-U+30F6）
function hiraganaToKatakana(str) {
  return str.replace(/[\u3041-\u3096]/g, (c) => String.fromCharCode(c.charCodeAt(0) + 0x60));
}

// カタカナ → ひらがな（U+30A1-U+30F6 → -0x60 → U+3041-U+3096）
function katakanaToHiragana(str) {
  return str.replace(/[\u30A1-\u30F6]/g, (c) => String.fromCharCode(c.charCodeAt(0) - 0x60));
}

// 曖昧検索: 法人格の漢字/ひらがな表記ゆれ・ひらがな↔カタカナ変換に対応するため複数のキーワードで順に検索する
async function soslFuzzy(instanceUrl, accessToken, keyword, objectName, fields = ['Id', 'Name']) {
  const stripped    = stripCompanySuffix(keyword);
  const h2kKeyword  = hiraganaToKatakana(keyword);
  const k2hKeyword  = katakanaToHiragana(keyword);
  const h2kStripped = hiraganaToKatakana(stripped);
  const k2hStripped = katakanaToHiragana(stripped);
  const firstToken  = keyword.split(/\s+/)[0];

  // 重複を排除しながら試行順を構築
  const seen = new Set();
  const terms = [];
  for (const t of [keyword, stripped, h2kKeyword, k2hKeyword, h2kStripped, k2hStripped, firstToken]) {
    if (t && !seen.has(t)) { seen.add(t); terms.push(t); }
  }

  // フェーズ1: 完全一致・表記ゆれ変換
  for (const term of terms) {
    const records = await sosl(instanceUrl, accessToken, term, objectName, fields);
    if (records.length > 0) return records;
  }

  // フェーズ2: ワイルドカード前方一致（1〜2文字の欠けや末尾表記ゆれに対応）
  // ※ 4文字未満のキーワードは過剰ヒットを避けてスキップ
  for (const term of terms) {
    if (term.length < 4) continue;
    const records = await soslWithWildcard(instanceUrl, accessToken, term, objectName, fields);
    if (records.length > 0) return records;
  }

  return [];
}

async function sosl(instanceUrl, accessToken, searchTerm, objectName, fields = ['Id', 'Name']) {
  const fieldStr = fields.join(', ');
  const query = `FIND {${escapeSOSL(searchTerm)}} IN ALL FIELDS RETURNING ${objectName}(${fieldStr}) LIMIT 10`;
  const url = `${instanceUrl}/services/data/${API_VERSION}/search/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, { method: 'GET', headers: createHeaders(accessToken) });
  const data = await handleResponse(response);
  return data?.searchRecords ?? [];
}

// ワイルドカード前方一致検索: searchTerm の末尾に * を付加して SOSL を実行する
// （例: "田中商" → FIND {田中商*} → "田中商事" にヒット）
async function soslWithWildcard(instanceUrl, accessToken, searchTerm, objectName, fields = ['Id', 'Name']) {
  const fieldStr = fields.join(', ');
  const query = `FIND {${escapeSOSLWild(searchTerm)}*} IN ALL FIELDS RETURNING ${objectName}(${fieldStr}) LIMIT 10`;
  const url = `${instanceUrl}/services/data/${API_VERSION}/search/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, { method: 'GET', headers: createHeaders(accessToken) });
  const data = await handleResponse(response);
  return data?.searchRecords ?? [];
}

async function soql(instanceUrl, accessToken, query) {
  const url = `${instanceUrl}/services/data/${API_VERSION}/query/?q=${encodeURIComponent(query)}`;

  const response = await fetch(url, { method: 'GET', headers: createHeaders(accessToken) });
  const data = await handleResponse(response);
  return data?.records ?? [];
}

async function getRecord(instanceUrl, accessToken, objectName, recordId, fields = []) {
  let url = `${instanceUrl}/services/data/${API_VERSION}/sobjects/${objectName}/${recordId}`;
  if (fields.length > 0) {
    url += `?fields=${fields.join(',')}`;
  }

  const response = await fetch(url, { method: 'GET', headers: createHeaders(accessToken) });
  return handleResponse(response);
}

async function createRecord(instanceUrl, accessToken, objectName, fields) {
  const url = `${instanceUrl}/services/data/${API_VERSION}/sobjects/${objectName}`;

  const response = await fetch(url, {
    method: 'POST',
    headers: createHeaders(accessToken),
    body: JSON.stringify(fields),
  });
  return handleResponse(response);
}

async function updateRecord(instanceUrl, accessToken, objectName, recordId, fields, expectedLastModifiedDate = null) {
  if (expectedLastModifiedDate !== null) {
    const current = await getRecord(instanceUrl, accessToken, objectName, recordId, ['LastModifiedDate']);
    if (current.LastModifiedDate !== expectedLastModifiedDate) {
      const error = new Error('レコードが別のユーザーによって更新されています');
      error.code = SF_ERROR_CODES.CONFLICT;
      error.currentLastModifiedDate = current.LastModifiedDate;
      throw error;
    }
  }

  const url = `${instanceUrl}/services/data/${API_VERSION}/sobjects/${objectName}/${recordId}`;

  const response = await fetch(url, {
    method: 'PATCH',
    headers: createHeaders(accessToken),
    body: JSON.stringify(fields),
  });

  if (response.status === 204) return { success: true };
  return handleResponse(response);
}

async function deleteRecord(instanceUrl, accessToken, objectName, recordId) {
  const url = `${instanceUrl}/services/data/${API_VERSION}/sobjects/${objectName}/${recordId}`;

  const response = await fetch(url, { method: 'DELETE', headers: createHeaders(accessToken) });

  if (response.status === 204) return { success: true };
  return handleResponse(response);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { sosl, soslWithWildcard, soslFuzzy, escapeSOSLWild, stripCompanySuffix, hiraganaToKatakana, katakanaToHiragana, soql, getRecord, createRecord, updateRecord, deleteRecord, SF_ERROR_CODES, API_VERSION, OBJECT_DISPLAY_FIELDS };
}
