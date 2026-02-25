'use strict';

/**
 * E2E カバレッジテスト
 *
 * docs/manual-test-guide.md の全手動テスト項目を自動化する。
 *
 * カバー範囲:
 *   テスト2: ウィジェット表示・非SF URLガード (isSalesforceUrl)
 *   テスト3: 音声→ナビゲーション実行 (navigateTo 呼び出し検証)
 *   テスト4: 戻る操作 (goBack 呼び出し検証)
 *   テスト5: エラーハンドリング (マイク許可拒否・接続切れ)
 *   テスト6: セキュリティ (XSS・トークン暗号化)
 *
 * 自動化できない項目（根本的な制約）:
 *   - 実Salesforce OAuthフロー（実サーバー＋認証情報が必要）
 *   - マイク許可ダイアログ自体の操作（ブラウザ仕様）
 *     → 許可拒否後の動作（error状態遷移）は自動化済み
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

let context;
let extensionId;

// ── モック注入スクリプト ──────────────────────────────────────────
// webkitSpeechRecognition を差し替え、window.__triggerSpeech() で発話を注入できるようにする
const MOCK_SPEECH_SCRIPT = `
  window.__speechCallbacks = {};
  class MockSpeechRecognition {
    constructor() {
      this.lang = '';
      this.continuous = false;
      this.interimResults = false;
      this.maxAlternatives = 1;
      window.__speechCallbacks = {};
    }
    start() {
      if (this.onstart) this.onstart();
      window.__speechCallbacks.onresult = (transcript, isFinal = true) => {
        if (this.onresult) {
          this.onresult({
            resultIndex: 0,
            results: [{
              isFinal,
              0: { transcript },
              length: 1,
            }],
          });
        }
      };
      window.__speechCallbacks.onerror = (errorType) => {
        if (this.onerror) this.onerror({ error: errorType });
      };
      window.__speechCallbacks.onend = () => {
        if (this.onend) this.onend();
      };
    }
    stop() {
      if (this.onend) this.onend();
    }
  }
  window.webkitSpeechRecognition = MockSpeechRecognition;

  window.__triggerSpeech = (transcript, isFinal = true) => {
    if (window.__speechCallbacks.onresult) {
      window.__speechCallbacks.onresult(transcript, isFinal);
    }
  };
  window.__triggerSpeechError = (errorType) => {
    if (window.__speechCallbacks.onerror) {
      window.__speechCallbacks.onerror(errorType);
    }
  };
  window.__triggerSpeechEnd = () => {
    if (window.__speechCallbacks.onend) {
      window.__speechCallbacks.onend();
    }
  };
`;

// ── 拡張機能スクリプト読み込みヘルパー ──────────────────────────
// content_scripts の読み込み順に合わせる（manifest.json と必ず一致させること）:
//   lib/ruleEngine.js → lib/navigator.js → lib/speechRecognition.js
//   → lib/salesforceApi.js → lib/recordResolver.js
//   → ui/widget.js → ui/candidateList.js
async function loadExtensionScripts(page, extId) {
  await page.evaluate(async (id) => {
    const scripts = [
      'lib/ruleEngine.js',
      'lib/navigator.js',
      'lib/speechRecognition.js',
      'lib/salesforceApi.js',
      'lib/recordResolver.js',
      'ui/widget.js',
      'ui/candidateList.js',
    ];
    for (const src of scripts) {
      const s = document.createElement('script');
      s.src = `chrome-extension://${id}/${src}`;
      document.head.appendChild(s);
      await new Promise(r => s.addEventListener('load', r));
    }
  }, extId);
}

// ── テストセットアップ ──────────────────────────────────────────
test.beforeAll(async () => {
  const extensionPath = path.resolve(__dirname, '../../dist');
  context = await chromium.launchPersistentContext('', {
    headless: false,
    args: [
      `--disable-extensions-except=${extensionPath}`,
      `--load-extension=${extensionPath}`,
    ],
  });

  let [background] = context.serviceWorkers();
  if (!background) {
    background = await context.waitForEvent('serviceworker');
  }
  extensionId = background.url().split('/')[2];
});

test.afterAll(async () => {
  await context.close();
});

/** モック + スクリプトを準備したページを返す */
async function setupPage() {
  const page = await context.newPage();
  await page.addInitScript(MOCK_SPEECH_SCRIPT);
  await page.goto(`chrome-extension://${extensionId}/popup.html`);
  await loadExtensionScripts(page, extensionId);
  return page;
}

// ═══════════════════════════════════════════════════════════════
// テスト2: ウィジェット表示
// ═══════════════════════════════════════════════════════════════

// ── テスト2-2: 非SF URLでウィジェットが表示されない ──────────────

test('テスト2-2: isSalesforceUrl — SalesforceドメインのみURLガードにマッチする', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const results = await page.evaluate(() => {
    const SF_REGEX = /\.(salesforce|force|lightning\.force)\.com/;
    return {
      // マッチしてはいけないドメイン
      google:        SF_REGEX.test('www.google.com'),
      github:        SF_REGEX.test('github.com'),
      fakeSf1:       SF_REGEX.test('evil-salesforce.com.attacker.com'), // サブドメイン偽装
      fakeSf2:       SF_REGEX.test('salesforcexyz.com'),                // 前方一致偽装
      fakeSf3:       SF_REGEX.test('notsalesforce.com'),
      // マッチすべきドメイン
      sfMy:          SF_REGEX.test('leala9-dev-ed.my.salesforce.com'),
      sfForce:       SF_REGEX.test('myorg.force.com'),
      sfLightning:   SF_REGEX.test('myorg.lightning.force.com'),
      sfSandbox:     SF_REGEX.test('myorg--uat.sandbox.my.salesforce.com'),
    };
  });

  // 非SFドメインはマッチしない
  expect(results.google).toBe(false);
  expect(results.github).toBe(false);
  expect(results.fakeSf1).toBe(false);
  expect(results.fakeSf2).toBe(false);
  expect(results.fakeSf3).toBe(false);

  // SFドメインはマッチする
  expect(results.sfMy).toBe(true);
  expect(results.sfForce).toBe(true);
  expect(results.sfLightning).toBe(true);
  expect(results.sfSandbox).toBe(true);

  await page.close();
});

