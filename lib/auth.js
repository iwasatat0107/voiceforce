'use strict';

// OAuth 2.0 Authorization Code Flow + AES-256-GCM トークン暗号化
// Chrome Extension Manifest V3 対応（Service Worker / Content Script 共用）

const STORAGE_KEYS = {
  ENCRYPTED_ACCESS_TOKEN: 'encrypted_access_token',
  ENCRYPTED_REFRESH_TOKEN: 'encrypted_refresh_token',
  TOKEN_IV: 'token_iv',
  REFRESH_IV: 'refresh_iv',
  INSTANCE_URL: 'instance_url',
  TOKEN_EXPIRY: 'token_expiry',
  CLIENT_ID: 'client_id',
  ENCRYPTION_KEY: 'encryption_key',
};

// 有効期限の 5分前にリフレッシュするバッファ
const REFRESH_BUFFER_MS = 5 * 60 * 1000;

// Fix 2: Salesforce ログイン URL のみ許可
const SALESFORCE_LOGIN_PATTERN = /^https:\/\/(login|test)\.salesforce\.com$/;

/**
 * Salesforce のログイン URL として有効かどうかを検証する
 * @param {string} url
 * @returns {boolean}
 */
function validateInstanceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return SALESFORCE_LOGIN_PATTERN.test(new URL(url).origin);
  } catch (_) {
    return false;
  }
}

/**
 * AES-256-GCM 暗号化鍵を生成する
 * @returns {Promise<CryptoKey>}
 */
async function generateEncryptionKey() {
  return crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
}

/**
 * 文字列を AES-256-GCM で暗号化する
 * @param {CryptoKey} key
 * @param {string} plaintext
 * @returns {Promise<{ iv: string, ciphertext: string }>} Base64 エンコード済み
 */
async function encryptString(key, plaintext) {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv },
    key,
    encoded
  );
  return {
    iv: btoa(String.fromCharCode(...iv)),
    ciphertext: btoa(String.fromCharCode(...new Uint8Array(encrypted))),
  };
}

/**
 * AES-256-GCM で復号する
 * @param {CryptoKey} key
 * @param {string} ivBase64
 * @param {string} ciphertextBase64
 * @returns {Promise<string>}
 */
async function decryptString(key, ivBase64, ciphertextBase64) {
  const iv = Uint8Array.from(atob(ivBase64), (c) => c.charCodeAt(0));
  const ciphertext = Uint8Array.from(atob(ciphertextBase64), (c) => c.charCodeAt(0));
  const decrypted = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv },
    key,
    ciphertext
  );
  return new TextDecoder().decode(decrypted);
}

/**
 * chrome.storage.session から暗号化鍵を取得する。
 * なければ新規生成して保存する。
 * @returns {Promise<CryptoKey>}
 */
async function getOrCreateEncryptionKey() {
  return new Promise((resolve, reject) => {
    chrome.storage.session.get([STORAGE_KEYS.ENCRYPTION_KEY], async (result) => {
      if (result[STORAGE_KEYS.ENCRYPTION_KEY]) {
        // 既存の鍵を復元
        try {
          const keyBytes = Uint8Array.from(
            atob(result[STORAGE_KEYS.ENCRYPTION_KEY]),
            (c) => c.charCodeAt(0)
          );
          const key = await crypto.subtle.importKey(
            'raw',
            keyBytes,
            { name: 'AES-GCM' },
            true,
            ['encrypt', 'decrypt']
          );
          resolve(key);
        } catch (err) {
          reject(err);
        }
      } else {
        // 新しい鍵を生成して保存
        try {
          const key = await generateEncryptionKey();
          const exported = await crypto.subtle.exportKey('raw', key);
          const exportedBase64 = btoa(
            String.fromCharCode(...new Uint8Array(exported))
          );
          chrome.storage.session.set(
            { [STORAGE_KEYS.ENCRYPTION_KEY]: exportedBase64 },
            () => resolve(key)
          );
        } catch (err) {
          reject(err);
        }
      }
    });
  });
}

/**
 * トークンを暗号化して chrome.storage.local に保存する
 * @param {string} accessToken
 * @param {string} refreshToken
 * @param {string} instanceUrl
 * @param {number} expiresIn - 秒単位
 * @param {string} clientId
 */
async function saveTokens(accessToken, refreshToken, instanceUrl, expiresIn, clientId) {
  const key = await getOrCreateEncryptionKey();
  const { iv: tokenIv, ciphertext: encryptedAccess } = await encryptString(
    key,
    accessToken
  );
  const { iv: refreshIv, ciphertext: encryptedRefresh } = await encryptString(
    key,
    refreshToken
  );
  const tokenExpiry = Date.now() + expiresIn * 1000;

  return new Promise((resolve) => {
    chrome.storage.local.set(
      {
        [STORAGE_KEYS.ENCRYPTED_ACCESS_TOKEN]: encryptedAccess,
        [STORAGE_KEYS.ENCRYPTED_REFRESH_TOKEN]: encryptedRefresh,
        [STORAGE_KEYS.TOKEN_IV]: tokenIv,
        [STORAGE_KEYS.REFRESH_IV]: refreshIv,
        [STORAGE_KEYS.INSTANCE_URL]: instanceUrl,
        [STORAGE_KEYS.TOKEN_EXPIRY]: tokenExpiry,
        [STORAGE_KEYS.CLIENT_ID]: clientId,
      },
      () => resolve()
    );
  });
}

/**
 * 認証コードをアクセストークンと交換する
 * @param {string} code
 * @param {string} instanceUrl
 * @param {string} clientId
 * @param {string} redirectUri
 * @returns {Promise<object>} トークンレスポンス
 */
