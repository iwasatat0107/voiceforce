'use strict';

// lib/intentResolver.js
// LLMリクエスト・レスポンスのホワイトリスト検証

const VALID_ACTIONS = ['navigate', 'search', 'create', 'update', 'summary', 'unknown'];

/**
 * LLMレスポンスJSONのホワイトリスト検証
 * @param {object} json - LLMから返されたJSONオブジェクト
 * @param {object|null} metadata - メタデータ（objects配列, getFieldsメソッド）
 * @returns {boolean} 検証OK=true、NG=false
 */
function validateLLMOutput(json, metadata) {
  if (!json || typeof json !== 'object') return false;

  // actionホワイトリスト
  if (!VALID_ACTIONS.includes(json.action)) return false;

  // confidenceの型・範囲確認
  if (typeof json.confidence !== 'number' || json.confidence < 0 || json.confidence > 1) return false;

  // object存在確認（objectが指定されており、metadataがある場合のみ）
  if (json.object && metadata && metadata.objects) {
    if (!metadata.objects.includes(json.object)) return false;
  }

  // fieldsホワイトリスト（fieldsが指定されており、metadataがある場合のみ）
  if (json.fields && metadata && typeof metadata.getFields === 'function') {
    if (!json.object) return false;
    const validFields = metadata.getFields(json.object);
    for (const key of Object.keys(json.fields)) {
      if (!validFields.includes(key)) return false;
    }
  }

  return true;
}

/**
 * Cloudflare WorkerへLLMリクエストを送信し意図を解析する
 * @param {string} text - 音声認識テキスト
 * @param {string} metadataStr - Salesforceメタデータ文字列（プロンプトに埋め込む）
 * @param {string} workerUrl - Cloudflare WorkerのURL
 * @param {string} userId - ユーザーID
 * @returns {Promise<object>} 解析結果JSON
 */
async function resolveIntent(text, metadataStr, workerUrl, userId) {
  const response = await fetch(`${workerUrl}/api/v1/analyze`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, metadata: metadataStr, user_id: userId }),
  });

  if (!response.ok) {
    let errorMessage;
    try {
      const errorData = await response.json();
      errorMessage = errorData.error || `Worker error: ${response.status}`;
    } catch (_) {
      errorMessage = `Worker error: ${response.status}`;
    }
    const error = new Error(errorMessage);
    error.status = response.status;
    throw error;
  }

  return response.json();
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { validateLLMOutput, resolveIntent, VALID_ACTIONS };
}