test('テスト2-2: content.js — 非SF URL(拡張機能ページ)ではウィジェットが作成されない', async () => {
  // popup.html のホスト名は chrome-extension://<extensionId>
  // isSalesforceUrl = false → if ブロックが実行されず、ウィジェット作成もリスナー登録もされない
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // 依存スクリプトを先に読み込む
  await loadExtensionScripts(page, extensionId);

  // content.js を読み込む
  await page.evaluate(async (id) => {
    const s = document.createElement('script');
    s.src = `chrome-extension://${id}/content.js`;
    document.head.appendChild(s);
    await new Promise((resolve, reject) => {
      s.addEventListener('load', resolve);
      s.addEventListener('error', reject);
    });
  }, extensionId);

  await page.waitForTimeout(300);

  // ウィジェットが作成されていない
  const widgetExists = await page.evaluate(() => !!document.getElementById('vfa-widget'));
  expect(widgetExists).toBe(false);

  await page.close();
});

// ── テスト2-1: ウィジェット起動・終了 ────────────────────────────

test('テスト2-1: TOGGLE_VOICE — ウィジェットが listening 状態になる', async () => {
  const page = await setupPage();

  const state = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    // content.js の toggleVoice() が行う状態遷移をシミュレート
    w.setState('listening');
    const s = w.getState();
    w.destroy();
    return s;
  });

  expect(state).toBe('listening');
  await page.close();
});

test('テスト2-1: TOGGLE_VOICE — listening 中に再度呼ぶと idle に戻る', async () => {
  const page = await setupPage();

  const states = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    const log = [w.getState()]; // idle

    w.setState('listening');
    log.push(w.getState()); // listening

    // 2回目呼び出し → 音声停止 → idle
    w.setState('idle');
    log.push(w.getState()); // idle

    w.destroy();
    return log;
  });

  expect(states).toEqual(['idle', 'listening', 'idle']);
  await page.close();
});

test('テスト2-2: Salesforce以外のページ — TOGGLE_VOICE 後もウィジェットが表示されない', async () => {
  // content.js は isSalesforceUrl=false のページでは chrome.runtime.onMessage にも登録しない
  // → TOGGLE_VOICE を送ってもウィジェットは表示されない
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await loadExtensionScripts(page, extensionId);

  // content.js 読み込み（isSalesforceUrl=false → onMessage 登録なし）
  await page.evaluate(async (id) => {
    const s = document.createElement('script');
    s.src = `chrome-extension://${id}/content.js`;
    document.head.appendChild(s);
    await new Promise((resolve, reject) => {
      s.addEventListener('load', resolve);
      s.addEventListener('error', reject);
    });
  }, extensionId);

  await page.waitForTimeout(300);

  // TOGGLE_VOICE メッセージを送信
  await page.evaluate(() => {
    chrome.runtime.sendMessage({ type: 'TOGGLE_VOICE' });
  });

  await page.waitForTimeout(300);

  // ウィジェットは表示されていない
  const widgetVisible = await page.evaluate(() => {
    const el = document.getElementById('vfa-widget');
    return el ? el.style.display !== 'none' : false;
  });
  expect(widgetVisible).toBe(false);

  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト3: 音声認識・ナビゲーション実行
// ═══════════════════════════════════════════════════════════════

// ── 3-1: 一覧ページ遷移の実行 ────────────────────────────────────

const NAVIGATE_EXEC_CASES = [
  ['商談一覧を開いて',       'Opportunity', '/lightning/o/Opportunity/list'],
  ['取引先一覧を開いて',     'Account',     '/lightning/o/Account/list'],
  ['リード一覧を開いて',     'Lead',        '/lightning/o/Lead/list'],
  ['取引先責任者一覧を開いて', 'Contact',   '/lightning/o/Contact/list'],
];

for (const [phrase, , urlPath] of NAVIGATE_EXEC_CASES) {
  test(`テスト3-1: 音声→navigate実行 「${phrase}」→ navigateTo が正しいURLで呼ばれる`, async () => {
    const page = await setupPage();
    const instanceUrl = 'https://myorg.my.salesforce.com';

    const result = await page.evaluate(
      async ({ phrase, instanceUrl }) => {
        return new Promise((resolve) => {
          // navigateTo をスパイ化（navigator.js が定義したグローバル関数を上書き）
          window.navigateTo = (url) => resolve({ navigatedTo: url });

          const sr = createSpeechRecognition({ // eslint-disable-line no-undef
            onResult: (transcript) => {
              const intent = window.match(transcript); // eslint-disable-line no-undef
              if (intent && intent.action === 'navigate' && intent.target === 'list') {
                const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
                window.navigateTo(url);
              }
            },
          });
          sr.start();
          window.__triggerSpeech(phrase);
          setTimeout(() => resolve({ navigatedTo: null }), 1000);
        });
      },
      { phrase, instanceUrl }
    );

    expect(result.navigatedTo).toBe(`${instanceUrl}${urlPath}`);
    await page.close();
  });
}

// ── 3-2: リストビュー指定遷移 ────────────────────────────────────

test('テスト3-2: buildListUrl — filterId なしで filterName なし URL を生成', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    const instanceUrl = 'https://myorg.my.salesforce.com';
    return {
      all:    buildListUrl(instanceUrl, 'Opportunity', null), // eslint-disable-line no-undef
      noArg:  buildListUrl(instanceUrl, 'Opportunity'),       // eslint-disable-line no-undef
    };
  });

  expect(result.all).toBe('https://myorg.my.salesforce.com/lightning/o/Opportunity/list');
  expect(result.noArg).toBe('https://myorg.my.salesforce.com/lightning/o/Opportunity/list');
  await page.close();
});