async function exchangeCodeForTokens(code, instanceUrl, clientId, redirectUri) {
  const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      client_id: clientId,
      redirect_uri: redirectUri,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Salesforce OAuth 2.0 Authorization Code Flow を開始する
 * @param {string} clientId - Salesforce Connected App の Consumer Key
 * @param {string} instanceUrl - ログイン URL（デフォルト: https://login.salesforce.com）
 */
async function startOAuth(clientId, instanceUrl = 'https://login.salesforce.com') {
  // Fix 2: instanceUrl のバリデーション
  if (!validateInstanceUrl(instanceUrl)) {
    throw new Error('Invalid Salesforce login URL');
  }

  const redirectUri = chrome.identity.getRedirectURL('oauth');
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = btoa(String.fromCharCode(...stateBytes));

  const authUrl =
    `${instanceUrl}/services/oauth2/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'api refresh_token',
    });

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(
            new Error(
              chrome.runtime.lastError?.message || 'OAuth flow was cancelled'
            )
          );
          return;
        }
        resolve(responseUrl);
      }
    );
  });

  const url = new URL(redirectUrl);

  // Fix 4: OAuth state 検証（CSRF 防止）
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch - possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) {
    throw new Error('Authorization code not found in redirect URL');
  }

  const tokens = await exchangeCodeForTokens(code, instanceUrl, clientId, redirectUri);
  await saveTokens(
    tokens.access_token,
    tokens.refresh_token,
    tokens.instance_url || instanceUrl,
    tokens.expires_in || 3600,
    clientId
  );
}

/**
 * リフレッシュトークンを使って新しいアクセストークンを取得・保存する
 * @returns {Promise<string>} 新しいアクセストークン
 */
async function refreshAccessToken() {
  const key = await getOrCreateEncryptionKey();

  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.ENCRYPTED_REFRESH_TOKEN,
        STORAGE_KEYS.REFRESH_IV,
        STORAGE_KEYS.INSTANCE_URL,
        STORAGE_KEYS.CLIENT_ID,
      ],
      (result) => resolve(result)
    );
  });

  if (!stored[STORAGE_KEYS.ENCRYPTED_REFRESH_TOKEN]) {
    throw new Error('No refresh token available');
  }

  const refreshToken = await decryptString(
    key,
    stored[STORAGE_KEYS.REFRESH_IV],
    stored[STORAGE_KEYS.ENCRYPTED_REFRESH_TOKEN]
  );
  const instanceUrl = stored[STORAGE_KEYS.INSTANCE_URL];
  const clientId = stored[STORAGE_KEYS.CLIENT_ID];

  const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: clientId,
    }),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token refresh failed: ${error}`);
  }

  const tokens = await response.json();
  await saveTokens(
    tokens.access_token,
    tokens.refresh_token || refreshToken,
    tokens.instance_url || instanceUrl,
    tokens.expires_in || 3600,
    clientId
  );

  return tokens.access_token;
}

/**
 * 有効なアクセストークンを返す。
 * 期限まで 5分を切っている場合はリフレッシュする。
 * @returns {Promise<string>}
 */
async function getValidToken() {
  const key = await getOrCreateEncryptionKey();

  const stored = await new Promise((resolve) => {
    chrome.storage.local.get(
      [
        STORAGE_KEYS.ENCRYPTED_ACCESS_TOKEN,
        STORAGE_KEYS.TOKEN_IV,
        STORAGE_KEYS.TOKEN_EXPIRY,
        STORAGE_KEYS.INSTANCE_URL,
      ],
      (result) => resolve(result)
    );
  });

  if (!stored[STORAGE_KEYS.ENCRYPTED_ACCESS_TOKEN]) {
    throw new Error('Not authenticated');
  }

  const isExpiringSoon =
    stored[STORAGE_KEYS.TOKEN_EXPIRY] - Date.now() < REFRESH_BUFFER_MS;

  if (isExpiringSoon) {
    return refreshAccessToken();
  }

  return decryptString(
    key,
    stored[STORAGE_KEYS.TOKEN_IV],
    stored[STORAGE_KEYS.ENCRYPTED_ACCESS_TOKEN]
  );
}

/**
 * 接続を解除し、全トークン情報を削除する
 */
async function disconnect() {
  return new Promise((resolve) => {
    chrome.storage.local.remove(
      [
        STORAGE_KEYS.ENCRYPTED_ACCESS_TOKEN,
        STORAGE_KEYS.ENCRYPTED_REFRESH_TOKEN,
        STORAGE_KEYS.INSTANCE_URL,
        STORAGE_KEYS.TOKEN_EXPIRY,
        STORAGE_KEYS.CLIENT_ID,
        STORAGE_KEYS.TOKEN_IV,
        STORAGE_KEYS.REFRESH_IV,
      ],
      () => resolve()
    );
  });
}

/**
 * Salesforce に接続済みかどうかを確認する
 * @returns {Promise<boolean>}
 */
async function isConnected() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.INSTANCE_URL], (result) => {
      resolve(!!result[STORAGE_KEYS.INSTANCE_URL]);
    });
  });
}

/**
 * 保存されている Salesforce インスタンス URL を返す
 * @returns {Promise<string|null>}
 */
async function getInstanceUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.INSTANCE_URL], (result) => {
      resolve(result[STORAGE_KEYS.INSTANCE_URL] || null);
    });
  });
}

// Node.js (Jest) 環境向け CommonJS エクスポート
// ブラウザ環境（Service Worker / Content Script）では importScripts() で読み込む
if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    generateEncryptionKey,
    encryptString,
    decryptString,
    getOrCreateEncryptionKey,
    validateInstanceUrl,
    startOAuth,
    exchangeCodeForTokens,
    saveTokens,
    getValidToken,
    refreshAccessToken,
    disconnect,
    isConnected,
    getInstanceUrl,
  };
}
