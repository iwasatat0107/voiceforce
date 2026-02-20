'use strict';

const metadata = require('../../lib/metadataManager');

// ──────────────────────────────────────────
// テスト用モックデータ
// ──────────────────────────────────────────
const INSTANCE_URL = 'https://test.salesforce.com';
const ACCESS_TOKEN = 'test_access_token';

const mockTabsResponse = {
  tabs: [
    { name: 'standard-account', sobjectName: 'Account', label: '取引先' },
    { name: 'standard-opportunity', sobjectName: 'Opportunity', label: '商談' },
    { name: 'standard-contact', sobjectName: 'Contact', label: '取引先責任者' },
  ],
};

const mockAccountDescribe = {
  name: 'Account',
  label: '取引先',
  fields: [
    { name: 'Id', label: 'レコードID', type: 'id', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'Name', label: '取引先名', type: 'string', createable: true, updateable: true, nillable: false, picklistValues: [] },
    { name: 'Phone', label: '電話', type: 'phone', createable: true, updateable: true, nillable: true, picklistValues: [] },
    { name: 'Industry', label: '業種', type: 'picklist', createable: true, updateable: true, nillable: true, picklistValues: [
      { label: '農業', value: 'Agriculture' },
      { label: '金融', value: 'Finance' },
    ]},
    { name: 'CreatedDate', label: '作成日', type: 'datetime', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'LastModifiedDate', label: '最終更新日', type: 'datetime', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'SystemModstamp', label: 'システム更新日', type: 'datetime', createable: false, updateable: false, nillable: true, picklistValues: [] },
  ],
};

const mockOpportunityDescribe = {
  name: 'Opportunity',
  label: '商談',
  fields: [
    { name: 'Id', label: 'レコードID', type: 'id', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'Name', label: '商談名', type: 'string', createable: true, updateable: true, nillable: false, picklistValues: [] },
    { name: 'Amount', label: '金額', type: 'currency', createable: true, updateable: true, nillable: true, picklistValues: [] },
    { name: 'StageName', label: 'フェーズ', type: 'picklist', createable: true, updateable: true, nillable: false, picklistValues: [
      { label: 'Prospecting', value: 'Prospecting' },
      { label: 'Closed Won', value: 'Closed Won' },
    ]},
    { name: 'CloseDate', label: '完了予定日', type: 'date', createable: true, updateable: true, nillable: false, picklistValues: [] },
  ],
};

const mockContactDescribe = {
  name: 'Contact',
  label: '取引先責任者',
  fields: [
    { name: 'Id', label: 'レコードID', type: 'id', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'LastName', label: '姓', type: 'string', createable: true, updateable: true, nillable: false, picklistValues: [] },
    { name: 'FirstName', label: '名', type: 'string', createable: true, updateable: true, nillable: true, picklistValues: [] },
    { name: 'Email', label: 'メール', type: 'email', createable: true, updateable: true, nillable: true, picklistValues: [] },
    { name: 'CreatedById', label: '作成者ID', type: 'reference', createable: false, updateable: false, nillable: true, picklistValues: [] },
    { name: 'IsDeleted', label: '削除済み', type: 'boolean', createable: false, updateable: false, nillable: false, picklistValues: [] },
  ],
};

