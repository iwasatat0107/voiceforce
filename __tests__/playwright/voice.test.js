'use strict';

/**
 * 音声認識自動化テスト
 *
 * webkitSpeechRecognition をモックし、発話テキストを直接注入することで
 * 音声認識 → ruleEngine → widget状態遷移 のパイプラインを自動検証する。
 */

const { test, expect, chromium } = require('@playwright/test');
const path = require('path');

let context;
let extensionId;

// ── モック注入ヘルパー ─────────────────────────────────────────────

/**
 * webkitSpeechRecognition のモックを page に注入する。
 * window.__triggerSpeech(transcript) で onresult を発火できる。
 * window.__triggerSpeechError(errorType) で onerror を発火できる。
 */
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

/**
 * 拡張機能スクリプトを順番に読み込むヘルパー
 */
async function loadExtensionScripts(page, extId) {
  await page.evaluate(async (id) => {
    const scripts = [
      'ui/widget.js',
      'lib/speechRecognition.js',
      'lib/ruleEngine.js',
      'lib/navigator.js',
    ];
    for (const src of scripts) {
      const s = document.createElement('script');
      s.src = `chrome-extension://${id}/${src}`;
      document.head.appendChild(s);
      await new Promise(r => s.addEventListener('load', r));
    }
  }, extId);
}

// ── テストセットアップ ───────────────────────────────────────────────

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

// ── テスト 1: 音声認識モックの基本動作 ──────────────────────────────

test('音声モック: start → transcript → onResult が呼ばれる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onResult: (t) => resolve({ type: 'result', transcript: t }),
        onError: (e) => resolve({ type: 'error', error: e }),
      });
      sr.start();
      window.__triggerSpeech('商談一覧を開いて');
    });
  });

  expect(result.type).toBe('result');
  expect(result.transcript).toBe('商談一覧を開いて');

  await page.close();
});

test('音声モック: 中間テキスト (interim) は onInterim で受け取る', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onInterim: (t) => resolve({ type: 'interim', transcript: t }),
        onResult: (t) => resolve({ type: 'final', transcript: t }),
      });
      sr.start();
      window.__triggerSpeech('しょう', false); // isFinal=false
    });
  });

  expect(result.type).toBe('interim');
  expect(result.transcript).toBe('しょう');

  await page.close();
});

test('音声モック: エラー発生時に onError が呼ばれる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onError: (e) => resolve({ type: 'error', error: e }),
      });
      sr.start();
      window.__triggerSpeechError('no-speech');
    });
  });

  expect(result.type).toBe('error');
  expect(result.error).toBe('no-speech');

  await page.close();
});

test('音声モック: stop 後に onEnd が呼ばれる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(() => {
    return new Promise((resolve) => {
      const sr = createSpeechRecognition({ // eslint-disable-line no-undef
        onEnd: () => resolve({ type: 'end' }),
      });
      sr.start();
      sr.stop();
    });
  });

  expect(result.type).toBe('end');

  await page.close();
});

// ── テスト 2: 発話 → ruleEngine パイプライン ────────────────────────

const NAVIGATE_CASES = [
  // [発話, 期待object, 期待filterName]
  ['商談一覧を開いて',       'Opportunity', undefined],
  ['相談一覧を開いて',       'Opportunity', undefined],  // 誤認識対応
  ['取引先一覧を開いて',     'Account',     undefined],
  ['リード一覧を開いて',     'Lead',        undefined],
  ['取引先責任者一覧を開いて', 'Contact',   undefined],
  ['すべての商談を開いて',   'Opportunity', 'All'],
  ['全ての商談を開いて',     'Opportunity', 'All'],
  ['全部の商談を開いて',     'Opportunity', 'All'],
  ['商談のすべてを開いて',   'Opportunity', 'All'],
  ['最近参照した商談を開いて', 'Opportunity', 'RecentlyViewed'],
  ['最近の商談を開いて',     'Opportunity', 'RecentlyViewed'],
  ['自分の商談を開いて',     'Opportunity', 'MyOpportunities'],
  ['私の商談を開いて',       'Opportunity', 'MyOpportunities'],
];

for (const [phrase, expectedObject, expectedFilter] of NAVIGATE_CASES) {
  test(`音声→ruleEngine: 「${phrase}」→ navigate ${expectedObject}${expectedFilter ? ` (${expectedFilter})` : ''}`, async () => {
    const page = await setupPage();

    const result = await page.evaluate(async (p) => {
      return new Promise((resolve) => {
        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (t) => resolve(window.match(t)),
        });
        sr.start();
        window.__triggerSpeech(p);
      });
    }, phrase);

    expect(result).not.toBeNull();
    expect(result.action).toBe('navigate');
    expect(result.object).toBe(expectedObject);
    if (expectedFilter) {
      expect(result.filterName).toBe(expectedFilter);
    }

    await page.close();
  });
}

// ── テスト 3: 操作コマンドの発話 ────────────────────────────────────

