'use strict';

// lib/errorHandler.js
// 全モジュールのエラーを統一分類し、日本語ユーザーメッセージを返す

const ERROR_CATEGORY = {
  NETWORK:        'network',
  AUTH:           'auth',
  PERMISSION:     'permission',
  RATE_LIMIT:     'rate_limit',
  FREE_PLAN_LIMIT:'free_plan_limit',
  CONFLICT:       'conflict',
  NOT_FOUND:      'not_found',
  SERVER_ERROR:   'server_error',
  SPEECH:         'speech',
  VALIDATION:     'validation',
  UNKNOWN:        'unknown',
};

// Web Speech API の onerror イベントで渡される error 文字列 → ユーザーメッセージ
const SPEECH_ERROR_MESSAGES = {
  'no-speech':              '音声が検出されませんでした。もう一度お試しください。',
  'not-allowed':            'マイクへのアクセスが許可されていません。設定を確認してください。',
  'audio-capture':          'マイクが見つかりません。接続を確認してください。',
  'network':                '音声認識のネットワークエラーが発生しました。',
  'aborted':                '音声認識が中断されました。',
  'language-not-supported': '言語設定がサポートされていません。',
  'service-not-allowed':    '音声認識サービスへのアクセスが許可されていません。',
};

// salesforceApi.js の SF_ERROR_CODES → ユーザーメッセージ
const SF_CODE_RESULTS = {
  TOKEN_EXPIRED:     { category: ERROR_CATEGORY.AUTH,         message: '認証の有効期限が切れています。再度ログインしてください。' },
  PERMISSION_DENIED: { category: ERROR_CATEGORY.PERMISSION,   message: 'このレコードへのアクセス権限がありません。' },
  RATE_LIMITED:      { category: ERROR_CATEGORY.RATE_LIMIT,   message: 'リクエスト数の上限に達しました。しばらく待ってから再試行してください。' },
  CONFLICT:          { category: ERROR_CATEGORY.CONFLICT,     message: 'レコードが別のユーザーによって更新されています。' },
  NOT_FOUND:         { category: ERROR_CATEGORY.NOT_FOUND,    message: 'レコードが見つかりません。' },
  SERVER_ERROR:      { category: ERROR_CATEGORY.SERVER_ERROR, message: 'Salesforceサーバーエラーが発生しました。しばらく待ってから再試行してください。' },
};

const NETWORK_ERROR_MESSAGE = 'ネットワークエラーが発生しました。インターネット接続を確認してください。';
const DEFAULT_ERROR_MESSAGE  = '予期しないエラーが発生しました。もう一度お試しください。';

/**
 * エラーを分類し、ユーザー向けカテゴリとメッセージを返す
 *
 * 分類優先度:
 *   1. null/undefined → UNKNOWN
 *   2. string         → SPEECH（Web Speech API エラーコード）
 *   3. TypeError      → NETWORK（fetch 失敗）
 *   4. error.code     → Salesforce API エラー
 *   5. error.status   → Cloudflare Worker HTTP ステータスエラー
 *   6. error.message  → 汎用ネットワークエラー文字列マッチ
 *   7. その他         → UNKNOWN
 *
 * @param {Error|string|null} error
 * @returns {{ category: string, message: string }}
 */
function classifyError(error) {
  if (!error) {
    return { category: ERROR_CATEGORY.UNKNOWN, message: DEFAULT_ERROR_MESSAGE };
  }

  // 音声認識エラー（Web Speech API が onerror に渡す文字列）
  if (typeof error === 'string') {
    return {
      category: ERROR_CATEGORY.SPEECH,
      message:  SPEECH_ERROR_MESSAGES[error] || '音声認識エラーが発生しました。',
    };
  }

  // ネットワーク切断 (fetch が TypeError をスロー)
  if (error instanceof TypeError) {
    return { category: ERROR_CATEGORY.NETWORK, message: NETWORK_ERROR_MESSAGE };
  }

  // Salesforce API エラーコード (salesforceApi.js の handleResponse がセット)
  if (error.code && SF_CODE_RESULTS[error.code]) {
    return SF_CODE_RESULTS[error.code];
  }

  // Cloudflare Worker の HTTP ステータスエラー (intentResolver.js がセット)
  if (typeof error.status === 'number') {
    if (error.status === 429) {
      return { category: ERROR_CATEGORY.FREE_PLAN_LIMIT, message: '本日の利用制限に達しました。明日以降にお試しください。' };
    }
    if (error.status === 401) {
      return { category: ERROR_CATEGORY.AUTH, message: '認証の有効期限が切れています。再度ログインしてください。' };
    }
    if (error.status === 502 || error.status === 503) {
      return { category: ERROR_CATEGORY.SERVER_ERROR, message: '音声解析サービスが一時的に利用できません。しばらく待ってから再試行してください。' };
    }
  }

  // 汎用ネットワークエラー（メッセージ文字列マッチ）
  if (error.message && /failed to fetch|network error/i.test(error.message)) {
    return { category: ERROR_CATEGORY.NETWORK, message: NETWORK_ERROR_MESSAGE };
  }

  return { category: ERROR_CATEGORY.UNKNOWN, message: error.message || DEFAULT_ERROR_MESSAGE };
}

/**
 * エラーを分類してウィジェットにエラー状態をセットする
 * @param {{ setState: function }} widget - createWidget() が返すオブジェクト
 * @param {Error|string|null} error
 */
function showError(widget, error) {
  const { message } = classifyError(error);
  widget.setState('error', { message });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { classifyError, showError, ERROR_CATEGORY, SPEECH_ERROR_MESSAGES };
}
