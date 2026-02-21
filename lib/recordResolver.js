'use strict';

// lib/recordResolver.js
// 検索結果件数（0 / 1 / 2-5 / 6+件）による分岐ロジック

const RESULT_CATEGORY = {
  NOT_FOUND: 'not_found', // 0件
  SINGLE:    'single',    // 1件
  MULTIPLE:  'multiple',  // 2〜5件
  TOO_MANY:  'too_many',  // 6件以上
};

/**
 * 検索結果配列を件数カテゴリに分類する
 * @param {Array} records - Salesforce API が返したレコード配列
 * @returns {string} RESULT_CATEGORY のいずれか
 */
function categorize(records) {
  if (!Array.isArray(records)) return RESULT_CATEGORY.NOT_FOUND;
  const count = records.length;
  if (count === 0)  return RESULT_CATEGORY.NOT_FOUND;
  if (count === 1)  return RESULT_CATEGORY.SINGLE;
  if (count <= 5)   return RESULT_CATEGORY.MULTIPLE;
  return RESULT_CATEGORY.TOO_MANY;
}

/**
 * 検索結果を解決し、次に取るべきアクションを返す
 * @param {Array} records - Salesforce API が返したレコード配列
 * @returns {{ category: string, record: object|null, candidates: Array, message: string|null }}
 */
function resolve(records) {
  const category = categorize(records);

  switch (category) {
    case RESULT_CATEGORY.NOT_FOUND:
      return {
        category,
        record:     null,
        candidates: [],
        message:    '該当するレコードが見つかりませんでした。条件を変えて再度お試しください。',
      };

    case RESULT_CATEGORY.SINGLE:
      return {
        category,
        record:     records[0],
        candidates: [],
        message:    null,
      };

    case RESULT_CATEGORY.MULTIPLE:
      return {
        category,
        record:     null,
        candidates: records,
        message:    `${records.length}件見つかりました。番号で選択してください。`,
      };

    case RESULT_CATEGORY.TOO_MANY:
      return {
        category,
        record:     null,
        candidates: [],
        message:    `${records.length}件以上見つかりました。条件を絞り込んでください。`,
      };
  }
}

/**
 * 候補リストから 1-based インデックスでレコードを選択する
 * @param {Array}  candidates - resolve() で得た candidates 配列
 * @param {number} index      - 1-based の選択番号
 * @returns {object|null} 選択されたレコード、または範囲外なら null
 */
function selectByIndex(candidates, index) {
  if (!Array.isArray(candidates)) return null;
  if (typeof index !== 'number' || index < 1 || index > candidates.length) return null;
  return candidates[index - 1];
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { categorize, resolve, selectByIndex, RESULT_CATEGORY };
}