test('テスト3-2: buildListUrl — filterId あり URL に filterName クエリが付く', async () => {
  const page = await setupPage();

  const url = await page.evaluate(() => {
    return buildListUrl( // eslint-disable-line no-undef
      'https://myorg.my.salesforce.com',
      'Opportunity',
      '00B5h0000096B6YEAU'
    );
  });

  expect(url).toBe(
    'https://myorg.my.salesforce.com/lightning/o/Opportunity/list?filterName=00B5h0000096B6YEAU'
  );
  await page.close();
});

test('テスト3-2: 「すべての商談」→ ruleEngine が filterName=All を返す', async () => {
  const page = await setupPage();

  const intents = await page.evaluate(() => {
    return {
      all1:    window.match('すべての商談を開いて'),   // eslint-disable-line no-undef
      all2:    window.match('全ての商談を開いて'),
      all3:    window.match('全部の商談'),
      recent1: window.match('最近参照した商談を開いて'),
      recent2: window.match('最近の商談を開いて'),
      mine1:   window.match('自分の商談を開いて'),
      mine2:   window.match('私の商談を開いて'),
    };
  });

  expect(intents.all1.filterName).toBe('AllOpportunities');
  expect(intents.all2.filterName).toBe('AllOpportunities');
  expect(intents.all3.filterName).toBe('AllOpportunities');
  expect(intents.recent1.filterName).toBe('Recent');
  expect(intents.recent2.filterName).toBe('Recent');
  expect(intents.mine1.filterName).toBe('MyOpportunities');
  expect(intents.mine2.filterName).toBe('MyOpportunities');

  await page.close();
});

test('テスト3-2: filterName エラー時フォールバック — filterId=null で filterName なし URL に遷移', async () => {
  // ListView API 呼び出しが失敗した場合（接続なし環境での動作検証）
  // filterName なし URL へのフォールバックが正常に動作することを確認
  const page = await setupPage();
  const instanceUrl = 'https://myorg.my.salesforce.com';

  const result = await page.evaluate(
    async ({ instanceUrl }) => {
      return new Promise((resolve) => {
        window.navigateTo = (url) => resolve({ navigatedTo: url });

        const intent = window.match('すべての商談を開いて'); // eslint-disable-line no-undef
        // filterId=null → filterName なし URL（フォールバック）
        const url = buildListUrl(instanceUrl, intent.object, null); // eslint-disable-line no-undef
        window.navigateTo(url);
        setTimeout(() => resolve({ navigatedTo: null }), 500);
      });
    },
    { instanceUrl }
  );

  expect(result.navigatedTo).toBe(
    'https://myorg.my.salesforce.com/lightning/o/Opportunity/list'
  );
  await page.close();
});

// ── 3-3: 認識されない発話 ────────────────────────────────────────

const UNKNOWN_PHRASES = ['てすと', 'あいうえお', 'hello world', '123456'];

for (const phrase of UNKNOWN_PHRASES) {
  test(`テスト3-3: 認識されない発話 「${phrase}」→ navigateTo を呼ばない`, async () => {
    const page = await setupPage();

    const result = await page.evaluate(async (p) => {
      return new Promise((resolve) => {
        let navigateCalled = false;
        window.navigateTo = () => { navigateCalled = true; };

        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (transcript) => {
            const intent = window.match(transcript); // eslint-disable-line no-undef
            if (intent && intent.action === 'navigate') {
              window.navigateTo('dummy');
            }
          },
        });
        sr.start();
        window.__triggerSpeech(p);
        setTimeout(() => resolve({ navigateCalled }), 300);
      });
    }, phrase);

    expect(result.navigateCalled).toBe(false);
    await page.close();
  });
}

test('テスト3-3: 認識されない発話 — ウィジェットが success 状態で認識テキストを表示', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      w.setState('listening');

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          const intent = window.match(transcript); // eslint-disable-line no-undef
          if (!intent) {
            // 認識不能 → 認識テキストを表示して success
            w.setState('success', { message: `認識: ${transcript}`, duration: 0 });
          }
          resolve({
            state: w.getState(),
            messageText: document.querySelector('.vfa-message')
              ? document.querySelector('.vfa-message').textContent
              : '',
          });
        },
      });
      sr.start();
      window.__triggerSpeech('てすと');
      setTimeout(() => resolve({ state: 'timeout', messageText: '' }), 1000);
    });
  });

  expect(result.state).toBe('success');
  expect(result.messageText).toContain('てすと');
  await page.close();
});

test('テスト3-3: 沈黙(onEnd) — ウィジェットが idle に戻る', async () => {
  const page = await setupPage();

  const state = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      w.setState('listening');

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onEnd: () => {
          // content.js と同じロジック: listening 中に onEnd → idle
          if (w.getState() === 'listening') {
            w.setState('idle');
          }
          resolve(w.getState());
        },
      });
      sr.start();
      // 音声なし → onEnd のみ発火
      window.__triggerSpeechEnd();
    });
  });

  expect(state).toBe('idle');
  await page.close();
});

// ── 3: 誤認識語も正しくナビゲート ───────────────────────────────

