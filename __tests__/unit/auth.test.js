'use strict';

const auth = require('../../lib/auth');

describe('lib/auth.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    chrome.runtime.lastError = null;
  });

  // ──────────────────────────────────────────
  // saveTokens
  // ──────────────────────────────────────────
  describe('saveTokens', () => {
    test('トークンを平文で storage.local に保存する', async () => {
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
          access_token: 'access_token_value',
          refresh_token: 'refresh_token_value',
          instance_url: 'https://test.salesforce.com',
          client_id: 'test_client_id',
          token_expiry: expect.any(Number),
        }),
        expect.any(Function)
      );
    });

    test('token_expiry は現在時刻 + expires_in 秒後になる', async () => {
      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const before = Date.now();
      await auth.saveTokens('at', 'rt', 'https://test.salesforce.com', 3600, 'cid');
      const after = Date.now();

      const savedItems = chrome.storage.local.set.mock.calls[0][0];
      expect(savedItems.token_expiry).toBeGreaterThanOrEqual(before + 3600 * 1000);
      expect(savedItems.token_expiry).toBeLessThanOrEqual(after + 3600 * 1000);
    });

    test('chrome.storage.session を使用しない', async () => {
      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());
      await auth.saveTokens('at', 'rt', 'https://test.salesforce.com', 3600, 'cid');
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
      expect(chrome.storage.session.get).not.toHaveBeenCalled();
    });
  });

  // ──────────────────────────────────────────
  // isConnected
  // ──────────────────────────────────────────
  describe('isConnected', () => {
    test('access_token が存在すれば true を返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({ access_token: 'some_token' });
      });
      const result = await auth.isConnected();
      expect(result).toBe(true);
    });

    test('access_token が存在しなければ false を返す', async () => {
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
          'access_token',
          'refresh_token',
          'instance_url',
          'token_expiry',
          'client_id',
        ]),
        expect.any(Function)
      );
    });
  });

  // ──────────────────────────────────────────
  // validateInstanceUrl
  // ──────────────────────────────────────────
  describe('validateInstanceUrl', () => {
    test('https://login.salesforce.com → true', () => {
      expect(auth.validateInstanceUrl('https://login.salesforce.com')).toBe(true);
    });

    test('https://test.salesforce.com → true', () => {
      expect(auth.validateInstanceUrl('https://test.salesforce.com')).toBe(true);
    });

    test('https://evil.com → false', () => {
      expect(auth.validateInstanceUrl('https://evil.com')).toBe(false);
    });

    test('https://login.salesforce.com.evil.com → false', () => {
      expect(auth.validateInstanceUrl('https://login.salesforce.com.evil.com')).toBe(false);
    });

    // eslint-disable-next-line no-script-url
    test('javascript: プロトコル → false', () => {
      expect(auth.validateInstanceUrl('javascript:alert(1)')).toBe(false); // eslint-disable-line no-script-url
    });

    test('null → false', () => {
      expect(auth.validateInstanceUrl(null)).toBe(false);
    });

    test('空文字 → false', () => {
      expect(auth.validateInstanceUrl('')).toBe(false);
    });

    test('数値型 → false', () => {
      expect(auth.validateInstanceUrl(123)).toBe(false);
    });

    test('http://login.salesforce.com（HTTP） → false', () => {
      expect(auth.validateInstanceUrl('http://login.salesforce.com')).toBe(false);
    });

    test('https://login.salesforce.com/path → true（パス付き）', () => {
      expect(auth.validateInstanceUrl('https://login.salesforce.com/some/path')).toBe(true);
    });
  });

  // ──────────────────────────────────────────
  // startOAuth
  // ──────────────────────────────────────────
  describe('startOAuth', () => {
    test('launchWebAuthFlow を呼び出し、コードを交換してトークンを平文保存する', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        const authUrl = new URL(params.url);
        const state = authUrl.searchParams.get('state');
        cb(`https://test.chromiumapp.org/oauth?code=AUTH_CODE_123&state=${encodeURIComponent(state)}`);
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
      // 平文で保存されることを確認
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'mock_access_token',
          refresh_token: 'mock_refresh_token',
        }),
        expect.any(Function)
      );
      // session storage を使用しないことを確認
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
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
        const authUrl = new URL(params.url);
        const state = authUrl.searchParams.get('state');
        cb(`https://test.chromiumapp.org/oauth?error=access_denied&state=${encodeURIComponent(state)}`);
      });

      await expect(
        auth.startOAuth('test_client_id', 'https://login.salesforce.com')
      ).rejects.toThrow();
    });

    test('不正な instanceUrl でエラーをスローする', async () => {
      await expect(
        auth.startOAuth('test_client_id', 'https://evil.com')
      ).rejects.toThrow('Invalid Salesforce login URL');
    });

    test('OAuth state が不一致の場合エラーをスローする (CSRF防止)', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        cb('https://test.chromiumapp.org/oauth?code=AUTH_CODE_123&state=WRONG_STATE');
      });

      await expect(
        auth.startOAuth('test_client_id', 'https://login.salesforce.com')
      ).rejects.toThrow('OAuth state mismatch');
    });

    test('トークン交換が失敗したらエラーをスローする', async () => {
      chrome.identity.launchWebAuthFlow.mockImplementationOnce((params, cb) => {
        const authUrl = new URL(params.url);
        const state = authUrl.searchParams.get('state');
        cb(`https://test.chromiumapp.org/oauth?code=BAD_CODE&state=${encodeURIComponent(state)}`);
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
      const futureExpiry = Date.now() + 10 * 60 * 1000;

      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          access_token: 'valid_access_token',
          token_expiry: futureExpiry,
          instance_url: 'https://test.salesforce.com',
        });
      });

      const token = await auth.getValidToken();
      expect(token).toBe('valid_access_token');
    });

    test('ブラウザ再起動後（session なし）も access_token を返せる', async () => {
      const futureExpiry = Date.now() + 60 * 60 * 1000;

      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          access_token: 'persisted_token',
          token_expiry: futureExpiry,
        });
      });

      const token = await auth.getValidToken();
      expect(token).toBe('persisted_token');
      // session storage を参照していないことを確認（再起動後も動作する）
      expect(chrome.storage.session.get).not.toHaveBeenCalled();
    });

    test('トークンが未保存の場合はエラーをスローする', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));

      await expect(auth.getValidToken()).rejects.toThrow('Not authenticated');
    });

    test('5分以内に期限切れになるトークンは自動リフレッシュする', async () => {
      const nearExpiry = Date.now() + 2 * 60 * 1000; // 2分後（5分バッファ内）

      chrome.storage.local.get
        .mockImplementationOnce((keys, cb) => {
          cb({
            access_token: 'expiring_token',
            token_expiry: nearExpiry,
            instance_url: 'https://test.salesforce.com',
          });
        })
        .mockImplementationOnce((keys, cb) => {
          cb({
            refresh_token: 'refresh_token_value',
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
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));

      await expect(auth.refreshAccessToken()).rejects.toThrow(
        'No refresh token available'
      );
    });

    test('リフレッシュ API が失敗したらエラーをスローする', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          refresh_token: 'refresh_token_value',
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

    test('リフレッシュ成功後、新しいトークンを storage.local に平文保存する', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          refresh_token: 'old_refresh_token',
          instance_url: 'https://test.salesforce.com',
          client_id: 'test_client',
        });
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
          instance_url: 'https://test.salesforce.com',
          expires_in: 3600,
        }),
      });

      chrome.storage.local.set.mockImplementation((items, cb) => cb());

      const token = await auth.refreshAccessToken();
      expect(token).toBe('new_access_token');
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          access_token: 'new_access_token',
          refresh_token: 'new_refresh_token',
        }),
        expect.any(Function)
      );
      // session storage を使用しないことを確認
      expect(chrome.storage.session.set).not.toHaveBeenCalled();
    });

    test('リフレッシュレスポンスに refresh_token がない場合は旧トークンを維持する', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({
          refresh_token: 'existing_refresh_token',
          instance_url: 'https://test.salesforce.com',
          client_id: 'test_client',
        });
      });

      global.fetch = jest.fn().mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          access_token: 'new_access_token',
          // refresh_token なし（Salesforce は毎回返さない場合がある）
          instance_url: 'https://test.salesforce.com',
          expires_in: 3600,
        }),
      });

      chrome.storage.local.set.mockImplementation((items, cb) => cb());

      await auth.refreshAccessToken();
      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          refresh_token: 'existing_refresh_token', // 旧トークンを維持
        }),
        expect.any(Function)
      );
    });
  });
});
