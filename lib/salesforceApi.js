'use strict';

const API_VERSION = 'v59.0';

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
  return term.replace(/[?&|!{}[\]()^~*:\\\'"+-]/g, '\\$&');
}

async function sosl(instanceUrl, accessToken, searchTerm, objectName, fields = ['Id', 'Name']) {
  const fieldStr = fields.join(', ');
  const query = `FIND {${escapeSOSL(searchTerm)}} IN ALL FIELDS RETURNING ${objectName}(${fieldStr}) LIMIT 10`;
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
  module.exports = { sosl, soql, getRecord, createRecord, updateRecord, deleteRecord, SF_ERROR_CODES, API_VERSION };
}