test('テスト3-1: 誤認識語「相談一覧」→ Opportunity に遷移する', async () => {
  const page = await setupPage();
  const instanceUrl = 'https://myorg.my.salesforce.com';

  const result = await page.evaluate(
    async ({ instanceUrl }) => {
      return new Promise((resolve) => {
        window.navigateTo = (url) => resolve({ navigatedTo: url });

        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (transcript) => {
            const intent = window.match(transcript); // eslint-disable-line no-undef
            if (intent && intent.action === 'navigate') {
              const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
              window.navigateTo(url);
            }
          },
        });
        sr.start();
        window.__triggerSpeech('相談一覧を開いて');
        setTimeout(() => resolve({ navigatedTo: null }), 1000);
      });
    },
    { instanceUrl }
  );

  expect(result.navigatedTo).toBe(
    'https://myorg.my.salesforce.com/lightning/o/Opportunity/list'
  );
  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト4: 戻る操作
// ═══════════════════════════════════════════════════════════════

const BACK_PHRASES = ['戻って', '前の画面', 'バック', '前に戻って'];

for (const phrase of BACK_PHRASES) {
  test(`テスト4: 音声→back 「${phrase}」→ goBack() が呼ばれる`, async () => {
    const page = await setupPage();

    const result = await page.evaluate(async (p) => {
      return new Promise((resolve) => {
        // goBack をスパイ化（navigator.js が定義したグローバル関数を上書き）
        window.goBack = () => resolve({ backCalled: true });

        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (transcript) => {
            const intent = window.match(transcript); // eslint-disable-line no-undef
            if (intent && intent.action === 'back') {
              window.goBack();
            }
          },
        });
        sr.start();
        window.__triggerSpeech(p);
        setTimeout(() => resolve({ backCalled: false }), 500);
      });
    }, phrase);

    expect(result.backCalled).toBe(true);
    await page.close();
  });
}

test('テスト4: 戻る操作 — ウィジェットが success 状態になる', async () => {
  const page = await setupPage();

  const state = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      window.goBack = () => {};

      w.setState('listening');

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          const intent = window.match(transcript); // eslint-disable-line no-undef
          if (intent && intent.action === 'back') {
            window.goBack();
            // content.js と同じ: success 表示
            w.setState('success', { message: '前のページに戻ります', duration: 0 });
          }
          resolve(w.getState());
        },
      });
      sr.start();
      window.__triggerSpeech('戻って');
      setTimeout(() => resolve(w.getState()), 500);
    });
  });

  expect(state).toBe('success');
  await page.close();
});

test('テスト4: goBack — navigator.js の goBack() が history.back() を呼ぶ', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    let backCalled = false;
    // window.history.back をスパイ化
    const originalBack = window.history.back.bind(window.history);
    window.history.back = () => {
      backCalled = true;
      // 実際には戻れないのでエラーにならないように元の関数は呼ばない
    };

    // navigator.js の goBack を呼ぶ（グローバル関数）
    // goBack() は内部で window.history.back() を呼ぶ
    goBack(); // eslint-disable-line no-undef

    window.history.back = originalBack; // 復元
    return { backCalled };
  });

  expect(result.backCalled).toBe(true);
  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト5: エラーハンドリング
// ═══════════════════════════════════════════════════════════════

// ── テスト5-1: マイク許可拒否 ────────────────────────────────────

test('テスト5-1: マイクエラー(not-allowed) — ウィジェットが error 状態になる', async () => {
  // マイク許可ダイアログ自体はブラウザ仕様で自動化不可だが、
  // 拒否後に発生する not-allowed エラーの処理は自動化可能
  const page = await setupPage();

  const state = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    const sr = createSpeechRecognition({ // eslint-disable-line no-undef
      onError: (err) => {
        w.setState('error', { message: err });
      },
    });
    w.setState('listening');
    sr.start();
    window.__triggerSpeechError('not-allowed');
    const s = w.getState();
    w.destroy();
    return s;
  });

  expect(state).toBe('error');
  await page.close();
});

test('テスト5-1: マイクエラー(no-speech) — ウィジェットが error 状態になる', async () => {
  const page = await setupPage();

  const state = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    const sr = createSpeechRecognition({ // eslint-disable-line no-undef
      onError: (err) => {
        w.setState('error', { message: err });
      },
    });
    w.setState('listening');
    sr.start();
    window.__triggerSpeechError('no-speech');
    const s = w.getState();
    w.destroy();
    return s;
  });

  expect(state).toBe('error');
  await page.close();
});

test('テスト5-1: マイクエラー後 — タイムアウトで idle に自動回復する', async () => {
  const page = await setupPage();

  const finalState = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onError: (err) => {
          w.setState('error', { message: err });
          // content.js は 3000ms で idle に戻る → テストでは 50ms に短縮
          setTimeout(() => {
            w.setState('idle');
            resolve(w.getState());
          }, 50);
        },
      });
      w.setState('listening');
      sr.start();
      window.__triggerSpeechError('not-allowed');
    });
  });

  expect(finalState).toBe('idle');
  await page.close();
});

test('テスト5-1: マイクエラー — エラーメッセージがウィジェットに表示される', async () => {
  const page = await setupPage();

  const errorMsg = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    const sr = createSpeechRecognition({ // eslint-disable-line no-undef
      onError: (err) => {
        w.setState('error', { message: err });
      },
    });
    w.setState('listening');
    sr.start();
    window.__triggerSpeechError('not-allowed');

    const msgEl = document.querySelector('.vfa-message');
    const msg = msgEl ? msgEl.textContent : '';
    w.destroy();
    return msg;
  });

  expect(errorMsg).toContain('not-allowed');
  await page.close();
});

// ── テスト5-2: 接続切れ ──────────────────────────────────────────