const COMMAND_CASES = [
  ['戻って',       { action: 'back' }],
  ['前の画面',     { action: 'back' }],
  ['バック',       { action: 'back' }],
  ['はい',         { action: 'confirm', value: true }],
  ['OK',           { action: 'confirm', value: true }],
  ['いいえ',       { action: 'confirm', value: false }],
  ['キャンセル',   { action: 'confirm', value: false }],
  ['止めて',       { action: 'stop' }],
  ['ストップ',     { action: 'stop' }],
  ['元に戻して',   { action: 'undo' }],
  ['取り消して',   { action: 'undo' }],
  ['1番',          { action: 'select', index: 1 }],
  ['3番',          { action: 'select', index: 3 }],
  ['ヘルプ',       { action: 'help' }],
];

for (const [phrase, expected] of COMMAND_CASES) {
  test(`音声→ruleEngine: 「${phrase}」→ ${JSON.stringify(expected)}`, async () => {
    const page = await setupPage();

    const result = await page.evaluate(async (p) => {
      return new Promise((resolve) => {
        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (t) => resolve(window.match(t)),
        });
        sr.start();
        window.__triggerSpeech(p);
      });
    }, phrase);

    expect(result).toMatchObject(expected);

    await page.close();
  });
}

// ── テスト 4: 認識不能な発話 ────────────────────────────────────────

const UNKNOWN_CASES = [
  'テスト',
  'あいうえお',
  'hello world',
  '123456',
];

for (const phrase of UNKNOWN_CASES) {
  test(`音声→ruleEngine: 「${phrase}」→ null（マッチなし）`, async () => {
    const page = await setupPage();

    const result = await page.evaluate(async (p) => {
      return new Promise((resolve) => {
        const sr = createSpeechRecognition({ // eslint-disable-line no-undef
          onResult: (t) => resolve(window.match(t)),
        });
        sr.start();
        window.__triggerSpeech(p);
      });
    }, phrase);

    expect(result).toBeNull();

    await page.close();
  });
}

// ── テスト 5: widget 状態遷移 ────────────────────────────────────────

test('widget: idle → listening → processing → success の状態遷移', async () => {
  const page = await setupPage();

  const states = await page.evaluate(async () => {
    const w = createWidget(); // eslint-disable-line no-undef
    const log = [w.getState()];

    w.setState('listening');
    log.push(w.getState());

    w.setState('processing');
    log.push(w.getState());

    w.setState('success', { message: '完了', duration: 0 });
    log.push(w.getState());

    // success → idle は setTimeout で自動遷移するため少し待つ
    await new Promise(r => setTimeout(r, 50));
    log.push(w.getState());

    w.destroy();
    return log;
  });

  expect(states).toEqual(['idle', 'listening', 'processing', 'success', 'idle']);

  await page.close();
});

test('widget: idle → listening → error → idle の状態遷移', async () => {
  const page = await setupPage();

  const states = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    const log = [w.getState()];

    w.setState('listening');
    log.push(w.getState());

    w.setState('error', { message: 'マイクエラー' });
    log.push(w.getState());

    w.setState('idle');
    log.push(w.getState());

    w.destroy();
    return log;
  });

  expect(states).toEqual(['idle', 'listening', 'error', 'idle']);

  await page.close();
});

test('widget: 発話テキストが setTranscript で反映される', async () => {
  const page = await setupPage();

  const text = await page.evaluate(() => {
    const w = createWidget(); // eslint-disable-line no-undef
    w.setState('listening');
    w.setTranscript('商談一覧を開いて');
    const el = document.querySelector('#vfa-widget [data-role="transcript"]') ||
               document.querySelector('#vfa-widget');
    w.destroy();
    return el ? el.textContent : '';
  });

  expect(text).toContain('商談一覧を開いて');

  await page.close();
});

// ── テスト 6: 音声 → widget 状態連動 ────────────────────────────────

test('音声認識開始でウィジェットが listening 状態になる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    const w = createWidget(); // eslint-disable-line no-undef
    const stateLog = [w.getState()];

    const sr = createSpeechRecognition({ // eslint-disable-line no-undef
      onResult: (transcript) => {
        w.setTranscript(transcript);
        w.setState('processing');
      },
      onEnd: () => {
        if (w.getState() === 'listening') w.setState('idle');
      },
    });

    w.setState('listening');
    stateLog.push(w.getState());

    sr.start();
    window.__triggerSpeech('商談一覧を開いて');
    stateLog.push(w.getState());

    w.destroy();
    return stateLog;
  });

  expect(result).toEqual(['idle', 'listening', 'processing']);

  await page.close();
});

test('エラー発生でウィジェットが error 状態になる', async () => {
  const page = await setupPage();

  const result = await page.evaluate(async () => {
    const w = createWidget(); // eslint-disable-line no-undef

    const sr = createSpeechRecognition({ // eslint-disable-line no-undef
      onError: (err) => {
        w.setState('error', { message: err });
      },
    });

    w.setState('listening');
    sr.start();
    window.__triggerSpeechError('no-speech');

    const state = w.getState();
    w.destroy();
    return state;
  });

  expect(result).toBe('error');

  await page.close();
});
