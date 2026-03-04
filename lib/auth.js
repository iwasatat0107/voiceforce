'use strict';

// OAuth 2.0 Authorization Code Flow + トークン管理
// Chrome Extension Manifest V3 対応（Service Worker / Content Script 共用）
// トークンは chrome.storage.local に平文保存する。
// chrome.storage.local は拡張のサンドボックス内に隔離されており、
// 他の拡張やウェブページからはアクセス不可。ブラウザ再起動後も自動で再接続できる。

const STORAGE_KEYS = {
  ACCESS_TOKEN:  'access_token',
  REFRESH_TOKEN: 'refresh_token',
  INSTANCE_URL:  'instance_url',
  TOKEN_EXPIRY:  'token_expiry',
  CLIENT_ID:     'client_id',
};

const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const SALESFORCE_LOGIN_PATTERN = /^https:\/\/(login|test)\.salesforce\.com$/;

function validateInstanceUrl(url) {
  if (!url || typeof url !== 'string') return false;
  try {
    return SALESFORCE_LOGIN_PATTERN.test(new URL(url).origin);
  } catch (_) {
    return false;
  }
}

async function saveTokens(accessToken, refreshToken, instanceUrl, expiresIn, clientId) {
  const tokenExpiry = Date.now() + expiresIn * 1000;
  return new Promise((resolve) => {
    chrome.storage.local.set({
      [STORAGE_KEYS.ACCESS_TOKEN]:  accessToken,
      [STORAGE_KEYS.REFRESH_TOKEN]: refreshToken,
      [STORAGE_KEYS.INSTANCE_URL]:  instanceUrl,
      [STORAGE_KEYS.TOKEN_EXPIRY]:  tokenExpiry,
      [STORAGE_KEYS.CLIENT_ID]:     clientId,
    }, () => resolve());
  });
}

/**
 * 認証コードをアクセストークンと交換する（PKCE + clientSecret 対応）
 */
async function exchangeCodeForTokens(code, instanceUrl, clientId, redirectUri, codeVerifier, clientSecret) {
  const params = {
    grant_type: 'authorization_code',
    code,
    client_id: clientId,
    redirect_uri: redirectUri,
  };
  if (codeVerifier) params.code_verifier = codeVerifier;
  if (clientSecret) params.client_secret = clientSecret;

  const response = await fetch(`${instanceUrl}/services/oauth2/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(params),
  });

  if (!response.ok) {
    const error = await response.text();
    throw new Error(`Token exchange failed: ${error}`);
  }

  return response.json();
}

/**
 * Salesforce OAuth 2.0 Authorization Code Flow + PKCE を開始する
 */
async function startOAuth(clientId, instanceUrl = 'https://login.salesforce.com', clientSecret) {
  if (!validateInstanceUrl(instanceUrl)) {
    throw new Error('Invalid Salesforce login URL');
  }

  const redirectUri = chrome.identity.getRedirectURL('oauth');
  const stateBytes = crypto.getRandomValues(new Uint8Array(16));
  const state = btoa(String.fromCharCode(...stateBytes));

  // PKCE: code_verifier と code_challenge を生成
  const codeVerifierBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = btoa(String.fromCharCode(...codeVerifierBytes))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');
  const codeVerifierHash = await crypto.subtle.digest(
    'SHA-256', new TextEncoder().encode(codeVerifier)
  );
  const codeChallenge = btoa(String.fromCharCode(...new Uint8Array(codeVerifierHash)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=/g, '');

  const authUrl =
    `${instanceUrl}/services/oauth2/authorize?` +
    new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      state,
      scope: 'api refresh_token',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    });

  const redirectUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      (responseUrl) => {
        if (chrome.runtime.lastError || !responseUrl) {
          reject(new Error(chrome.runtime.lastError?.message || 'OAuth flow was cancelled'));
          return;
        }
        resolve(responseUrl);
      }
    );
  });

  const url = new URL(redirectUrl);
  const returnedState = url.searchParams.get('state');
  if (returnedState !== state) {
    throw new Error('OAuth state mismatch - possible CSRF attack');
  }

  const code = url.searchParams.get('code');
  if (!code) throw new Error('Authorization code not found in redirect URL');

  const tokens = await exchangeCodeForTokens(
    code, instanceUrl, clientId, redirectUri, codeVerifier, clientSecret
  );
  await saveTokens(
    tokens.access_token,
    tokens.refresh_token,
    tokens.instance_url || instanceUrl,
    tokens.expires_in || 3600,
    clientId
  );
}

async function refreshAccessToken() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get([
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.INSTANCE_URL,
      STORAGE_KEYS.CLIENT_ID,
    ], (result) => resolve(result));
  });

  if (!stored[STORAGE_KEYS.REFRESH_TOKEN]) {
    throw new Error('No refresh token available');
  }

  const refreshToken = stored[STORAGE_KEYS.REFRESH_TOKEN];
  const instanceUrl  = stored[STORAGE_KEYS.INSTANCE_URL];
  const clientId     = stored[STORAGE_KEYS.CLIENT_ID];

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
    tokens.refresh_token || refreshToken, // Salesforce は毎回返さない場合がある
    tokens.instance_url || instanceUrl,
    tokens.expires_in || 3600,
    clientId
  );
  return tokens.access_token;
}

async function getValidToken() {
  const stored = await new Promise((resolve) => {
    chrome.storage.local.get([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.TOKEN_EXPIRY,
      STORAGE_KEYS.INSTANCE_URL,
    ], (result) => resolve(result));
  });

  if (!stored[STORAGE_KEYS.ACCESS_TOKEN]) throw new Error('Not authenticated');

  const isExpiringSoon = stored[STORAGE_KEYS.TOKEN_EXPIRY] - Date.now() < REFRESH_BUFFER_MS;
  if (isExpiringSoon) return refreshAccessToken();

  return stored[STORAGE_KEYS.ACCESS_TOKEN];
}

async function disconnect() {
  return new Promise((resolve) => {
    chrome.storage.local.remove([
      STORAGE_KEYS.ACCESS_TOKEN,
      STORAGE_KEYS.REFRESH_TOKEN,
      STORAGE_KEYS.INSTANCE_URL,
      STORAGE_KEYS.TOKEN_EXPIRY,
      STORAGE_KEYS.CLIENT_ID,
    ], () => resolve());
  });
}

async function isConnected() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.ACCESS_TOKEN], (result) => {
      resolve(!!result[STORAGE_KEYS.ACCESS_TOKEN]);
    });
  });
}

async function getInstanceUrl() {
  return new Promise((resolve) => {
    chrome.storage.local.get([STORAGE_KEYS.INSTANCE_URL], (result) => {
      resolve(result[STORAGE_KEYS.INSTANCE_URL] || null);
    });
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
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