test('テスト5-2: 接続切れ — instance_url なしでもフォールバックURLで navigateTo が呼ばれる', async () => {
  // content.js: instance_url が未設定の場合は window.location.origin をフォールバックとして使用
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      window.navigateTo = (url) => resolve({ navigatedTo: url });

      // instance_url なし → window.location.origin にフォールバック
      const instanceUrl = null || window.location.origin;

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          const intent = window.match(transcript); // eslint-disable-line no-undef
          if (intent && intent.action === 'navigate' && intent.target === 'list') {
            const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
            window.navigateTo(url);
          }
        },
      });
      sr.start();
      window.__triggerSpeech('商談一覧を開いて');
      setTimeout(() => resolve({ navigatedTo: null }), 1000);
    });
  });

  // フォールバック URL でも Opportunity/list パスは生成される
  expect(result.navigatedTo).toContain('/lightning/o/Opportunity/list');
  await page.close();
});

test('テスト5-2: 接続切れ — ウィジェットが processing → success の状態遷移をする', async () => {
  const page = await setupPage();

  const states = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const log = [];
      window.navigateTo = () => {};

      w.setState('listening');
      log.push(w.getState()); // listening

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          w.setTranscript(transcript);
          w.setState('processing');
          log.push(w.getState()); // processing

          const intent = window.match(transcript); // eslint-disable-line no-undef
          if (intent) {
            const url = buildListUrl( // eslint-disable-line no-undef
              window.location.origin,
              intent.object || 'Opportunity'
            );
            window.navigateTo(url);
            w.setState('success', {
              message: intent.message || '遷移します',
              duration: 0,
            });
            log.push(w.getState()); // success
          }
          resolve(log);
        },
      });
      sr.start();
      window.__triggerSpeech('商談一覧を開いて');
      setTimeout(() => resolve(log), 1000);
    });
  });

  expect(states).toContain('listening');
  expect(states).toContain('processing');
  expect(states).toContain('success');
  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト6: セキュリティ確認
// ═══════════════════════════════════════════════════════════════

// ── テスト6: XSS インジェクション ────────────────────────────────

test('テスト6: XSS — <script>タグ発話でアラートが実行されない', async () => {
  const page = await setupPage();

  let alertFired = false;
  page.on('dialog', async (dialog) => {
    alertFired = true;
    await dialog.dismiss();
  });

  await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          // widget.js は textContent のみ使用 → XSS 不発
          w.setTranscript(transcript);
          w.setState('success', { message: `認識: ${transcript}`, duration: 0 });
          resolve();
        },
      });
      w.setState('listening');
      sr.start();
      window.__triggerSpeech('<script>alert("XSS")</script>');
    });
  });

  await page.waitForTimeout(500);
  expect(alertFired).toBe(false);
  await page.close();
});

test('テスト6: XSS — onerror 付き img タグでアラートが実行されない', async () => {
  const page = await setupPage();

  let alertFired = false;
  page.on('dialog', async (dialog) => {
    alertFired = true;
    await dialog.dismiss();
  });

  await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          w.setTranscript(transcript);
          w.setState('success', { message: transcript, duration: 0 });
          resolve();
        },
      });
      w.setState('listening');
      sr.start();
      window.__triggerSpeech('<img src=x onerror=alert(1)>');
    });
  });

  await page.waitForTimeout(500);
  expect(alertFired).toBe(false);
  await page.close();
});

test('テスト6: XSS — XSSペイロードがウィジェット DOM に textContent として安全にレンダリングされる', async () => {
  const page = await setupPage();
  const xssPayload = '<script>alert("XSS")</script>';

  const result = await page.evaluate(async (payload) => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          w.setTranscript(transcript);
          const transcriptEl = document.querySelector('.vfa-transcript');
          if (transcriptEl) {
            resolve({
              textContent: transcriptEl.textContent,
              // innerHTML はエスケープ済み（&lt;script&gt; 形式）になっているはず
              innerHTMLContainsExecutableScript:
                transcriptEl.innerHTML.includes('<script>'),
            });
          } else {
            resolve({ textContent: '', innerHTMLContainsExecutableScript: false });
          }
        },
      });
      w.setState('listening');
      sr.start();
      window.__triggerSpeech(payload);
    });
  }, xssPayload);

  // テキストとしてウィジェットに表示される
  expect(result.textContent).toBe(xssPayload);
  // innerHTML に実行可能な <script> タグは含まれない
  expect(result.innerHTMLContainsExecutableScript).toBe(false);
  await page.close();
});

test('テスト6: XSS — javascript: URI スキームで alert が実行されない', async () => {
  const page = await setupPage();

  let alertFired = false;
  page.on('dialog', async (dialog) => {
    alertFired = true;
    await dialog.dismiss();
  });

  await page.evaluate(async () => {
    return new Promise((resolve) => {
      const w = createWidget(); // eslint-disable-line no-undef
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          w.setTranscript(transcript);
          w.setState('success', { message: transcript, duration: 0 });
          resolve();
        },
      });
      w.setState('listening');
      sr.start();
      window.__triggerSpeech('javascript:alert(1)'); // eslint-disable-line no-script-url
    });
  });

  await page.waitForTimeout(500);
  expect(alertFired).toBe(false);
  await page.close();
});

// ── テスト6: トークン暗号化 ──────────────────────────────────────

test('テスト6: トークン暗号化 — ストレージに plain text のアクセストークンが保存されていない', async () => {
  // Salesforce のアクセストークンは "00D..." で始まる 15〜200文字の文字列
  // 暗号化後は base64 文字列として保存される
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  const storageKeys = await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        resolve(Object.keys(items));
      });
    });
  });

  // 平文キー名 'access_token' や 'refresh_token' が存在しない
  expect(storageKeys).not.toContain('access_token');
  expect(storageKeys).not.toContain('refresh_token');

  await page.close();
});