describe('lib/metadataManager.js', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    global.fetch = jest.fn();
  });

  // ──────────────────────────────────────────
  // isCacheStale
  // ──────────────────────────────────────────
  describe('isCacheStale', () => {
    test('cachedAt が null/undefined の場合は true を返す', () => {
      expect(metadata.isCacheStale(null)).toBe(true);
      expect(metadata.isCacheStale(undefined)).toBe(true);
    });

    test('24時間以上前のタイムスタンプは stale と判定する', () => {
      const twoDaysAgo = Date.now() - 2 * 24 * 60 * 60 * 1000;
      expect(metadata.isCacheStale(twoDaysAgo)).toBe(true);
    });

    test('24時間ちょうどのタイムスタンプは stale と判定する', () => {
      const exactlyOneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
      expect(metadata.isCacheStale(exactlyOneDayAgo)).toBe(true);
    });

    test('24時間未満の新しいキャッシュは fresh と判定する', () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      expect(metadata.isCacheStale(oneHourAgo)).toBe(false);
    });

    test('現在時刻のタイムスタンプは fresh と判定する', () => {
      expect(metadata.isCacheStale(Date.now())).toBe(false);
    });
  });

  // ──────────────────────────────────────────
  // filterFields
  // ──────────────────────────────────────────
  describe('filterFields', () => {
    test('createable: true の項目を保持する', () => {
      const fields = [
        { name: 'Name', createable: true, updateable: false },
      ];
      const result = metadata.filterFields(fields);
      expect(result).toHaveLength(1);
      expect(result[0].name).toBe('Name');
    });

    test('updateable: true の項目を保持する', () => {
      const fields = [
        { name: 'Phone', createable: false, updateable: true },
      ];
      const result = metadata.filterFields(fields);
      expect(result).toHaveLength(1);
    });

    test('createable も updateable も false の項目は除外する', () => {
      const fields = [
        { name: 'CreatedDate', createable: false, updateable: false },
      ];
      const result = metadata.filterFields(fields);
      expect(result).toHaveLength(0);
    });

    test('Id はシステム項目として除外する', () => {
      const fields = [
        { name: 'Id', createable: false, updateable: false },
      ];
      const result = metadata.filterFields(fields);
      expect(result).toHaveLength(0);
    });

    test('CreatedById はシステム項目として除外する', () => {
      const fields = [
        { name: 'CreatedById', createable: false, updateable: false },
      ];
      expect(metadata.filterFields(fields)).toHaveLength(0);
    });

    test('LastModifiedDate はシステム項目として除外する', () => {
      const fields = [
        { name: 'LastModifiedDate', createable: false, updateable: false },
      ];
      expect(metadata.filterFields(fields)).toHaveLength(0);
    });

    test('SystemModstamp はシステム項目として除外する', () => {
      const fields = [
        { name: 'SystemModstamp', createable: false, updateable: false },
      ];
      expect(metadata.filterFields(fields)).toHaveLength(0);
    });

    test('IsDeleted はシステム項目として除外する', () => {
      const fields = [
        { name: 'IsDeleted', createable: false, updateable: false },
      ];
      expect(metadata.filterFields(fields)).toHaveLength(0);
    });

    test('Account の describe から適切にフィルタする', () => {
      const result = metadata.filterFields(mockAccountDescribe.fields);
      const names = result.map((f) => f.name);
      expect(names).toContain('Name');
      expect(names).toContain('Phone');
      expect(names).toContain('Industry');
      expect(names).not.toContain('Id');
      expect(names).not.toContain('CreatedDate');
      expect(names).not.toContain('LastModifiedDate');
      expect(names).not.toContain('SystemModstamp');
    });

    test('空配列を渡すと空配列を返す', () => {
      expect(metadata.filterFields([])).toEqual([]);
    });
  });

  // ──────────────────────────────────────────
  // buildMetadataResult
  // ──────────────────────────────────────────
  describe('buildMetadataResult', () => {
    const sampleObjects = [
      {
        name: 'Account',
        label: '取引先',
        fields: [
          { name: 'Name', label: '取引先名', type: 'string', nillable: false, picklistValues: [] },
          { name: 'Phone', label: '電話', type: 'phone', nillable: true, picklistValues: [] },
        ],
      },
      {
        name: 'Opportunity',
        label: '商談',
        fields: [
          { name: 'Name', label: '商談名', type: 'string', nillable: false, picklistValues: [] },
          { name: 'StageName', label: 'フェーズ', type: 'picklist', nillable: false, picklistValues: [
            { label: 'Prospecting', value: 'Prospecting' },
          ]},
        ],
      },
    ];

    test('.objects にオブジェクト API 名の配列を返す', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      expect(result.objects).toEqual(['Account', 'Opportunity']);
    });

    test('.getFields(objectName) で項目 API 名の配列を返す', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      expect(result.getFields('Account')).toEqual(['Name', 'Phone']);
      expect(result.getFields('Opportunity')).toEqual(['Name', 'StageName']);
    });

    test('.getFields に存在しないオブジェクト名を渡すと空配列を返す', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      expect(result.getFields('NonExistent')).toEqual([]);
    });

    test('.formatForPrompt() でLLM用の文字列を返す', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      const prompt = result.formatForPrompt();
      expect(typeof prompt).toBe('string');
      expect(prompt).toContain('Account');
      expect(prompt).toContain('取引先');
      expect(prompt).toContain('Opportunity');
      expect(prompt).toContain('商談');
      expect(prompt).toContain('Name');
    });

    test('.formatForPrompt() で picklist の選択肢を含む', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      const prompt = result.formatForPrompt();
      expect(prompt).toContain('Prospecting');
    });

    test('.formatForPrompt() で required 項目に required を表示する', () => {
      const result = metadata.buildMetadataResult(sampleObjects);
      const prompt = result.formatForPrompt();
      expect(prompt).toContain('required');
    });

    test('空のオブジェクト配列を渡すと objects が空になる', () => {
      const result = metadata.buildMetadataResult([]);
      expect(result.objects).toEqual([]);
      expect(result.formatForPrompt()).toBe('');
    });
  });

  // ──────────────────────────────────────────
  // fetchTabsObjects
  // ──────────────────────────────────────────
  describe('fetchTabsObjects', () => {
    test('tabs エンドポイントから sobjectName の配列を返す', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockTabsResponse,
      });

      const result = await metadata.fetchTabsObjects(INSTANCE_URL, ACCESS_TOKEN);

      expect(global.fetch).toHaveBeenCalledWith(
        `${INSTANCE_URL}/services/data/v59.0/tabs`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        })
      );
      expect(result).toContain('Account');
      expect(result).toContain('Opportunity');
      expect(result).toContain('Contact');
    });

    test('sobjectName がない tab はスキップする', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tabs: [
            { name: 'custom-tab', label: 'カスタム' }, // sobjectName なし
            { name: 'standard-account', sobjectName: 'Account' },
          ],
        }),
      });

      const result = await metadata.fetchTabsObjects(INSTANCE_URL, ACCESS_TOKEN);
      expect(result).toEqual(['Account']);
    });

    test('重複した sobjectName は除外する', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => ({
          tabs: [
            { name: 'tab1', sobjectName: 'Account' },
            { name: 'tab2', sobjectName: 'Account' },
          ],
        }),
      });

      const result = await metadata.fetchTabsObjects(INSTANCE_URL, ACCESS_TOKEN);
      expect(result.filter((n) => n === 'Account')).toHaveLength(1);
    });

    test('API が失敗したらエラーをスローする', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 401 });
      await expect(
        metadata.fetchTabsObjects(INSTANCE_URL, ACCESS_TOKEN)
      ).rejects.toThrow('Failed to fetch tabs');
    });
  });

  // ──────────────────────────────────────────
  // fetchObjectDescribe
  // ──────────────────────────────────────────
  describe('fetchObjectDescribe', () => {
    test('describe エンドポイントを呼び出して結果を返す', async () => {
      global.fetch.mockResolvedValueOnce({
        ok: true,
        json: async () => mockAccountDescribe,
      });

      const result = await metadata.fetchObjectDescribe(INSTANCE_URL, ACCESS_TOKEN, 'Account');

      expect(global.fetch).toHaveBeenCalledWith(
        `${INSTANCE_URL}/services/data/v59.0/sobjects/Account/describe`,
        expect.objectContaining({
          headers: expect.objectContaining({
            Authorization: `Bearer ${ACCESS_TOKEN}`,
          }),
        })
      );
      expect(result.name).toBe('Account');
      expect(result.label).toBe('取引先');
    });

    test('API が失敗したらエラーをスローする', async () => {
      global.fetch.mockResolvedValueOnce({ ok: false, status: 404 });
      await expect(
        metadata.fetchObjectDescribe(INSTANCE_URL, ACCESS_TOKEN, 'NonExistent')
      ).rejects.toThrow('Failed to describe NonExistent');
    });
  });

  // ──────────────────────────────────────────
  // fetchAndCacheMetadata
  // ──────────────────────────────────────────
  describe('fetchAndCacheMetadata', () => {
    test('tabs と describe を呼び出し、chrome.storage.local にキャッシュする', async () => {
      // tabs → Account describe → Opportunity describe の順で返す
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tabs: [
          { sobjectName: 'Account' },
          { sobjectName: 'Opportunity' },
        ]}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockAccountDescribe })
        .mockResolvedValueOnce({ ok: true, json: async () => mockOpportunityDescribe });

      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const result = await metadata.fetchAndCacheMetadata(INSTANCE_URL, ACCESS_TOKEN);

      expect(chrome.storage.local.set).toHaveBeenCalledWith(
        expect.objectContaining({
          sf_metadata_cache: expect.objectContaining({
            cachedAt: expect.any(Number),
            data: expect.any(Array),
          }),
        }),
        expect.any(Function)
      );
      expect(result.objects).toContain('Account');
      expect(result.objects).toContain('Opportunity');
    });

    test('個別オブジェクトの describe に失敗してもスキップして続行する', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tabs: [
          { sobjectName: 'Account' },
          { sobjectName: 'BrokenObject' },
        ]}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockAccountDescribe })
        .mockResolvedValueOnce({ ok: false, status: 403 }); // BrokenObject は失敗

      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const result = await metadata.fetchAndCacheMetadata(INSTANCE_URL, ACCESS_TOKEN);
      expect(result.objects).toContain('Account');
      expect(result.objects).not.toContain('BrokenObject');
    });

    test('取得した項目がフィルタされている', async () => {
      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tabs: [
          { sobjectName: 'Account' },
        ]}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockAccountDescribe });

      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const result = await metadata.fetchAndCacheMetadata(INSTANCE_URL, ACCESS_TOKEN);
      const fields = result.getFields('Account');
      expect(fields).toContain('Name');
      expect(fields).toContain('Phone');
      expect(fields).not.toContain('Id');
      expect(fields).not.toContain('CreatedDate');
    });
  });

  // ──────────────────────────────────────────
  // getMetadata
  // ──────────────────────────────────────────
  describe('getMetadata', () => {
    test('新鮮なキャッシュが存在する場合は fetch を呼ばずに返す', async () => {
      const cachedAt = Date.now() - 60 * 60 * 1000; // 1時間前（fresh）
      const cachedData = [
        {
          name: 'Account',
          label: '取引先',
          fields: [
            { name: 'Name', label: '取引先名', type: 'string', nillable: false, picklistValues: [] },
          ],
        },
      ];

      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({ sf_metadata_cache: { cachedAt, data: cachedData } });
      });

      const result = await metadata.getMetadata(INSTANCE_URL, ACCESS_TOKEN);

      expect(global.fetch).not.toHaveBeenCalled();
      expect(result.objects).toContain('Account');
      expect(result.getFields('Account')).toContain('Name');
    });

    test('キャッシュが存在しない場合は fetch して返す', async () => {
      chrome.storage.local.get.mockImplementationOnce((keys, cb) => cb({}));

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tabs: [
          { sobjectName: 'Account' },
        ]}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockAccountDescribe });

      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const result = await metadata.getMetadata(INSTANCE_URL, ACCESS_TOKEN);

      expect(global.fetch).toHaveBeenCalled();
      expect(result.objects).toContain('Account');
    });

    test('キャッシュが古い（stale）場合は再フェッチする', async () => {
      const staleAt = Date.now() - 2 * 24 * 60 * 60 * 1000; // 2日前
      const oldData = [{ name: 'OldObject', label: '旧', fields: [] }];

      chrome.storage.local.get.mockImplementationOnce((keys, cb) => {
        cb({ sf_metadata_cache: { cachedAt: staleAt, data: oldData } });
      });

      global.fetch
        .mockResolvedValueOnce({ ok: true, json: async () => ({ tabs: [
          { sobjectName: 'Account' },
        ]}) })
        .mockResolvedValueOnce({ ok: true, json: async () => mockAccountDescribe });

      chrome.storage.local.set.mockImplementationOnce((items, cb) => cb());

      const result = await metadata.getMetadata(INSTANCE_URL, ACCESS_TOKEN);

      expect(global.fetch).toHaveBeenCalled();
      expect(result.objects).toContain('Account');
      expect(result.objects).not.toContain('OldObject');
    });
  });
});
