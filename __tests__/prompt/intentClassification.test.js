/**
 * @jest-environment node
 */
'use strict';

// __tests__/prompt/intentClassification.test.js
// LLMプロンプト精度テスト（CIでは除外・手動実行のみ）
//
// 実行: npm run test:prompt
// 目標: 50件中45件以上正解（正解率90%以上）
//
// 事前設定（環境変数）:
//   WORKER_URL   - Cloudflare WorkerのURL（必須）
//   TEST_USER_ID - テスト用ユーザーID（省略時: prompt-test-user）
//   TEST_METADATA - Salesforceメタデータ文字列（省略時: デフォルト値）

const { resolveIntent } = require('../../lib/intentResolver');

const WORKER_URL = process.env.WORKER_URL || '';
const USER_ID    = process.env.TEST_USER_ID || 'prompt-test-user';
const METADATA   = process.env.TEST_METADATA ||
  `オブジェクト一覧:
- Opportunity（商談）: Name, Amount, CloseDate, StageName, AccountId, OwnerId
- Account（取引先）: Name, BillingCity, Phone, Industry, Type
- Contact（取引先責任者）: FirstName, LastName, Email, Phone, AccountId
- Lead（リード）: FirstName, LastName, Company, Email, Phone, Status
- Task（タスク）: Subject, ActivityDate, Status, OwnerId
- Event（行動）: Subject, ActivityDateTime, EndDateTime, OwnerId`;

// ---------------------------------------------------------------------------
// テストケース（全50件）
// ---------------------------------------------------------------------------
const TEST_CASES = [
  // navigate（一覧） × 8
  { text: '商談',                                 expected: 'navigate' },
  { text: '商談の一覧',                           expected: 'navigate' },
  { text: '取引先を開いて',                        expected: 'navigate' },
  { text: '取引先責任者の一覧を見せて',             expected: 'navigate' },
  { text: 'リードリスト',                          expected: 'navigate' },
  { text: 'タスクを表示して',                      expected: 'navigate' },
  { text: '商談一覧を出して',                      expected: 'navigate' },
  { text: '取引先リストを開いて',                   expected: 'navigate' },

  // navigate（レコード） × 5
  { text: '田中商事の商談を開いて',                 expected: 'navigate' },
  { text: '山田太郎の取引先責任者を開いて',         expected: 'navigate' },
  { text: 'テスト株式会社の詳細を見せて',           expected: 'navigate' },
  { text: '鈴木花子の連絡先を開いて',              expected: 'navigate' },
  { text: 'ABCコーポレーションのレコードを開いて',  expected: 'navigate' },

  // search × 10
  { text: '今月クローズ予定の商談を検索して',        expected: 'search' },
  { text: '東京の取引先を探して',                   expected: 'search' },
  { text: '製造業の取引先を検索して',               expected: 'search' },
  { text: '未完了のタスクを見せて',                 expected: 'search' },
  { text: '今週の行動を検索して',                   expected: 'search' },
  { text: '金額が1000万円以上の商談を探して',        expected: 'search' },
  { text: '新規リードを検索して',                   expected: 'search' },
  { text: 'メールアドレスにgmailが含まれる取引先責任者を探して', expected: 'search' },
  { text: '今四半期クローズした商談を検索して',      expected: 'search' },
  { text: '山田が担当する商談を探して',             expected: 'search' },

  // create × 8
  { text: 'レアラという取引先を作成して',            expected: 'create' },
  { text: '田中商事で新しい商談を作成して',          expected: 'create' },
  { text: '山田太郎を取引先責任者として追加して',    expected: 'create' },
  { text: 'テストリードを新規作成して',             expected: 'create' },
  { text: '明日15時に田中商事との打ち合わせを登録して', expected: 'create' },
  { text: '新しいタスクを作成して期限は来週金曜',    expected: 'create' },
  { text: 'ABCコーポレーションという取引先を追加して', expected: 'create' },
  { text: '鈴木花子を新規リードとして登録して',      expected: 'create' },

  // update × 8
  { text: '田中商事の商談の金額を500万円に変更して', expected: 'update' },
  { text: '山田リードのメールアドレスを更新して',    expected: 'update' },
  { text: '商談ステージを成約に変更して',           expected: 'update' },
  { text: 'ABCの電話番号を0312345678に変えて',       expected: 'update' },
  { text: 'タスクの期限を明日に変更して',           expected: 'update' },
  { text: '田中商事のクローズ日を来月末にして',      expected: 'update' },
  { text: '鈴木さんの役職をマネージャーに更新して',  expected: 'update' },
  { text: '商談金額を1000万円に修正して',           expected: 'update' },

  // summary × 6
  { text: '今月のパイプラインを教えて',             expected: 'summary' },
  { text: '今四半期の売上見込みはいくら',           expected: 'summary' },
  { text: '今日のスケジュールを教えて',             expected: 'summary' },
  { text: '未完了タスクは何件ある',                 expected: 'summary' },
  { text: '最近の活動を要約して',                  expected: 'summary' },
  { text: '今月クローズした商談の合計金額を教えて',  expected: 'summary' },

  // unknown × 5
  { text: '今日の天気は',                          expected: 'unknown' },
  { text: 'ありがとう',                            expected: 'unknown' },
  { text: '明日ランチに行こう',                    expected: 'unknown' },
  { text: 'このメールを返信して',                   expected: 'unknown' },
  { text: 'Pythonのコードを書いて',                expected: 'unknown' },
];

