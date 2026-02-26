'use strict';

// Content Script: 音声認識・UIオーバーレイ
// ui/widget.js / lib/speechRecognition.js は manifest.json で先に読み込まれる

const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  let widget = null;
  let speech = null;
  let keepaliveTimer = null;

  // 検索対象オブジェクトごとの取得フィールド（Task は Name の代わりに Subject を使用）
  const OBJECT_DISPLAY_FIELDS = {
    'Account':     ['Id', 'Name'],
    'Contact':     ['Id', 'Name', 'Email'],
    'Lead':        ['Id', 'Name', 'Company'],
    'Opportunity': ['Id', 'Name', 'StageName'],
    'Task':        ['Id', 'Subject', 'Status'],
  };

  // SW キープアライブ: MV3 Service Worker は ~30秒の無活動でシャットダウンする。
  // 音声認識中（5〜15秒）に SW が終了すると GET_VALID_TOKEN が失敗するため、
  // リスニング開始時に即時1回 + 以降10秒ごとに STAY_ALIVE を送って SW を生かし続ける。
  // ※ setInterval の初回発火は10秒後なので、短い発話（3〜8秒）では interval が
  //   一度も発火しない。即時送信で SW が確実に生きた状態でトークン取得を行う。
  const startKeepalive = function() {
    if (keepaliveTimer) return;
    // 即時1回送信: SW が停止していても確実に起動させる
    chrome.runtime.sendMessage({ type: 'STAY_ALIVE' }).catch(() => {});
    keepaliveTimer = setInterval(() => {
      chrome.runtime.sendMessage({ type: 'STAY_ALIVE' }).catch(() => {});
    }, 10000);
  };

  const stopKeepalive = function() {
    if (keepaliveTimer) {
      clearInterval(keepaliveTimer);
      keepaliveTimer = null;
    }
  };

  const getWidget = function() {
    if (!widget && typeof createWidget === 'function') { // eslint-disable-line no-undef
      widget = createWidget(); // eslint-disable-line no-undef
    }
    return widget;
  };

  // 検索実行関数: 0件時はグローバル検索へ自動遷移
  const runSearch = async function(keyword, sfObject) {
    const fields = OBJECT_DISPLAY_FIELDS[sfObject] || ['Id', 'Name'];
    const w = getWidget();
    w.setState('processing', { message: `「${keyword}」を検索中...` });

    chrome.storage.local.get(['instance_url'], async (storageResult) => {
      const instanceUrl = storageResult.instance_url || window.location.origin;
      try {
        // アクセストークン取得
        const token = await new Promise((tokenRes, tokenRej) => {
          chrome.runtime.sendMessage({ type: 'GET_VALID_TOKEN' }, (r) => {
            if (chrome.runtime.lastError) {
              tokenRej(new Error(chrome.runtime.lastError.message));
              return;
            }
            if (r && r.success) { tokenRes(r.token); return; }
            tokenRej(new Error(r?.error || 'トークン取得に失敗しました'));
          });
        });

        // SOSL 曖昧検索（法人格の漢字/ひらがな表記ゆれに対応）
        const records = await soslFuzzy(instanceUrl, token, keyword, sfObject, fields); // eslint-disable-line no-undef
        const resolved = resolve(records); // eslint-disable-line no-undef

        if (resolved.category === 'not_found') {
          w.setState('success', { message: `「${keyword}」は見つかりません。グローバル検索に移動します` });
          setTimeout(() => {
            // chrome.tabs.update では searchInput URL パラメータが Lightning SPA に無視されるため
            // storage にキーワードを保存し、着地先の content.js が検索ボックスへ直接入力する
            chrome.storage.local.set({ pendingSearch: keyword }, () => {
              chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword }).catch(() => {});
            });
          }, 2000);
          return;
        }

        if (resolved.category === 'single') {
          const url = buildRecordUrl(instanceUrl, sfObject, resolved.record.Id); // eslint-disable-line no-undef
          // Task は Name の代わりに Subject を使用
          const displayName = resolved.record.Name || resolved.record.Subject || resolved.record.Id;
          w.setState('success', { message: `「${displayName}」を開きます` });
          setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
        } else {
          // multiple / too_many → 検索ページへ遷移（キーワードを storage 経由で渡す）
          w.setState('success', { message: resolved.message });
          setTimeout(() => {
            chrome.storage.local.set({ pendingSearch: keyword }, () => {
              chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword }).catch(() => {});
            });
          }, 1000);
        }
      } catch (err) {
        console.warn('[VF] search error:', err.message);
        // トークンエラー（セッション切れ・未接続・期限切れ）はウィジェットで再接続を促す。
        // ※ 検索ページへの遷移は行わない（SW 再起動後は session キーが消えており
        //   トークン復号不能のため、遷移しても何も解決しない）
        const isTokenErr = !err.message || err.message.includes('セッション') ||
          err.message.includes('トークン') || err.message.includes('token') ||
          err.message.includes('Receiving end') || err.message.includes('message channel') ||
          err.message.includes('closed') || err.message.includes('unauthorized') ||
          err.message.includes('INVALID_SESSION');
        if (isTokenErr) {
          w.setState('error', { message: 'ポップアップから再接続してください' });
          setTimeout(() => w.setState('idle'), 4000);
        } else {
          w.setState('error', { message: err.message || '検索中にエラーが発生しました' });
          setTimeout(() => w.setState('idle'), 3000);
        }
      }
    });
  };

  const toggleVoice = function() {
    const w = getWidget();
    if (!w) return;

    const state = w.getState();

    if (state === 'listening') {
      if (speech) speech.stop();
      w.setState('idle');
      return;
    }

    w.setState('listening');
    startKeepalive(); // SW をリスニング中ずっと生かす

    speech = createSpeechRecognition({ // eslint-disable-line no-undef
      onResult: (transcript) => {
        stopKeepalive(); // 結果が来たら keepalive 不要
        w.setTranscript(transcript);
        w.setState('processing');
        if (speech) speech.stop();

        // ruleEngine で解析
        const intent = match(transcript); // eslint-disable-line no-undef
        console.warn('[VF] transcript:', transcript, '| intent:', JSON.stringify(intent));
        if (intent && intent.action === 'navigate' && intent.target === 'list') {
          chrome.storage.local.get(['instance_url', 'access_token_enc', 'enc_iv'], async (result) => {
            const instanceUrl = result.instance_url || window.location.origin;

            if (intent.filterName) {
              // filterName は Salesforce 標準 developerName（AllOpportunities, MyAccounts など）を直接使用
              const url = buildListUrl(instanceUrl, intent.object, intent.filterName); // eslint-disable-line no-undef
              w.setState('success', { message: intent.message });
              setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
            } else {
              const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
              w.setState('success', { message: intent.message });
              setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
            }
          });
        } else if (intent && intent.action === 'back') {
          goBack(); // eslint-disable-line no-undef
          w.setState('success', { message: '前のページに戻ります' });

        } else if (intent && intent.action === 'search') {
          const keyword = intent.keyword;
          const sfObject = intent.object || 'Account';
          runSearch(keyword, sfObject);

        } else {
          w.setState('success', { message: `認識: ${transcript}` });
        }
      },
      onError: (err) => {
        stopKeepalive();
        w.setState('error', { message: err });
        setTimeout(() => w.setState('idle'), 3000);
      },
      onEnd: () => {
        stopKeepalive();
        if (w.getState() === 'listening') {
          w.setState('idle');
        }
      },
    });

    speech.start();
  };

  // グローバル検索ページ着地時にキーワードを検索ボックスへ自動入力する。
  // Salesforce LWC は open Shadow DOM を使用するため shadowRoot を再帰的に辿って input を探す。
  // chrome.tabs.update での searchInput URL パラメータは Lightning SPA に無視されるため
  // storage 経由でキーワードを渡し、Shadow DOM を貫通して input に書き込む。
  if (window.location.pathname === '/lightning/search') {
    chrome.storage.local.get(['pendingSearch'], ({ pendingSearch }) => {
      if (!pendingSearch) return;
      chrome.storage.local.remove('pendingSearch');
      console.warn('[VF] /lightning/search 着地、pendingSearch:', pendingSearch);

      // open Shadow DOM を含めて再帰的に「可視の」selector に一致する要素を探す。
      // querySelector は hidden input を先に返すため querySelectorAll でサイズ確認してスキップ。
      const queryShadow = function(sel, root, depth) {
        if (depth > 7) return null;
        for (const el of root.querySelectorAll(sel)) {
          if (el.offsetWidth > 0 || el.offsetHeight > 0) return el;
        }
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) {
            const found = queryShadow(sel, node.shadowRoot, depth + 1);
            if (found) return found;
          }
        }
        return null;
      };

      // 全 input（hidden 含む）を Shadow DOM ごと列挙してログ出力（デバッグ用）
      const logAllInputs = function(root, depth) {
        if (depth > 7) return;
        for (const el of root.querySelectorAll('input')) {
          console.warn('[VF] input:', el.type, el.offsetWidth + 'x' + el.offsetHeight,
            'ph:', el.placeholder, 'id:', el.id, 'name:', el.name, 'class:', el.className);
        }
        for (const node of root.querySelectorAll('*')) {
          if (node.shadowRoot) logAllInputs(node.shadowRoot, depth + 1);
        }
      };

      const fillSearchInput = function(keyword, attempts) {
        if (attempts <= 0) {
          console.warn('[VF] 検索ボックス（可視）が見つかりませんでした。全 input を列挙:');
          logAllInputs(document, 0);
          return;
        }
        // Salesforce グローバル検索は id="sfnavQuickSearch" の type="text" input（Shadow DOM 内）
        // 直接 id で探し、見つからなければ type="text" → type="search" の順でフォールバック
        const input = queryShadow('#sfnavQuickSearch', document, 0)
          || queryShadow('input[type="text"]', document, 0)
          || queryShadow('input[type="search"]', document, 0);
        if (input) {
          console.warn('[VF] 検索ボックス発見 size:', input.offsetWidth, 'x', input.offsetHeight,
            'type:', input.type, 'ph:', input.placeholder, 'id:', input.id);
          input.focus();
          setTimeout(() => {
            document.execCommand('insertText', false, keyword);
            console.warn('[VF] execCommand 後 value:', input.value);
          }, 100);
        } else {
          console.warn('[VF] 検索ボックス未発見（可視）、再試行... 残り', attempts - 1);
          setTimeout(() => fillSearchInput(keyword, attempts - 1), 500);
        }
      };

      // Salesforce の初期レンダリング（約 1.5 秒）を待ってから実行
      setTimeout(() => fillSearchInput(pendingSearch, 10), 1500);
    });
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_VOICE') {
      toggleVoice();
    }
  });
}
