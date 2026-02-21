'use strict';

// lib/ruleEngine.js
// QUICK_PATTERNS による正規表現マッチング（LLMバイパス 30〜40% 目標）

// 日本語ラベル → Salesforce API 名
const LABEL_TO_API = {
  '商談':         'Opportunity',
  '取引先':       'Account',
  '取引先責任者': 'Contact',
  'リード':       'Lead',
  'タスク':       'Task',
  '行動':         'Event',
  'ToDo':         'Task',
};

// 漢数字 → 整数変換
function toNumber(str) {
  const kanjiMap = { '一': 1, '二': 2, '三': 3, '四': 4, '五': 5 };
  if (kanjiMap[str] !== undefined) return kanjiMap[str];
  return parseInt(str, 10);
}

const OBJECT_NAMES = '商談|取引先責任者|取引先|リード|タスク|行動|ToDo';

const QUICK_PATTERNS = [
  // ── オブジェクト一覧への遷移 ────────────────────────────────────────
  {
    patterns: [
      // 例: 「商談」「商談の一覧」「商談リスト」
      new RegExp(`^(${OBJECT_NAMES})(の)?(一覧|リスト)?$`),
      // 例: 「商談を開いて」「商談出して」「商談を表示」
      new RegExp(`^(${OBJECT_NAMES})(を)?(開いて|出して|見せて|表示)$`),
      // 例: 「商談一覧出して」「商談の一覧を開いて」
      new RegExp(`^(${OBJECT_NAMES})(の)?(一覧|リスト)(を)?(出して|開いて|見せて|表示)?$`),
    ],
    resolve: (m) => ({
      action: 'navigate',
      object: LABEL_TO_API[m[1]],
      target: 'list',
      confidence: 1.0,
      message: `${m[1]}の一覧を開きます`,
    }),
  },

  // ── 確認応答（はい） ─────────────────────────────────────────────────
  {
    patterns: [/^(はい|うん|OK|オッケー|いいよ|お願い|実行して|そう|ええ)$/i],
    resolve: () => ({ action: 'confirm', value: true }),
  },

  // ── 確認応答（いいえ） ───────────────────────────────────────────────
  {
    patterns: [/^(いいえ|いや|やめて|キャンセル|違う|やめ|だめ|ダメ)$/],
    resolve: () => ({ action: 'confirm', value: false }),
  },

  // ── 戻る ─────────────────────────────────────────────────────────────
  {
    patterns: [/^(戻って|戻る|バック|前の画面)$/],
    resolve: () => ({ action: 'back' }),
  },

  // ── 停止 ─────────────────────────────────────────────────────────────
  {
    patterns: [/^(止めて|停止|ストップ|終わり|おしまい)$/],
    resolve: () => ({ action: 'stop' }),
  },

  // ── 元に戻す（undo） ─────────────────────────────────────────────────
  {
    patterns: [/^(元に戻して|アンドゥ|取り消し|取り消して|やり直し)$/],
    resolve: () => ({ action: 'undo' }),
  },

  // ── 番号選択（1〜5、一〜五） ─────────────────────────────────────────
  {
    patterns: [/^([1-5一二三四五])(番)?$/],
    resolve: (m) => ({ action: 'select', index: toNumber(m[1]) }),
  },

  // ── ヘルプ ───────────────────────────────────────────────────────────
  {
    patterns: [/^(ヘルプ|使い方|何ができる|help)$/i],
    resolve: () => ({ action: 'help' }),
  },
];

// Fix 11: ReDoS 防止のための入力長制限
const MAX_INPUT_LENGTH = 500;

/**
 * 発話テキストをルールにマッチさせる。
 * @param {string} text - 音声認識で得られたテキスト
 * @returns {object|null} マッチしたアクションオブジェクト、または null（LLMへ委譲）
 */
function match(text) {
  if (!text || typeof text !== 'string') return null;
  const trimmed = text.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_INPUT_LENGTH) return null;

  for (const rule of QUICK_PATTERNS) {
    for (const pattern of rule.patterns) {
      const m = trimmed.match(pattern);
      if (m) return rule.resolve(m);
    }
  }

  return null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { match, QUICK_PATTERNS, LABEL_TO_API };
}