// ---------------------------------------------------------------------------
// テスト実行
// ---------------------------------------------------------------------------
describe('LLMプロンプト精度テスト（手動実行のみ）', () => {
  let results = [];

  beforeAll(async () => {
    if (!WORKER_URL) {
      console.warn('WORKER_URL が未設定のためテストをスキップします');
      return;
    }

    for (const { text, expected } of TEST_CASES) {
      try {
        const result = await resolveIntent(text, METADATA, WORKER_URL, USER_ID);
        const correct = result.action === expected;
        results.push({ text, expected, actual: result.action, correct });
      } catch (e) {
        results.push({ text, expected, actual: 'error', correct: false, error: e.message });
      }
      // レートリミット対策（10件/分）
      await new Promise((resolve) => setTimeout(resolve, 6500));
    }
  }, 360000); // 6分タイムアウト

  afterAll(() => {
    if (!results.length) return;
    const correct = results.filter((r) => r.correct).length;
    const total   = results.length;
    const rate    = ((correct / total) * 100).toFixed(1);

    console.warn(`\n=== プロンプト精度テスト結果 ===`);
    console.warn(`正解率: ${correct}/${total} (${rate}%)`);
    console.warn(`目標: ${total}件中45件以上正解（90%以上）`);

    const incorrect = results.filter((r) => !r.correct);
    if (incorrect.length) {
      console.warn(`\n不正解一覧 (${incorrect.length}件):`);
      incorrect.forEach((r) => {
        console.warn(`  [${r.expected}→${r.actual}] "${r.text}"${
          r.error ? ` (error: ${r.error})` : ''
        }`);
      });
    }
  });

  test('WORKER_URL が設定されていること', () => {
    if (!WORKER_URL) {
      console.warn('WORKER_URL が未設定です。export WORKER_URL=https://your-worker.workers.dev を実行してください');
    }
    expect(WORKER_URL).toBeTruthy();
  });

  test('全体精度が90%以上（50件中45件以上正解）であること', () => {
    if (!WORKER_URL) return;
    const correct = results.filter((r) => r.correct).length;
    expect(correct).toBeGreaterThanOrEqual(45);
  });

  test('navigateアクションの精度が80%以上であること', () => {
    if (!WORKER_URL) return;
    const navCases   = results.filter((r) => r.expected === 'navigate');
    const navCorrect = navCases.filter((r) => r.correct).length;
    expect(navCorrect / navCases.length).toBeGreaterThanOrEqual(0.8);
  });

  test('searchアクションの精度が80%以上であること', () => {
    if (!WORKER_URL) return;
    const cases   = results.filter((r) => r.expected === 'search');
    const correct = cases.filter((r) => r.correct).length;
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.8);
  });

  test('createアクションの精度が80%以上であること', () => {
    if (!WORKER_URL) return;
    const cases   = results.filter((r) => r.expected === 'create');
    const correct = cases.filter((r) => r.correct).length;
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.8);
  });

  test('updateアクションの精度が80%以上であること', () => {
    if (!WORKER_URL) return;
    const cases   = results.filter((r) => r.expected === 'update');
    const correct = cases.filter((r) => r.correct).length;
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.8);
  });

  test('unknownアクション（Salesforce無関係の発話）を正しく弾けること', () => {
    if (!WORKER_URL) return;
    const cases   = results.filter((r) => r.expected === 'unknown');
    const correct = cases.filter((r) => r.correct).length;
    expect(correct / cases.length).toBeGreaterThanOrEqual(0.8);
  });
});
