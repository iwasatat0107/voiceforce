'use strict';

// Salesforce オブジェクト/項目定義の取得・日次キャッシュ管理

const CACHE_KEY = 'sf_metadata_cache';
const CACHE_TTL_MS = 24 * 60 * 60 * 1000; // 24時間
const SF_API_VERSION = 'v59.0';

// 常に除外するシステム項目（ユーザー編集不可）
const SYSTEM_FIELDS = new Set([
  'Id',
  'CreatedById',
  'CreatedDate',
  'LastModifiedById',
  'LastModifiedDate',
  'SystemModstamp',
  'IsDeleted',
  'LastActivityDate',
  'LastViewedDate',
  'LastReferencedDate',
]);

/**
 * キャッシュが古い（stale）かどうかを確認する
 * @param {number|null} cachedAt - タイムスタンプ（ミリ秒）
 * @returns {boolean}
 */
function isCacheStale(cachedAt) {
  if (!cachedAt) return true;
  return Date.now() - cachedAt >= CACHE_TTL_MS;
}

/**
 * Salesforce の describe レスポンスから必要な項目をフィルタする
 * createable または updateable な項目のみ、システム項目を除外
 * @param {Array} fields - describe の fields 配列
 * @returns {Array} フィルタ済み項目配列
 */
function filterFields(fields) {
  return fields.filter((field) => {
    if (SYSTEM_FIELDS.has(field.name)) return false;
    return field.createable === true || field.updateable === true;
  });
}

/**
 * GET /services/data/vXX/tabs でタブ一覧を取得する
 * @param {string} instanceUrl
 * @param {string} accessToken
 * @returns {Promise<string[]>} sobjectName の配列（重複なし）
 */
async function fetchTabsObjects(instanceUrl, accessToken) {
  const response = await fetch(
    `${instanceUrl}/services/data/${SF_API_VERSION}/tabs`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to fetch tabs: ${response.status}`);
  }

  const data = await response.json();
  const names = new Set();
  for (const tab of (data.tabs || [])) {
    if (tab.sobjectName) names.add(tab.sobjectName);
  }
  return [...names];
}

/**
 * GET /services/data/vXX/sobjects/{objectName}/describe でオブジェクト情報を取得する
 * @param {string} instanceUrl
 * @param {string} accessToken
 * @param {string} objectName
 * @returns {Promise<object>} describe レスポンス
 */
async function fetchObjectDescribe(instanceUrl, accessToken, objectName) {
  const response = await fetch(
    `${instanceUrl}/services/data/${SF_API_VERSION}/sobjects/${objectName}/describe`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
    }
  );

  if (!response.ok) {
    throw new Error(`Failed to describe ${objectName}: ${response.status}`);
  }

  return response.json();
}

/**
 * Salesforce からメタデータを取得して chrome.storage.local にキャッシュする
 * @param {string} instanceUrl
 * @param {string} accessToken
 * @returns {Promise<object>} メタデータ結果オブジェクト
 */
async function fetchAndCacheMetadata(instanceUrl, accessToken) {
  const objectNames = await fetchTabsObjects(instanceUrl, accessToken);

  const objects = [];
  for (const name of objectNames) {
    try {
      const describe = await fetchObjectDescribe(instanceUrl, accessToken, name);
      const filteredFields = filterFields(describe.fields || []);
      objects.push({
        name: describe.name,
        label: describe.label,
        fields: filteredFields,
      });
    } catch (_err) {
      // 個別オブジェクトのエラーはスキップして続行
    }
  }

  const cacheData = {
    cachedAt: Date.now(),
    data: objects,
  };

  await new Promise((resolve) => {
    chrome.storage.local.set({ [CACHE_KEY]: cacheData }, () => resolve());
  });

  return buildMetadataResult(objects);
}

/**
 * キャッシュからメタデータを取得する。なければフェッチする。
 * @param {string} instanceUrl
 * @param {string} accessToken
 * @returns {Promise<object>} メタデータ結果オブジェクト
 */
async function getMetadata(instanceUrl, accessToken) {
  const cached = await new Promise((resolve) => {
    chrome.storage.local.get([CACHE_KEY], (result) => resolve(result[CACHE_KEY]));
  });

  if (cached && !isCacheStale(cached.cachedAt)) {
    return buildMetadataResult(cached.data);
  }

  return fetchAndCacheMetadata(instanceUrl, accessToken);
}

/**
 * メタデータデータ配列から結果オブジェクトを構築する
 * @param {Array} objects - { name, label, fields }[] の配列
 * @returns {{ objects: string[], getFields: function, formatForPrompt: function }}
 */
function buildMetadataResult(objects) {
  const objectNames = objects.map((o) => o.name);
  const objectMap = Object.fromEntries(objects.map((o) => [o.name, o]));

  return {
    objects: objectNames,

    getFields(objectName) {
      const obj = objectMap[objectName];
      if (!obj) return [];
      return obj.fields.map((f) => f.name);
    },

    formatForPrompt() {
      return objects
        .map((obj, idx) => {
          const fieldLines = obj.fields.map((f) => {
            let line = `   - ${f.name}\uff08${f.label}\uff09: ${f.type}`;
            if (f.nillable === false) line += ', required';
            if (f.type === 'picklist' && f.picklistValues && f.picklistValues.length > 0) {
              const options = f.picklistValues.map((pv) => pv.label).join(', ');
              line += ` [${options}]`;
            }
            return line;
          });
          return `${idx + 1}. ${obj.name}\uff08${obj.label}\uff09\n${fieldLines.join('\n')}`;
        })
        .join('\n\n');
    },
  };
}

// Node.js (Jest) 環境向け CommonJS エクスポート
// ブラウザ環境（Service Worker / Content Script）では importScripts() で読み込む
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    isCacheStale,
    filterFields,
    fetchTabsObjects,
    fetchObjectDescribe,
    fetchAndCacheMetadata,
    getMetadata,
    buildMetadataResult,
  };
}
