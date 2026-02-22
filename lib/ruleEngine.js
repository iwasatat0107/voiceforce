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

const OBJECT_NAMES = '商談|相談|取引先責任者|取引先|リード|タスク|行動|ToDo';

// 「商談」に誤認識されやすい「相談」も Opportunity にマッピング
const LABEL_TO_API_EXTENDED = {
  ...LABEL_TO_API,
  '相談': 'Opportunity',
};

// 末尾のてください系（任意）
const SUFFIX = '(してください|ください|て)?';
// 動詞
const VERB = '(出して|開いて|見せて|表示して|表示|開く|開け)';

const QUICK_PATTERNS = [
  // ── すべて・全件フィルター付き一覧 ─────────────────────────────────
  {
    patterns: [
      // 例: 「すべての商談を開いて」「全ての商談を開いて」「全部の商談」
      new RegExp(`^(すべて|全て|全部)(の)?(${OBJECT_NAMES})(を)?${VERB}?${SUFFIX}$`),
      // 例: 「商談のすべてを開いて」「商談の全てを表示して」
      new RegExp(`^(${OBJECT_NAMES})(の)(すべて|全て|全部)(を)?${VERB}?${SUFFIX}$`),
    ],
    resolve: (m) => {
      const obj = LABEL_TO_API_EXTENDED[m[3]] || LABEL_TO_API_EXTENDED[m[1]] || LABEL_TO_API[m[3]] || LABEL_TO_API[m[1]];
      return {
        action: 'navigate',
        object: obj,
        target: 'list',
        filterName: 'All',
        confidence: 1.0,
        message: `${obj === 'Opportunity' ? '商談' : m[1] || m[3]}の全件一覧を開きます`,
      };
    },
  },

  // ── 最近参照フィルター付き一覧 ──────────────────────────────────────
  {
    patterns: [
      new RegExp(`^(最近|最近参照した|最近見た)(の)?(${OBJECT_NAMES})(を)?${VERB}?${SUFFIX}$`),
      new RegExp(`^(${OBJECT_NAMES})(の)?(最近|最近参照した|最近見た)(を)?${VERB}?${SUFFIX}$`),
    ],
    resolve: (m) => {
      const obj = LABEL_TO_API_EXTENDED[m[3]] || LABEL_TO_API_EXTENDED[m[1]] || LABEL_TO_API[m[3]] || LABEL_TO_API[m[1]];
      return {
        action: 'navigate',
        object: obj,
        target: 'list',
        filterName: 'RecentlyViewed',
        confidence: 1.0,
        message: '最近参照した一覧を開きます',
      };
    },
  },

  // ── 自分のフィルター付き一覧 ────────────────────────────────────────
  {
    patterns: [
      new RegExp(`^(自分|私|自分の|私の)(${OBJECT_NAMES})(を)?${VERB}?${SUFFIX}$`),
      new RegExp(`^(${OBJECT_NAMES})(の)?(自分|私)(の)?(分)?(を)?${VERB}?${SUFFIX}$`),
    ],
    resolve: (m) => {
      const obj = LABEL_TO_API_EXTENDED[m[2]] || LABEL_TO_API_EXTENDED[m[1]] || LABEL_TO_API[m[2]] || LABEL_TO_API[m[1]];
      return {
        action: 'navigate',
        object: obj,
        target: 'list',
        filterName: 'MyOpportunities',
        confidence: 1.0,
        message: '自分の一覧を開きます',
      };
    },
  },

  // ── オブジェクト一覧への遷移（フィルターなし） ──────────────────────
  {
    patterns: [
      // 例: 「商談」「商談の一覧」「商談リスト」
      new RegExp(`^(${OBJECT_NAMES})(の)?(一覧|リスト)?${SUFFIX}$`),
      // 例: 「商談を開いて」「商談出して」「商談を表示してください」
      new RegExp(`^(${OBJECT_NAMES})(を)?${VERB}${SUFFIX}$`),
      // 例: 「商談一覧を開いて」「商談の一覧を表示してください」
      new RegExp(`^(${OBJECT_NAMES})(の)?(一覧|リスト)(を)?${VERB}?${SUFFIX}$`),
    ],
    resolve: (m) => ({
      action: 'navigate',
      object: LABEL_TO_API_EXTENDED[m[1]] || LABEL_TO_API[m[1]],
      target: 'list',
      confidence: 1.0,
      message: `${m[1] === '相談' ? '商談' : m[1]}の一覧を開きます`,
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
