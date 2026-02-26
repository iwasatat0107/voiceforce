'use strict';

const salesforceApi = require('../../lib/salesforceApi');
const mockResponses = require('../mocks/salesforceResponses');

const INSTANCE_URL = 'https://example.salesforce.com';
const ACCESS_TOKEN = 'test_access_token_xxx';
const API_VERSION = 'v59.0';

global.fetch = jest.fn();

function mockFetchOk(body, status = 200) {
  global.fetch.mockResolvedValueOnce({ ok: true, status, json: async () => body });
}

function mockFetch204() {
  global.fetch.mockResolvedValueOnce({ ok: true, status: 204, json: async () => null });
}

function mockFetchError(status, body = []) {
  global.fetch.mockResolvedValueOnce({ ok: false, status, json: async () => body });
}

beforeEach(() => { global.fetch.mockClear(); });

describe('SalesforceApi', () => {

  describe('sosl - SOSL全文検索', () => {
    test('正常: 検索結果レコードを返す', async () => {
      mockFetchOk({ searchRecords: mockResponses.soslSingleResult.searchRecords });

      const results = await salesforceApi.sosl(INSTANCE_URL, ACCESS_TOKEN, '田中商事', 'Opportunity', ['Id', 'Name', 'Amount']);

      expect(global.fetch).toHaveBeenCalledTimes(1);
      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain(`/services/data/${API_VERSION}/search/`);
      expect(decodeURIComponent(url)).toContain('Opportunity(Id, Name, Amount)');
      expect(decodeURIComponent(url)).toContain('FIND {田中商事}');
      expect(options.method).toBe('GET');
      expect(options.headers['Authorization']).toBe(`Bearer ${ACCESS_TOKEN}`);
      expect(results).toHaveLength(1);
      expect(results[0].Name).toBe('田中商事_2025年度契約');
    });

    test('正常: 0件の場合は空配列を返す', async () => {
      mockFetchOk({ searchRecords: [] });
      const results = await salesforceApi.sosl(INSTANCE_URL, ACCESS_TOKEN, '存在しない', 'Opportunity');
      expect(results).toEqual([]);
    });

    test('正常: fields省略時は [Id, Name] をデフォルト使用', async () => {
      mockFetchOk({ searchRecords: [] });
      await salesforceApi.sosl(INSTANCE_URL, ACCESS_TOKEN, 'test', 'Account');
      const [url] = global.fetch.mock.calls[0];
      expect(decodeURIComponent(url)).toContain('Account(Id, Name)');
    });

    test('SOSL特殊文字をエスケープする', async () => {
      mockFetchOk({ searchRecords: [] });
      await salesforceApi.sosl(INSTANCE_URL, ACCESS_TOKEN, '田中&商事', 'Account');
      const [url] = global.fetch.mock.calls[0];
      expect(decodeURIComponent(url)).toContain('田中\\&商事');
    });

    test('searchRecordsキーがない場合は空配列を返す', async () => {
      mockFetchOk({});
      const results = await salesforceApi.sosl(INSTANCE_URL, ACCESS_TOKEN, 'test', 'Account');
      expect(results).toEqual([]);
    });
  });

  describe('stripCompanySuffix - 法人格除去', () => {
    test('suffix 株式会社 を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABC株式会社')).toBe('ABC');
    });

    test('prefix 株式会社 を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('株式会社ABC')).toBe('ABC');
    });

    test('有限会社 suffix を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('田中有限会社')).toBe('田中');
    });

    test('合同会社 suffix を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('テスト合同会社')).toBe('テスト');
    });

    test('ひらがな かぶしきがいしゃ を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABCかぶしきがいしゃ')).toBe('ABC');
    });

    test('ひらがな ゆうげんがいしゃ を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('田中ゆうげんがいしゃ')).toBe('田中');
    });

    test('（株） 略称を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABC（株）')).toBe('ABC');
    });

    test('(株) 略称を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABC(株)')).toBe('ABC');
    });

    test('㈱ 略称を除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABC㈱')).toBe('ABC');
    });

    test('法人格なし → そのまま返す', () => {
      expect(salesforceApi.stripCompanySuffix('テスト商事')).toBe('テスト商事');
    });

    test('全体が法人格のみ → 元の文字列を返す（空文字にしない）', () => {
      expect(salesforceApi.stripCompanySuffix('株式会社')).toBe('株式会社');
    });

    test('スペースを挟む suffix も除去する', () => {
      expect(salesforceApi.stripCompanySuffix('ABC 株式会社')).toBe('ABC');
    });
  });

  describe('hiraganaToKatakana / katakanaToHiragana — カナ変換', () => {
    test('ひらがな → カタカナ', () => {
      expect(salesforceApi.hiraganaToKatakana('てすと')).toBe('テスト');
    });
    test('カタカナ → ひらがな', () => {
      expect(salesforceApi.katakanaToHiragana('テスト')).toBe('てすと');
    });
    test('漢字は変換されない', () => {
      expect(salesforceApi.hiraganaToKatakana('田中てすと')).toBe('田中テスト');
    });
    test('混在文字列（ひらがな+カタカナ+漢字）', () => {
      expect(salesforceApi.hiraganaToKatakana('てすとテスト田中')).toBe('テストテスト田中');
      expect(salesforceApi.katakanaToHiragana('テストてすと田中')).toBe('てすとてすと田中');
    });
    test('変換対象なし（英字・漢字）→ そのまま返す', () => {
      expect(salesforceApi.hiraganaToKatakana('ABC株式会社')).toBe('ABC株式会社');
      expect(salesforceApi.katakanaToHiragana('ABC株式会社')).toBe('ABC株式会社');
    });
  });

  describe('soslFuzzy - 曖昧SOSL検索', () => {
    test('最初の検索でヒット → その結果を返す（fetch 1回のみ）', async () => {
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'ABC株式会社' }] });
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABC株式会社', 'Account');
      expect(results).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('suffix付きが0件 → suffix除去後でヒット（fetch 2回）', async () => {
      mockFetchOk({ searchRecords: [] });                                  // ABC株式会社 → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'ABC' }] });       // ABC → 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABC株式会社', 'Account');
      expect(results).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('ひらがな表記が0件 → suffix除去後でヒット', async () => {
      mockFetchOk({ searchRecords: [] });                                  // ABCかぶしきがいしゃ → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'ABC株式会社' }] }); // ABC → 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABCかぶしきがいしゃ', 'Account');
      expect(results).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('suffix なし・カナなしのキーワードはPhase1が1回、Phase2でワイルドカード1回（計2回）', async () => {
      mockFetchOk({ searchRecords: [] }); // Phase1: ABC商事 → 0件
      mockFetchOk({ searchRecords: [] }); // Phase2: ABC商事* → 0件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABC商事', 'Account');
      expect(results).toEqual([]);
      expect(global.fetch).toHaveBeenCalledTimes(2);
      // Phase2のクエリに * が含まれることを確認
      const [url2] = global.fetch.mock.calls[1];
      expect(decodeURIComponent(url2)).toContain('ABC商事*');
    });

    test('スペース区切りのキーワード → 最初のトークンでも検索', async () => {
      mockFetchOk({ searchRecords: [] });                                  // 田中 商事 → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: '田中商事' }] }); // 田中 → 1件（firstToken）
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, '田中 商事', 'Account');
      expect(results).toHaveLength(1);
      expect(global.fetch).toHaveBeenCalledTimes(2);
    });

    test('全試行で0件 → 空配列を返す', async () => {
      // Phase1: ABC株式会社, ABC の2回
      // Phase2: ABC株式会社*(9文字>=4, yes), ABC(3文字<4, skip) → 1回
      mockFetchOk({ searchRecords: [] }); // Phase1: ABC株式会社
      mockFetchOk({ searchRecords: [] }); // Phase1: ABC
      mockFetchOk({ searchRecords: [] }); // Phase2: ABC株式会社*
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABC株式会社', 'Account');
      expect(results).toEqual([]);
    });

    test('Phase2ワイルドカードでヒット（末尾1文字欠け: ABC株式会 → ABC株式会社）', async () => {
      // terms: ["ABC株式会"] (stripped同値, カナ変換なし, firstToken同値 → dedup1件)
      mockFetchOk({ searchRecords: [] });                                          // Phase1: ABC株式会 → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'ABC株式会社' }] });        // Phase2: ABC株式会* → 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'ABC株式会', 'Account');
      expect(results).toHaveLength(1);
      expect(results[0].Name).toBe('ABC株式会社');
      // Phase2のクエリに * が含まれることを確認
      const [url2] = global.fetch.mock.calls[1];
      expect(decodeURIComponent(url2)).toContain('ABC株式会*');
    });

    test('3文字以下のキーワードはPhase2ワイルドカードをスキップする', async () => {
      mockFetchOk({ searchRecords: [] }); // Phase1のみ
      await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'abc', 'Account');
      expect(global.fetch).toHaveBeenCalledTimes(1); // Phase2はスキップ(3<4)
    });

    test('ひらがな入力 → カタカナ変換後でヒット（てすと電機→テスト電機）', async () => {
      // unique terms: [てすと電機, テスト電機]（stripped/k2h/firstToken は重複除去）
      mockFetchOk({ searchRecords: [] });                                          // 1. てすと電機 → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'テスト電機' }] });         // 2. テスト電機 → 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'てすと電機', 'Account');
      expect(results).toHaveLength(1);
      expect(results[0].Name).toBe('テスト電機');
    });

    test('カタカナ入力 → ひらがな変換後でヒット', async () => {
      mockFetchOk({ searchRecords: [] });                                          // テスト商事 → 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'てすと商事' }] });         // てすと商事 → 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'テスト商事', 'Account');
      expect(results).toHaveLength(1);
    });

    test('法人格除去後にカナ変換してヒット（てすとかぶしきがいしゃ → テスト）', async () => {
      // unique terms: [てすとかぶしきがいしゃ, てすと, テストカブシキガイシャ, テスト]
      mockFetchOk({ searchRecords: [] });   // 1. てすとかぶしきがいしゃ → 0件
      mockFetchOk({ searchRecords: [] });   // 2. てすと（suffix除去）→ 0件
      mockFetchOk({ searchRecords: [] });   // 3. テストカブシキガイシャ（h2k全体）→ 0件
      mockFetchOk({ searchRecords: [{ Id: '001', Name: 'テスト' }] }); // 4. テスト（h2k stripped）→ 1件
      const results = await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'てすとかぶしきがいしゃ', 'Account');
      expect(results).toHaveLength(1);
    });

    test('重複する変換は 1回のみ検索される（英字のみキーワード）', async () => {
      mockFetchOk({ searchRecords: [] });
      await salesforceApi.soslFuzzy(INSTANCE_URL, ACCESS_TOKEN, 'abc', 'Account');
      expect(global.fetch).toHaveBeenCalledTimes(1); // 重複除去で1回のみ
    });
  });

  describe('soql - SOQLクエリ実行', () => {
    test('正常: クエリ結果レコードを返す', async () => {
      const records = [{ Id: '001xxx', Name: '田中商事' }];
      mockFetchOk({ records, done: true, totalSize: 1 });

      const query = "SELECT Id, Name FROM Account WHERE Name LIKE '%田中%' LIMIT 10";
      const results = await salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, query);

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain(`/services/data/${API_VERSION}/query/`);
      expect(decodeURIComponent(url)).toContain(query);
      expect(options.method).toBe('GET');
      expect(results).toEqual(records);
    });

    test('正常: 0件の場合は空配列を返す', async () => {
      mockFetchOk({ records: [], done: true, totalSize: 0 });
      const results = await salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account LIMIT 1');
      expect(results).toEqual([]);
    });

    test('recordsキーがない場合は空配列を返す', async () => {
      mockFetchOk({});
      const results = await salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account');
      expect(results).toEqual([]);
    });
  });

  describe('getRecord - レコード取得', () => {
    test('正常: レコードを返す', async () => {
      mockFetchOk(mockResponses.opportunityRecord);
      const record = await salesforceApi.getRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA');

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('/sobjects/Opportunity/006xx0000001AAAA');
      expect(options.method).toBe('GET');
      expect(record.Name).toBe('田中商事_2025年度契約');
      expect(record.Amount).toBe(5000000);
    });

    test('正常: fields指定時はURLクエリパラメータに含まれる', async () => {
      mockFetchOk(mockResponses.opportunityRecord);
      await salesforceApi.getRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA', ['Id', 'Name', 'Amount']);
      const [url] = global.fetch.mock.calls[0];
      expect(url).toContain('fields=Id,Name,Amount');
    });

    test('正常: fields未指定時はクエリパラメータなし', async () => {
      mockFetchOk(mockResponses.opportunityRecord);
      await salesforceApi.getRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA');
      const [url] = global.fetch.mock.calls[0];
      expect(url).not.toContain('fields=');
    });
  });

  describe('createRecord - レコード作成', () => {
    test('正常: 作成レスポンスを返す', async () => {
      const createResponse = { id: '001newxxx', success: true, errors: [] };
      mockFetchOk(createResponse, 201);

      const result = await salesforceApi.createRecord(INSTANCE_URL, ACCESS_TOKEN, 'Account', { Name: 'テスト取引先', Phone: '03-0000-0000' });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain(`/services/data/${API_VERSION}/sobjects/Account`);
      expect(options.method).toBe('POST');
      const body = JSON.parse(options.body);
      expect(body.Name).toBe('テスト取引先');
      expect(result.success).toBe(true);
      expect(result.id).toBe('001newxxx');
    });
  });

  describe('updateRecord - レコード更新', () => {
    test('正常: 204を受け取り { success: true } を返す', async () => {
      mockFetch204();
      const result = await salesforceApi.updateRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA', { Amount: 8000000 });

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('/sobjects/Opportunity/006xx0000001AAAA');
      expect(options.method).toBe('PATCH');
      expect(JSON.parse(options.body).Amount).toBe(8000000);
      expect(result).toEqual({ success: true });
    });

    test('競合検知あり: LastModifiedDate が一致する場合は更新する', async () => {
      mockFetchOk({ LastModifiedDate: '2025-01-01T00:00:00.000Z' });
      mockFetch204();

      const result = await salesforceApi.updateRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA', { Amount: 8000000 }, '2025-01-01T00:00:00.000Z');

      expect(global.fetch).toHaveBeenCalledTimes(2);
      expect(result).toEqual({ success: true });
    });

    test('競合検知あり: LastModifiedDate が不一致の場合は CONFLICT エラー', async () => {
      mockFetchOk({ LastModifiedDate: '2025-06-01T12:00:00.000Z' });

      await expect(
        salesforceApi.updateRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA', { Amount: 8000000 }, '2025-01-01T00:00:00.000Z')
      ).rejects.toMatchObject({ code: 'CONFLICT', currentLastModifiedDate: '2025-06-01T12:00:00.000Z' });
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });

    test('競合検知なし: expectedLastModifiedDate が null の場合は getRecord をスキップ', async () => {
      mockFetch204();
      await salesforceApi.updateRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xx0000001AAAA', { Amount: 8000000 }, null);
      expect(global.fetch).toHaveBeenCalledTimes(1);
    });
  });

  describe('deleteRecord - レコード削除', () => {
    test('正常: 204を受け取り { success: true } を返す', async () => {
      mockFetch204();
      const result = await salesforceApi.deleteRecord(INSTANCE_URL, ACCESS_TOKEN, 'Account', '001xxx');

      const [url, options] = global.fetch.mock.calls[0];
      expect(url).toContain('/sobjects/Account/001xxx');
      expect(options.method).toBe('DELETE');
      expect(result).toEqual({ success: true });
    });
  });

  describe('エラーハンドリング', () => {
    test('401 → TOKEN_EXPIRED エラー', async () => {
      mockFetchError(401);
      await expect(salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account LIMIT 1')).rejects.toMatchObject({ code: 'TOKEN_EXPIRED' });
    });

    test('403 → PERMISSION_DENIED エラー（sfErrorCodeも設定）', async () => {
      mockFetchError(403, mockResponses.insufficientPermissions);
      await expect(salesforceApi.getRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006xxx')).rejects.toMatchObject({ code: 'PERMISSION_DENIED', sfErrorCode: 'INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY' });
    });

    test('404 → NOT_FOUND エラー', async () => {
      mockFetchError(404);
      await expect(salesforceApi.getRecord(INSTANCE_URL, ACCESS_TOKEN, 'Opportunity', '006notexist')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    test('429 → RATE_LIMITED エラー', async () => {
      mockFetchError(429);
      await expect(salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account LIMIT 1')).rejects.toMatchObject({ code: 'RATE_LIMITED' });
    });

    test('500 → SERVER_ERROR エラー', async () => {
      mockFetchError(500);
      await expect(salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account LIMIT 1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    });

    test('503 → SERVER_ERROR エラー', async () => {
      mockFetchError(503);
      await expect(salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account LIMIT 1')).rejects.toMatchObject({ code: 'SERVER_ERROR' });
    });

    test('400 バリデーションエラー → sfErrorCode が設定される', async () => {
      mockFetchError(400, [{ errorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION', message: '必須項目が未入力です' }]);
      await expect(salesforceApi.createRecord(INSTANCE_URL, ACCESS_TOKEN, 'Account', { Phone: '03-0000-0000' })).rejects.toMatchObject({ sfErrorCode: 'FIELD_CUSTOM_VALIDATION_EXCEPTION' });
    });
  });

  describe('リクエストヘッダー', () => {
    test('Authorization ヘッダーが Bearer トークンで設定される', async () => {
      mockFetchOk({ records: [] });
      await salesforceApi.soql(INSTANCE_URL, 'my_token_xyz', 'SELECT Id FROM Account');
      expect(global.fetch.mock.calls[0][1].headers['Authorization']).toBe('Bearer my_token_xyz');
    });

    test('Content-Type が application/json に設定される', async () => {
      mockFetchOk({ records: [] });
      await salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account');
      expect(global.fetch.mock.calls[0][1].headers['Content-Type']).toBe('application/json');
    });

    test('Accept が application/json に設定される', async () => {
      mockFetchOk({ records: [] });
      await salesforceApi.soql(INSTANCE_URL, ACCESS_TOKEN, 'SELECT Id FROM Account');
      expect(global.fetch.mock.calls[0][1].headers['Accept']).toBe('application/json');
    });
  });

  describe('SF_ERROR_CODES エクスポート', () => {
    test('主要エラーコードが定義されている', () => {
      expect(salesforceApi.SF_ERROR_CODES.TOKEN_EXPIRED).toBe('TOKEN_EXPIRED');
      expect(salesforceApi.SF_ERROR_CODES.PERMISSION_DENIED).toBe('PERMISSION_DENIED');
      expect(salesforceApi.SF_ERROR_CODES.RATE_LIMITED).toBe('RATE_LIMITED');
      expect(salesforceApi.SF_ERROR_CODES.CONFLICT).toBe('CONFLICT');
      expect(salesforceApi.SF_ERROR_CODES.NOT_FOUND).toBe('NOT_FOUND');
      expect(salesforceApi.SF_ERROR_CODES.SERVER_ERROR).toBe('SERVER_ERROR');
    });
  });
});
