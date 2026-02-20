'use strict';

const auth = require('../../lib/auth');

describe('lib/auth.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
  });

  // ──────────────────────────────────────────
  // generateEncryptionKey
  // ──────────────────────────────────────────
  describe('generateEncryptionKey', () => {
    test('AES-256-GCM 鍵を生成する', async () => {
      const key = await auth.generateEncryptionKey();
      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(key.algorithm.name).toBe('AES-GCM');
      expect(key.algorithm.length).toBe(256);
    });

    test('毎回異なる鍵を生成する', async () => {
      const key1 = await auth.generateEncryptionKey();
      const key2 = await auth.generateEncryptionKey();
      const raw1 = await crypto.subtle.exportKey('raw', key1);
      const raw2 = await crypto.subtle.exportKey('raw', key2);
      expect(Buffer.from(raw1).toString('hex')).not.toBe(Buffer.from(raw2).toString('hex'));
    });
  });

  // ──────────────────────────────────────────
  // encryptString / decryptString
  // ──────────────────────────────────────────
  describe('encryptString / decryptString', () => {
    test('ASCII テキストの暗号化・復号ラウンドトリップ', async () => {
      const key = await auth.generateEncryptionKey();
      const plaintext = 'test-access-token-12345';
      const { iv, ciphertext } = await auth.encryptString(key, plaintext);

      expect(typeof iv).toBe('string');
      expect(typeof ciphertext).toBe('string');
      expect(ciphertext).not.toBe(plaintext);

      const decrypted = await auth.decryptString(key, iv, ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    test('日本語テキストの暗号化・復号', async () => {
      const key = await auth.generateEncryptionKey();
      const plaintext = 'テストアクセストークン日本語';
      const { iv, ciphertext } = await auth.encryptString(key, plaintext);
      const decrypted = await auth.decryptString(key, iv, ciphertext);
      expect(decrypted).toBe(plaintext);
    });

    test('同じ平文でも暗号化のたびに異なる IV を生成する', async () => {
      const key = await auth.generateEncryptionKey();
      const plaintext = 'same-plaintext';
      const { iv: iv1 } = await auth.encryptString(key, plaintext);
      const { iv: iv2 } = await auth.encryptString(key, plaintext);
      expect(iv1).not.toBe(iv2);
    });

    test('誤った鍵で復号するとエラーになる', async () => {
      const key1 = await auth.generateEncryptionKey();
      const key2 = await auth.generateEncryptionKey();
      const { iv, ciphertext } = await auth.encryptString(key1, 'secret');
      await expect(auth.decryptString(key2, iv, ciphertext)).rejects.toThrow();
    });
  });

  // ──────────────────────────────────────────
  // getOrCreateEncryptionKey
  // ──────────────────────────────────────────
  describe('getOrCreateEncryptionKey', () => {
    test('storage.session に鍵がなければ新規生成して保存する', async () => {
      chrome.storage.session.get.mockImplementationOnce((keys, cb) => cb({}));
      chrome.storage.session.set.mockImplementationOnce((items, cb) => cb());

      const key = await auth.getOrCreateEncryptionKey();

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(chrome.storage.session.set).toHaveBeenCalledWith(
        expect.objectContaining({ encryption_key: expect.any(String) }),
        expect.any(Function)
      );
    });

    test('storage.session に鍵があれば既存の鍵を復元する', async () => {
      const originalKey = await auth.generateEncryptionKey();
      const exported = await crypto.subtle.exportKey('raw', originalKey);
      const exportedBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));

      chrome.storage.session.get.mockImplementationOnce((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });

      const key = await auth.getOrCreateEncryptionKey();

      expect(key).toBeDefined();
      expect(key.type).toBe('secret');
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('復元した鍵で正しく復号できる（ラウンドトリップ）', async () => {
      const originalKey = await auth.generateEncryptionKey();
      const { iv, ciphertext } = await auth.encryptString(originalKey, 'hello');

      const exported = await crypto.subtle.exportKey('raw', originalKey);
      const exportedBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));

      chrome.storage.session.get.mockImplementationOnce((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });

      const restoredKey = await auth.getOrCreateEncryptionKey();
      const decrypted = await auth.decryptString(restoredKey, iv, ciphertext);
      expect(decrypted).toBe('hello');
    });
  });

  // ──────────────────────────────────────────
  // isConnected
  // ──────────────────────────────────────────
  describe('isConnected', () => {
    test('instance_url が存在すれば true を返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({ instance_url: 'https://test.salesforce.com' });
      });
      const result = await auth.isConnected();
      expect(result).toBe(true);
    });

    test('instance_url が存在しなければ false を返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));
      const result = await auth.isConnected();
      expect(result).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // getInstanceUrl
  // ──────────────────────────────────────────
  describe('getInstanceUrl', () => {
    test('保存された instance_url を返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({ instance_url: 'https://myorg.salesforce.com' });
      });
      const url = await auth.getInstanceUrl();
      expect(url).toBe('https://myorg.salesforce.com');
    });

    test('未保存の場合 null を返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));
      const url = await auth.getInstanceUrl();
      expect(url).toBeNull();
    });
  });

  // ──────────────────────────────────────────
  // disconnect
  // ──────────────────────────────────────────
  describe('disconnect', () => {
    test('全トークン情報をクリアする', async () => {
      chrome.storage.local.remove.mockImplementationOnce((keys, cb) => cb());
      await auth.disconnect();
      expect(chrome.storage.local.remove).toHaveBeenCalledWith(
        expect.arrayContaining([
          'encrypted_access_token',
          'encrypted_refresh_token',
          'instance_url',
          'token_expiry',
          'client_id',
          'token_iv',
          'refresh_iv',
        ]),
        expect.any(Function)
      );
    });
  });

  // ──────────────────────────────────────────
  // saveTokens
  // ──────────────────────────────────────────
  describe('saveTokens', () => {
    test('トークンを暗号化して storage.local に保存する', async () => {
      const exportedBase64 = await _makeExportedKeyBase64();
      chrome.storage.session.get.mockImplementation((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });
      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      await auth.saveTokens(
        'access_token_value',
        'refresh_token_value',
        'https://test.salesforce.com',
        3600,
        'test_client_id'
      );

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          encrypted_access_token: expect.any(String),
          encrypted_refresh_token: expect.any(String),
          token_iv: expect.any(String),
          refresh_iv: expect.any(String),
          instance_url: 'https://test.salesforce.com',
          client_id: 'test_client_id',
          token_expiry: expect.any(Number),
        }),
        expect.any(Function)
      );
    });
  });

  // ──────────────────────────────────────────
  // startOAuth
  // ──────────────────────────────────────────
  describe('startOAuth', () => {
    test('launchWebAuthFlow を呼び出し、コードを交換してトークンを保存する', async () => {
      const mockRedirectUrl =
        'https://test.chromiumapp.org/oauth?code=AUTH_CODE_123&state=abc';

      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        cb(mockRedirectUrl);
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
          instance_url: 'https://test.salesforce.com',
          expires_in: 3600,
        }),
      });

      chrome.storage.session.get.mockImplementation((keys, cb) => cb({}));
      chrome.storage.session.set.mockImplementation((items, cb) => cb());
      chrome.storage.local.set.mockImplementation((items, cb) => cb());

      await auth.startOAuth('test_client_id', 'https://login.salesforce.com');

      expect(chrome.identity.launchWebAuthFlow).toHaveBeenCalledWith(
        expect.objectContaining({
          url: expect.stringContaining('login.salesforce.com'),
          interactive: true,
        }),
        expect.any(Function)
      );
      expect(global.fetch).toHaveBeenCalled();
      expect(chrome.storage.local.set).toHaveBeenCalled();
    });

    test('OAuth フローがキャンセルされたらエラーをスローする', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        chrome.runtime.lastError = { message: 'User cancelled the flow' };
        cb(undefined);
      });

      await expect(
        auth.startOAuth('test_client_id', 'https://login.salesforce.com')
      ).rejects.toThrow('User cancelled the flow');
    });

    test('リダイレクト URL に code がなければエラーをスローする', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        cb('https://test.chromiumapp.org/oauth?error=access_denied');
      });

      await expect(
        auth.startOAuth('test_client_id', 'https://login.salesforce.com')
      ).rejects.toThrow();
    });

    test('トークン交換が失敗したらエラーをスローする', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        cb('https://test.chromiumapp.org/oauth?code=BAD_CODE&state=abc');
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_grant',
      });

      await expect(
        auth.startOAuth('test_client_id', 'https://login.salesforce.com')
      ).rejects.toThrow('Token exchange failed');
    });
  });

  // ──────────────────────────────────────────
  // getValidToken
  // ──────────────────────────────────────────
  describe('getValidToken', () => {
    test('有効期限内のトークンをそのまま返す', async () => {
      const { key, exportedBase64 } = await _makeKeyWithExport();
      const { iv, ciphertext } = await auth.encryptString(key, 'valid_access_token');
      const futureExpiry = Date.now() + 10 * 60 * 1000;

      chrome.storage.session.get.mockImplementation((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          encrypted_access_token: ciphertext,
          token_iv: iv,
          token_expiry: futureExpiry,
          instance_url: 'https://test.salesforce.com',
        });
      });

      const token = await auth.getValidToken();
      expect(token).toBe('valid_access_token');
    });

    test('トークンが未保存の場合はエラーをスローする', async () => {
      chrome.storage.session.get.mockImplementation((keys, cb) => cb({}));
      chrome.storage.session.set.mockImplementation((items, cb) => cb());
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));

      await expect(auth.getValidToken()).rejects.toThrow('Not authenticated');
    });

    test('5分以内に期限切れになるトークンはリフレッシュする', async () => {
      const { key, exportedBase64 } = await _makeKeyWithExport();
      const { iv: accessIv, ciphertext: accessCt } = await auth.encryptString(
        key, 'expiring_token'
      );
      const { iv: refreshIv, ciphertext: refreshCt } = await auth.encryptString(
        key, 'refresh_token_value'
      );
      const nearExpiry = Date.now() + 2 * 60 * 1000; // 2分後（5分バッファ内）

      // session.get は常に同じ鍵を返す
      chrome.storage.session.get.mockImplementation((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });

      // 1回目: getValidToken 内のトークン取得
      // 2回目: refreshAccessToken 内のリフレッシュトークン取得
      chrome.storage.local.get
        .mockImplementationOnce((keys, cb) => {
          cb({
            encrypted_access_token: accessCt,
            token_iv: accessIv,
            token_expiry: nearExpiry,
            instance_url: 'https://test.salesforce.com',
          });
        })
        .mockImplementationOnce((keys, cb) => {
          cb({
            encrypted_refresh_token: refreshCt,
            refresh_iv: refreshIv,
            instance_url: 'https://test.salesforce.com',
            client_id: 'test_client',
          });
        });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'refreshed_token',
          refresh_token: 'new_refresh_token',
          instance_url: 'https://test.salesforce.com',
          expires_in: 3600,
        }),
      });

      chrome.storage.local.set.mockImplementation((items, cb) => cb());

      const token = await auth.getValidToken();
      expect(token).toBe('refreshed_token');
    });
  });

  // ──────────────────────────────────────────
  // refreshAccessToken
  // ──────────────────────────────────────────
  describe('refreshAccessToken', () => {
    test('リフレッシュトークンがなければエラーをスローする', async () => {
      chrome.storage.session.get.mockImplementation((keys, cb) => cb({}));
      chrome.storage.session.set.mockImplementation((items, cb) => cb());
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));

      await expect(auth.refreshAccessToken()).rejects.toThrow(
        'No refresh token available'
      );
    });

    test('リフレッシュ API が失敗したらエラーをスローする', async () => {
      const { key, exportedBase64 } = await _makeKeyWithExport();
      const { iv: refreshIv, ciphertext: refreshCt } = await auth.encryptString(
        key, 'refresh_token_value'
      );

      chrome.storage.session.get.mockImplementation((keys, cb) => {
        cb({ encryption_key: exportedBase64 });
      });
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          encrypted_refresh_token: refreshCt,
          refresh_iv: refreshIv,
          instance_url: 'https://test.salesforce.com',
          client_id: 'test_client',
        });
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: false,
        text: async () => 'invalid_grant',
      });

      await expect(auth.refreshAccessToken()).rejects.toThrow('Token refresh failed');
    });
  });
});

// ──────────────────────────────────────────
// ヘルパー
// ──────────────────────────────────────────
async function _makeExportedKeyBase64() {
  const key = await crypto.subtle.generateKey(
    { name: 'AES-GCM', length: 256 },
    true,
    ['encrypt', 'decrypt']
  );
  const exported = await crypto.subtle.exportKey('raw', key);
  return btoa(String.fromCharCode(...new Uint8Array(exported)));
}

async function _makeKeyWithExport() {
  const key = await auth.generateEncryptionKey();
  const exported = await crypto.subtle.exportKey('raw', key);
  const exportedBase64 = btoa(String.fromCharCode(...new Uint8Array(exported)));
  return { key, exportedBase64 };
}