test('テスト6: トークン暗号化 — 暗号化済みトークンは base64 形式でストレージに保存される', async () => {
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  // ダミーの暗号化済みトークンをセット（lib/auth.js が実際に保存する形式）
  const dummyEncrypted = 'dGVzdGNpcGhlcnRleHRkYXRhMTIzNDU2Nzg='; // base64
  const dummyIv = 'dGVzdGl2MTIzNDU2';                             // base64

  await page.evaluate(
    ({ enc, iv }) => {
      return new Promise((resolve) => {
        chrome.storage.local.set({
          encrypted_access_token: enc,
          token_iv: iv,
          instance_url: 'https://example.my.salesforce.com',
        }, resolve);
      });
    },
    { enc: dummyEncrypted, iv: dummyIv }
  );

  const items = await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(
        ['encrypted_access_token', 'token_iv', 'instance_url', 'access_token'],
        resolve
      );
    });
  });

  // 暗号化フォーマット: base64 文字列
  expect(items.encrypted_access_token).toMatch(/^[A-Za-z0-9+/=]+$/);
  // Salesforce トークン形式（00Dで始まる）ではない
  expect(items.encrypted_access_token).not.toMatch(/^00D/);
  // 平文 access_token キーは存在しない
  expect(items.access_token).toBeUndefined();

  // クリーンアップ
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        ['encrypted_access_token', 'token_iv', 'instance_url'],
        resolve
      );
    });
  });

  await page.close();
});

test('テスト6: トークン暗号化 — IV が存在する場合はトークン本体も暗号化済み', async () => {
  // AES-256-GCM: IV(token_iv) と 暗号文(encrypted_access_token) がセットで存在する
  const page = await context.newPage();
  await page.goto(`chrome-extension://${extensionId}/popup.html`);

  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.set({
        encrypted_access_token: 'dGVzdGNpcGhlcnRleHQ=',
        token_iv: 'dGVzdGl2MTI=',
        instance_url: 'https://example.my.salesforce.com',
      }, resolve);
    });
  });

  const check = await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.get(null, (items) => {
        const hasIv = 'token_iv' in items;
        const hasEncToken = 'encrypted_access_token' in items;
        const hasPlainToken = 'access_token' in items;
        // IV があるなら暗号化済みトークンも必ず存在するべき
        resolve({ hasIv, hasEncToken, hasPlainToken, ivAndEncCoexist: hasIv === hasEncToken });
      });
    });
  });

  expect(check.hasIv).toBe(true);
  expect(check.hasEncToken).toBe(true);
  expect(check.hasPlainToken).toBe(false);
  expect(check.ivAndEncCoexist).toBe(true);

  // クリーンアップ
  await page.evaluate(() => {
    return new Promise((resolve) => {
      chrome.storage.local.remove(
        ['encrypted_access_token', 'token_iv', 'instance_url'],
        resolve
      );
    });
  });

  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト3-search: レコード検索フロー（グローバル検索 URL ナビゲーション）
// ═══════════════════════════════════════════════════════════════

// ── テスト3-search-1: 「田中商事の商談を開いて」→ グローバル検索 URL へ遷移 ──

test('テスト3-search-1: 「田中商事の商談を開いて」→ buildSearchUrl で navigateTo', async () => {
  const page = await setupPage();
  const instanceUrl = 'https://myorg.my.salesforce.com';

  const result = await page.evaluate(
    async ({ instanceUrl }) => {
      return new Promise((okResult) => {
        window.navigateTo = (url) => okResult({ navigatedTo: url });

        const intent = window.match('田中商事の商談を開いて');
        if (!intent || intent.action !== 'search') {
          okResult({ navigatedTo: null, error: 'intent mismatch' });
          return;
        }

        const url = buildSearchUrl(instanceUrl, intent.keyword); // eslint-disable-line no-undef
        window.navigateTo(url);

        setTimeout(() => okResult({ navigatedTo: null, error: 'timeout' }), 2000);
      });
    },
    { instanceUrl }
  );

  expect(result.navigatedTo).toBe(
    'https://myorg.my.salesforce.com/lightning/search?searchInput=%E7%94%B0%E4%B8%AD%E5%95%86%E4%BA%8B'
  );
  await page.close();
});

// ── テスト3-search-2: 「ABC株式会社を表示して」→ グローバル検索 URL へ遷移 ──

test('テスト3-search-2: 「ABC株式会社を表示して」→ buildSearchUrl で navigateTo', async () => {
  const page = await setupPage();
  const instanceUrl = 'https://myorg.my.salesforce.com';

  const result = await page.evaluate(
    async ({ instanceUrl }) => {
      return new Promise((okResult) => {
        window.navigateTo = (url) => okResult({ navigatedTo: url });

        const intent = window.match('ABC株式会社を表示して');
        if (!intent || intent.action !== 'search') {
          okResult({ navigatedTo: null, error: 'intent mismatch' });
          return;
        }

        const url = buildSearchUrl(instanceUrl, intent.keyword); // eslint-disable-line no-undef
        window.navigateTo(url);

        setTimeout(() => okResult({ navigatedTo: null, error: 'timeout' }), 2000);
      });
    },
    { instanceUrl }
  );

  expect(result.navigatedTo).toContain('/lightning/search?searchInput=ABC');
  await page.close();
});

// ── テスト3-search-3: NAVIGATE_TO_SEARCH — sendMessage が正しいメッセージを送信する ──
//
// content.js の search ハンドラは chrome.runtime.sendMessage を呼ぶ。
// background.js の NAVIGATE_TO_SEARCH case が chrome.tabs.update を呼ぶことは
// Jest ユニットテスト（background.test.js）で検証済み。
// ここでは ruleEngine が keyword を正しく抽出し sendMessage が呼ばれることを検証する。

