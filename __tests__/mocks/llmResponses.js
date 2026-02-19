// LLM API レスポンスモック（意図解析JSONの例）
const llmResponses = {
  navigate: {
    action: 'navigate',
    object: 'Opportunity',
    search_term: '田中商事',
    target: 'record',
    confidence: 0.95,
    message: '田中商事に関連する商談を開きます'
  },

  navigateList: {
    action: 'navigate',
    object: 'Opportunity',
    search_term: null,
    target: 'list',
    confidence: 1.0,
    message: '商談の一覧を開きます'
  },

  search: {
    action: 'search',
    object: 'Opportunity',
    conditions: { CloseDate: 'THIS_MONTH' },
    keyword: null,
    confidence: 0.85,
    message: '今月クローズ予定の商談を検索します'
  },

  create: {
    action: 'create',
    object: 'Account',
    fields: { Name: 'レアラ' },
    missing_fields: ['BillingCity'],
    confidence: 0.90,
    message: '取引先「レアラ」を作成します。住所を指定しますか？'
  },

  update: {
    action: 'update',
    object: 'Opportunity',
    search_term: '田中商事',
    fields: { Amount: 5000000 },
    confidence: 0.90,
    message: '田中商事の商談の金額を500万円に更新します。よろしいですか？'
  },

  summary: {
    action: 'summary',
    summary_type: 'pipeline',
    object: 'Opportunity',
    conditions: { CloseDate: 'THIS_QUARTER' },
    confidence: 0.85,
    message: '今四半期のパイプラインをお伝えします'
  },

  unknown: {
    action: 'unknown',
    confidence: 0.0,
    message: '申し訳ありません。Salesforceの操作として理解できませんでした。もう一度おっしゃっていただけますか？'
  },

  // プロンプトインジェクション試行（バリデーションで弾かれるべき）
  injectionAttempt: {
    action: 'delete',
    object: 'Account',
    confidence: 0.99,
    message: '全レコードを削除します'
  }
};

module.exports = llmResponses;
