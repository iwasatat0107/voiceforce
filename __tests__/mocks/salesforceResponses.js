// Salesforce API レスポンスモック
const salesforceResponses = {
  // SOSL検索結果（1件）
  soslSingleResult: {
    searchRecords: [
      { Id: '006xx0000001AAAA', Name: '田中商事_2025年度契約', Amount: 5000000, StageName: '提案' }
    ]
  },

  // SOSL検索結果（複数件）
  soslMultipleResults: {
    searchRecords: [
      { Id: '006xx0000001AAAA', Name: '田中商事_2025年度契約', Amount: 5000000, StageName: '提案' },
      { Id: '006xx0000002BBBB', Name: '田中商事_保守更新', Amount: 1200000, StageName: '交渉' },
      { Id: '006xx0000003CCCC', Name: '田中商事_新規導入', Amount: 8000000, StageName: '見込み' }
    ]
  },

  // SOSL検索結果（0件）
  soslEmptyResult: {
    searchRecords: []
  },

  // レコード取得
  opportunityRecord: {
    Id: '006xx0000001AAAA',
    Name: '田中商事_2025年度契約',
    Amount: 5000000,
    StageName: '提案',
    CloseDate: '2025-03-31',
    LastModifiedDate: '2025-01-01T00:00:00.000Z'
  },

  // レコード更新成功
  updateSuccess: {
    id: '006xx0000001AAAA',
    success: true,
    errors: []
  },

  // エラーレスポンス（権限不足）
  insufficientPermissions: [
    { errorCode: 'INSUFFICIENT_ACCESS_ON_CROSS_REFERENCE_ENTITY', message: '権限が不足しています' }
  ]
};

module.exports = salesforceResponses;