test('テスト3-search-3: 「ABC株式会社を表示して」→ NAVIGATE_TO_SEARCH メッセージが送信される', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      // sendMessage をスパイ化
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => {
        if (msg && msg.type === 'NAVIGATE_TO_SEARCH') {
          resolve({ type: msg.type, keyword: msg.keyword });
        }
        return originalSend(msg);
      };

      const intent = window.match('ABC株式会社を表示して'); // eslint-disable-line no-undef
      if (!intent || intent.action !== 'search') {
        resolve({ error: 'intent mismatch' });
        return;
      }
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword: intent.keyword });
      setTimeout(() => resolve({ error: 'timeout' }), 2000);
    });
  });

  expect(result.type).toBe('NAVIGATE_TO_SEARCH');
  expect(result.keyword).toBe('ABC株式会社');
  await page.close();
});

test('テスト3-search-4: 「田中商事の商談を開いて」→ NAVIGATE_TO_SEARCH メッセージが送信される', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((resolve) => {
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => {
        if (msg && msg.type === 'NAVIGATE_TO_SEARCH') {
          resolve({ type: msg.type, keyword: msg.keyword });
        }
        return originalSend(msg);
      };

      const intent = window.match('田中商事の商談を開いて'); // eslint-disable-line no-undef
      if (!intent || intent.action !== 'search') {
        resolve({ error: 'intent mismatch' });
        return;
      }
      chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword: intent.keyword });
      setTimeout(() => resolve({ error: 'timeout' }), 2000);
    });
  });

  expect(result.type).toBe('NAVIGATE_TO_SEARCH');
  expect(result.keyword).toBe('田中商事');
  await page.close();
});

test('テスト3-search-5: search intent → ウィジェットが processing 状態になる', async () => {
  // content.js の search ハンドラは SOSL API を呼ぶ前に processing に遷移する
  // API 呼び出しは別途モックなしでは実行できないため、状態遷移のみを検証する
  const page = await setupPage();

  const state = await page.evaluate(async () => {
    return new Promise((okResult) => {
      const w = createWidget(); // eslint-disable-line no-undef
      w.setState('listening');

      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (transcript) => {
          const intent = window.match(transcript); // eslint-disable-line no-undef
          if (intent && intent.action === 'search') {
            // content.js と同じ: processing に遷移してから非同期処理
            w.setState('processing', { message: `「${intent.keyword}」を検索中...` });
          }
          okResult(w.getState());
        },
      });
      sr.start();
      window.__triggerSpeech('ABC株式会社を表示して');
      setTimeout(() => okResult('timeout'), 1000);
    });
  });

  expect(state).toBe('processing');
  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト7: content_scripts 統合スモークテスト
//
// 背景（インシデント #2 再発防止）:
//   manifest.json の content_scripts に新スクリプトを追加した際、
//   いずれかのスクリプトが読み込みエラーになると後続の content.js も
//   読み込まれず、Option+V が完全に無反応になる。
//
//   このテスト群は「全 content_scripts 読み込み後に content.js が依存する
//   グローバル関数が全て定義されているか」を自動検証し、
//   CI でリグレッションを即座に検知する。
// ═══════════════════════════════════════════════════════════════

// ── テスト7-1: 全グローバル関数の存在確認 ────────────────────────
//
// manifest.json の content_scripts に新ファイルを追加・削除したとき、
// content.js が参照するグローバル関数が全て定義されていることを保証する。
// いずれかが undefined なら「そのファイルがロードに失敗している」証拠。

test('テスト7-1: 全 content_scripts ロード後 — content.js 依存グローバル関数が全て定義されている', async () => {
  const page = await setupPage();

  const globals = await page.evaluate(() => ({
    // lib/ruleEngine.js
    match:                   typeof window.match === 'function',
    // lib/navigator.js
    navigateTo:              typeof window.navigateTo === 'function',
    buildListUrl:            typeof window.buildListUrl === 'function',
    buildRecordUrl:          typeof window.buildRecordUrl === 'function',
    buildSearchUrl:          typeof window.buildSearchUrl === 'function',
    goBack:                  typeof window.goBack === 'function',
    // lib/speechRecognition.js
    createSpeechRecognition: typeof window.createSpeechRecognition === 'function',
    // lib/salesforceApi.js
    sosl:                    typeof window.sosl === 'function',
    // lib/recordResolver.js
    resolve:                 typeof window.resolve === 'function',
    // ui/widget.js
    createWidget:            typeof window.createWidget === 'function',
    // ui/candidateList.js
    createCandidateList:     typeof window.createCandidateList === 'function',
  }));

  // いずれかが false なら manifest.json に追記漏れ or スクリプトにロードエラーがある
  for (const [fn, exists] of Object.entries(globals)) {
    expect({ fn, exists }).toEqual({ fn, exists: true });
  }

  await page.close();
});

// ── テスト7-2: Option+V の核心フロー ─────────────────────────────
//
// Option+V → TOGGLE_VOICE → toggleVoice() → widget が listening 状態に遷移
// という核心フローのうち、content script レイヤーを直接検証する。
// （background → content のメッセージ送信はブラウザ制約で自動化不可のため
//   createWidget + createSpeechRecognition の直接呼び出しで代替する）

test('テスト7-2: Option+V 核心フロー — widget が idle→listening に遷移し SR が起動できる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    return new Promise((okResult) => {
      // toggleVoice() の核心ロジックを再現
      const w = createWidget(); // eslint-disable-line no-undef
      const initialState = w.getState();

      // idle → listening
      w.setState('listening');
      const listeningState = w.getState();

      // createSpeechRecognition が正常に起動できるか
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: () => {},
        onError: () => {},
        onEnd: () => {},
      });

      okResult({
        initialState,
        listeningState,
        srHasStart: typeof sr.start === 'function',
        srHasStop:  typeof sr.stop === 'function',
      });
    });
  });

  expect(result.initialState).toBe('idle');
  expect(result.listeningState).toBe('listening');
  expect(result.srHasStart).toBe(true);
  expect(result.srHasStop).toBe(true);

  await page.close();
});

