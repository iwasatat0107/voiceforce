'use strict';

const { createUndoStack }                   = require('../../lib/undoStack');
const { updateRecord, getRecord, SF_ERROR_CODES } = require('../../lib/salesforceApi');

// ---------------------------------------------------------------------------
// 共通定数
// ---------------------------------------------------------------------------
const INSTANCE_URL = 'https://test.salesforce.com';
const ACCESS_TOKEN = 'test-token';
const OBJECT_NAME  = 'Opportunity';
const RECORD_ID    = 'opp001';

// ---------------------------------------------------------------------------
// fetch モックヘルパー
// ---------------------------------------------------------------------------
function mockFetchOk(body) {
  global.fetch.mockResolvedValueOnce({
    ok:     true,
    status: 200,
    json:   async () => body,
  });
}

function mockFetchNoContent() {
  global.fetch.mockResolvedValueOnce({
    ok:     true,
    status: 204,
    json:   async () => ({}),
  });
}

function mockFetchError(status, body) {
  global.fetch.mockResolvedValueOnce({
    ok:     false,
    status,
    json:   async () => body || [{ errorCode: 'UNKNOWN', message: 'error' }],
  });
}

// ---------------------------------------------------------------------------
// セットアップ / ティアダウン
// ---------------------------------------------------------------------------
beforeEach(() => {
  global.fetch = jest.fn();
});

afterEach(() => {
  jest.resetAllMocks();
});

// ===========================================================================
// 更新安全フロー統合テスト
// ===========================================================================
describe('更新安全フロー統合テスト', () => {

  // ── 更新 → undo フロー ──────────────────────────────────────────────
  describe('更新 → undo フロー', () => {
    test('getRecord で前の値を取得し undoStack に push できる', async () => {
      const undoStack = createUndoStack();
      mockFetchOk({ Amount: 3000000, LastModifiedDate: '2026-01-01T00:00:00.000Z' });

      const record = await getRecord(
        INSTANCE_URL, ACCESS_TOKEN, OBJECT_NAME, RECORD_ID, ['Amount', 'LastModifiedDate']
      );

      undoStack.push({
        objectName:     OBJECT_NAME,
        recordId:       RECORD_ID,
        previousFields: { Amount: record.Amount },
        updatedFields:  { Amount: 5000000 },
        timestamp:      Date.now(),
      });

      expect(undoStack.size()).toBe(1);
      expect(undoStack.peek().previousFields.Amount).toBe(3000000);
    });

    test('undo: pop → updateRecord で以前の値に戻せる', async () => {
      const undoStack = createUndoStack();
      undoStack.push({
        objectName:     OBJECT_NAME,
        recordId:       RECORD_ID,
        previousFields: { Amount: 3000000 },
        updatedFields:  { Amount: 5000000 },
        timestamp:      Date.now(),
      });

      mockFetchNoContent();
      const entry  = undoStack.pop();
      const result = await updateRecord(
        INSTANCE_URL, ACCESS_TOKEN, entry.objectName, entry.recordId, entry.previousFields
      );

      expect(result).toEqual({ success: true });
      expect(undoStack.isEmpty()).toBe(true);
    });

    test('複数回更新後、LIFO 順に undo できる', () => {
      const undoStack = createUndoStack();
      undoStack.push({
        objectName: OBJECT_NAME, recordId: 'opp001',
        previousFields: { Amount: 1000000 }, updatedFields: { Amount: 2000000 }, timestamp: 1,
      });
      undoStack.push({
        objectName: OBJECT_NAME, recordId: 'opp002',
        previousFields: { Amount: 3000000 }, updatedFields: { Amount: 4000000 }, timestamp: 2,
      });

      expect(undoStack.pop().recordId).toBe('opp002');
      expect(undoStack.pop().recordId).toBe('opp001');
      expect(undoStack.pop()).toBeNull();
    });
  });

  // ── LastModifiedDate 競合検知 ───────────────────────────────────────────
  describe('LastModifiedDate 競合検知', () => {
    test('LastModifiedDate が一致すれば更新成功', async () => {
      const lmd = '2026-01-01T00:00:00.000Z';
      mockFetchOk({ LastModifiedDate: lmd });   // getRecord (競合チェック用)
      mockFetchNoContent();                      // updateRecord 本体

      const result = await updateRecord(
        INSTANCE_URL, ACCESS_TOKEN, OBJECT_NAME, RECORD_ID,
        { Amount: 5000000 }, lmd
      );
      expect(result).toEqual({ success: true });
    });

    test('LastModifiedDate が不一致なら CONFLICT エラーをスロー', async () => {
      mockFetchOk({ LastModifiedDate: '2026-02-01T00:00:00.000Z' });

      await expect(
        updateRecord(
          INSTANCE_URL, ACCESS_TOKEN, OBJECT_NAME, RECORD_ID,
          { Amount: 5000000 }, '2026-01-01T00:00:00.000Z'
        )
      ).rejects.toMatchObject({ code: SF_ERROR_CODES.CONFLICT });
    });

    test('競合エラーに currentLastModifiedDate が含まれる', async () => {
      mockFetchOk({ LastModifiedDate: '2026-02-01T00:00:00.000Z' });

      let thrownError;
      try {
        await updateRecord(
          INSTANCE_URL, ACCESS_TOKEN, OBJECT_NAME, RECORD_ID,
          { Amount: 5000000 }, '2026-01-01T00:00:00.000Z'
        );
      } catch (e) {
        thrownError = e;
      }
      expect(thrownError.currentLastModifiedDate).toBe('2026-02-01T00:00:00.000Z');
    });

    test('expectedLastModifiedDate なしなら競合チェックをスキップ', async () => {
      mockFetchNoContent();
      const result = await updateRecord(
        INSTANCE_URL, ACCESS_TOKEN, OBJECT_NAME, RECORD_ID, { Amount: 5000000 }
      );
      expect(result).toEqual({ success: true });
      expect(global.fetch).toHaveBeenCalledTimes(1); // getRecord なし
    });
  });

  // ── undoStack 上限 ──────────────────────────────────────────────────
  describe('undoStack 上限（10件）', () => {
    test('11件更新しても undoStack は 10件だけ保持する', () => {
      const undoStack = createUndoStack();
      for (let i = 0; i < 11; i++) {
        undoStack.push({
          objectName: OBJECT_NAME, recordId: `opp${i}`,
          previousFields: { Amount: i * 1000000 },
          updatedFields:  { Amount: (i + 1) * 1000000 },
          timestamp: i,
        });
      }
      expect(undoStack.size()).toBe(10);
    });

    test('11回 undo すると 10回目以降は null が返る', () => {
      const undoStack = createUndoStack();
      for (let i = 0; i < 11; i++) {
        undoStack.push({
          objectName: OBJECT_NAME, recordId: `opp${i}`,
          previousFields: { Amount: i * 1000000 },
          updatedFields:  { Amount: (i + 1) * 1000000 },
          timestamp: i,
        });
      }
      for (let i = 0; i < 10; i++) undoStack.pop();
      expect(undoStack.pop()).toBeNull();
    });
  });
});
