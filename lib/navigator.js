'use strict';

// lib/navigator.js
// navigate / back アクション実装（URL遷移・履歴操作）

// ---------------------------------------------------------------------------
// Salesforce Lightning Experience URL パターン
// ---------------------------------------------------------------------------

const SF_URL_PATTERNS = {
  /** /lightning/r/{ObjectName}/{RecordId}/view */
  RECORD: /\/lightning\/r\/([A-Za-z_]+)\/([a-zA-Z0-9]{15,18})\/view/,
  /** /lightning/o/{ObjectName}/list */
  LIST:   /\/lightning\/o\/([A-Za-z_]+)\/list/,
  /** /lightning/o/{ObjectName}/new */
  NEW:    /\/lightning\/o\/([A-Za-z_]+)\/new/,
  /** /lightning/page/home */
  HOME:   /\/lightning\/page\/home/,
};

// ---------------------------------------------------------------------------
// URL 解析
// ---------------------------------------------------------------------------

/**
 * Salesforce URL を解析して現在ページのコンテキストを返す
 * @param {string} url
 * @returns {{ type: 'record'|'list'|'new'|'home'|'unknown', objectName: string|null, recordId: string|null }}
 */
function parseUrl(url) {
  if (!url || typeof url !== 'string') {
    return { type: 'unknown', objectName: null, recordId: null };
  }

  let m;

  m = url.match(SF_URL_PATTERNS.RECORD);
  if (m) return { type: 'record', objectName: m[1], recordId: m[2] };

  m = url.match(SF_URL_PATTERNS.LIST);
  if (m) return { type: 'list', objectName: m[1], recordId: null };

  m = url.match(SF_URL_PATTERNS.NEW);
  if (m) return { type: 'new', objectName: m[1], recordId: null };

  if (SF_URL_PATTERNS.HOME.test(url)) {
    return { type: 'home', objectName: null, recordId: null };
  }

  return { type: 'unknown', objectName: null, recordId: null };
}

// ---------------------------------------------------------------------------
// URL 生成
// ---------------------------------------------------------------------------

/**
 * オブジェクト一覧ページ URL を生成する
 * @param {string} instanceUrl
 * @param {string} objectName
 * @returns {string}
 */
function buildListUrl(instanceUrl, objectName, filterId) {
  const base = `${instanceUrl}/lightning/o/${objectName}/list`;
  return filterId ? `${base}?filterName=${filterId}` : base;
}

/**
 * レコード詳細ページ URL を生成する
 * @param {string} instanceUrl
 * @param {string} objectName
 * @param {string} recordId
 * @returns {string}
 */
function buildRecordUrl(instanceUrl, objectName, recordId) {
  return `${instanceUrl}/lightning/r/${objectName}/${recordId}/view`;
}

/**
 * 新規レコード作成ページ URL を生成する
 * @param {string} instanceUrl
 * @param {string} objectName
 * @returns {string}
 */
function buildNewUrl(instanceUrl, objectName) {
  return `${instanceUrl}/lightning/o/${objectName}/new`;
}

/**
 * グローバル検索ページ URL を生成する
 * @param {string} instanceUrl
 * @param {string} keyword
 * @returns {string}
 */
function buildSearchUrl(instanceUrl, keyword) {
  return `${instanceUrl}/lightning/search?searchInput=${encodeURIComponent(keyword)}`;
}

// ---------------------------------------------------------------------------
// ナビゲーション操作
// ---------------------------------------------------------------------------

/**
 * 指定した URL に遷移する
 * @param {string}  url
 * @param {object} [win] - window オブジェクト（テスト用 DI）
 */
function navigateTo(url, win) {
  const w = win !== undefined
    ? win
    : (typeof window !== 'undefined' ? window : null);
  if (!w || !url) return;
  w.location.href = url;
}

/**
 * 前のページに戻る
 * @param {object} [win] - window オブジェクト（テスト用 DI）
 */
function goBack(win) {
  const w = win !== undefined
    ? win
    : (typeof window !== 'undefined' ? window : null);
  if (!w) return;
  w.history.back();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { parseUrl, buildListUrl, buildRecordUrl, buildNewUrl, buildSearchUrl, navigateTo, goBack, SF_URL_PATTERNS };
}