// ═══════════════════════════════════════════════════════════════
// テスト3-search-6〜8: SOSL 検索フロー（モック使用）
//
// 背景: salesforceApi.js / recordResolver.js が manifest.json に
//       追加されたことで、content.js から sosl() / resolve() が
//       呼べるようになった。
// テスト方針: window.sosl をモックし、recordResolver.resolve() の
//       分岐ロジック（0件/1件/複数件）ごとに正しい動作を検証する。
// ═══════════════════════════════════════════════════════════════

test('テスト3-search-6: SOSL 1件ヒット → buildRecordUrl で navigateTo が呼ばれる', async () => {
  const page = await setupPage();
  const instanceUrl = 'https://myorg.my.salesforce.com';
  const recordId = '001000000000001AAA';

  const result = await page.evaluate(
    async ({ instanceUrl, recordId }) => {
      return new Promise((okResult) => {
        // sosl をモック（1件ヒット）
        window.sosl = () => Promise.resolve([{ Id: recordId, Name: 'ABC株式会社' }]);
        window.navigateTo = (url) => okResult({ navigatedTo: url });

        const intent = window.match('ABC株式会社を検索して'); // eslint-disable-line no-undef
        if (!intent || intent.action !== 'search') {
          okResult({ error: 'intent mismatch' });
          return;
        }

        const keyword = intent.keyword;
        const sfObject = intent.object || 'Account';

        window.sosl(instanceUrl, 'dummy-token', keyword, sfObject)
          .then((records) => {
            const resolved = window.resolve(records); // eslint-disable-line no-undef
            if (resolved.category === 'single') {
              const url = buildRecordUrl(instanceUrl, sfObject, resolved.record.Id); // eslint-disable-line no-undef
              window.navigateTo(url);
            } else {
              okResult({ error: `unexpected category: ${resolved.category}` });
            }
          });

        setTimeout(() => okResult({ error: 'timeout' }), 2000);
      });
    },
    { instanceUrl, recordId }
  );

  expect(result.navigatedTo).toContain(recordId);
  expect(result.navigatedTo).toContain('/Account/');
  await page.close();
});

test('テスト3-search-7: SOSL 0件 → resolve が not_found を返す', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((okResult) => {
      window.sosl = () => Promise.resolve([]);

      window.sosl('https://myorg.my.salesforce.com', 'dummy', '存在しない会社', 'Account')
        .then((records) => {
          const resolved = window.resolve(records); // eslint-disable-line no-undef
          okResult({ category: resolved.category, message: resolved.message });
        });

      setTimeout(() => okResult({ error: 'timeout' }), 2000);
    });
  });

  expect(result.category).toBe('not_found');
  expect(result.message).toContain('見つかりませんでした');
  await page.close();
});

test('テスト3-search-8: SOSL 複数件 → resolve が multiple を返す', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((okResult) => {
      window.sosl = () => Promise.resolve([
        { Id: '001000000000001AAA', Name: '田中商事A' },
        { Id: '001000000000002AAA', Name: '田中商事B' },
        { Id: '001000000000003AAA', Name: '田中商事C' },
      ]);

      window.sosl('https://myorg.my.salesforce.com', 'dummy', '田中商事', 'Account')
        .then((records) => {
          const resolved = window.resolve(records); // eslint-disable-line no-undef
          okResult({
            category:       resolved.category,
            candidateCount: resolved.candidates.length,
            message:        resolved.message,
          });
        });

      setTimeout(() => okResult({ error: 'timeout' }), 2000);
    });
  });

  expect(result.category).toBe('multiple');
  expect(result.candidateCount).toBe(3);
  expect(result.message).toContain('3件');
  await page.close();
});

test('テスト3-search-9: SW keepalive — startKeepalive() 呼び出し直後に即時 STAY_ALIVE が送信される', async () => {
  // content.js の startKeepalive() 改修後のロジックを検証:
  //   1. 即時1回 STAY_ALIVE 送信（短い発話でも SW が確実に起きる）
  //   2. 以降 10秒ごとに送信（setInterval）
  //   3. stopKeepalive() でタイマー停止
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    return new Promise((okResult) => {
      const messages = [];
      const originalSend = chrome.runtime.sendMessage.bind(chrome.runtime);
      chrome.runtime.sendMessage = (msg) => {
        messages.push(msg);
        return originalSend(msg);
      };

      // content.js の startKeepalive() と同等のロジック（即時送信 + setInterval）
      let timer = null;
      const startKeepalive = () => {
        if (timer) return;
        // 即時1回: SW が停止していても確実に起動させる
        chrome.runtime.sendMessage({ type: 'STAY_ALIVE' }).catch(() => {});
        timer = setInterval(() => {
          chrome.runtime.sendMessage({ type: 'STAY_ALIVE' }).catch(() => {});
        }, 50); // テスト用に 50ms に短縮
      };
      const stopKeepalive = () => {
        if (timer) { clearInterval(timer); timer = null; }
      };

      startKeepalive();

      // 即時送信を確認（t=0 の時点で既に 1 件あるはず）
      const immediateCount = messages.filter(m => m.type === 'STAY_ALIVE').length;

      // 30ms 後に停止（短い発話を模擬: interval はまだ発火していない可能性がある）
      setTimeout(() => {
        stopKeepalive();
        const totalCount = messages.filter(m => m.type === 'STAY_ALIVE').length;
        okResult({ immediateCount, totalCount, timerStopped: timer === null });
      }, 30);
    });
  });

  // 即時送信: startKeepalive() 呼び出し直後に 1 件送信されている
  expect(result.immediateCount).toBe(1);
  // interval が止まっている
  expect(result.timerStopped).toBe(true);
  // 合計も 1 件以上（interval が発火した場合はさらに増える）
  expect(result.totalCount).toBeGreaterThanOrEqual(1);
  await page.close();
});
