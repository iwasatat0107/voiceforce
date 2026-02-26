'use strict';

// Content Script: 音声認識・UIオーバーレイ
// ui/widget.js / lib/speechRecognition.js は manifest.json で先に読み込まれる

const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  let widget = null;
  let speech = null;
  let keepaliveTimer = null;
  let candidateList = null;
  let pendingCandidates = null; // { records, sfObject, instanceUrl }

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

  const getCandidateList = function() {
    if (!candidateList && typeof createCandidateList === 'function') { // eslint-disable-line no-undef
      candidateList = createCandidateList(); // eslint-disable-line no-undef
    }
    return candidateList;
  };

  // 検索実行関数: 0件・多件はウィジェット内で完結（外部ページ遷移なし）
  const runSearch = async function(keyword, sfObject) {
    const fields = OBJECT_DISPLAY_FIELDS[sfObject] || ['Id', 'Name'];
    const w = getWidget();
    // 前回の候補選択状態をリセット
    if (candidateList) candidateList.hide();
    pendingCandidates = null;
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
          w.setState('error', { message: `「${keyword}」は見つかりませんでした` });
          setTimeout(() => w.setState('idle'), 4000);
          return;
        }

        if (resolved.category === 'single') {
          const url = buildRecordUrl(instanceUrl, sfObject, resolved.record.Id); // eslint-disable-line no-undef
          // Task は Name の代わりに Subject を使用
          const displayName = resolved.record.Name || resolved.record.Subject || resolved.record.Id;
          w.setState('success', { message: `「${displayName}」を開きます` });
          setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
        } else if (resolved.category === 'too_many') {
          // 6件以上: 絞り込みを促す（遷移なし）
          w.setState('error', { message: resolved.message });
          setTimeout(() => w.setState('idle'), 4000);
        } else {
          // multiple (2〜5件): candidateList に候補を表示し音声番号選択を待つ
          const cl = getCandidateList();
          pendingCandidates = { records: resolved.candidates, sfObject, instanceUrl };
          cl.show(resolved.candidates, (_idx, record) => {
            // クリック選択
            cl.hide();
            pendingCandidates = null;
            const url = buildRecordUrl(instanceUrl, sfObject, record.Id); // eslint-disable-line no-undef
            const displayName = record.Name || record.Subject || record.Id;
            w.setState('success', { message: `「${displayName}」を開きます` });
            setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
          });
          w.setState('selecting', { message: resolved.message });
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

        } else if (intent && intent.action === 'select') {
          // 候補リスト表示中の音声番号選択（「1番」「2」など）
          if (pendingCandidates) {
            const { records, sfObject: ps, instanceUrl: pi } = pendingCandidates;
            const record = records[intent.index - 1];
            if (record) {
              const cl = getCandidateList();
              cl.hide();
              pendingCandidates = null;
              const url = buildRecordUrl(pi, ps, record.Id); // eslint-disable-line no-undef
              const displayName = record.Name || record.Subject || record.Id;
              w.setState('success', { message: `「${displayName}」を開きます` });
              setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
            } else {
              w.setState('error', { message: `1〜${records.length}番で選んでください` });
              setTimeout(() => w.setState('idle'), 3000);
            }
          } else {
            w.setState('success', { message: `認識: ${transcript}` });
          }

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

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_VOICE') {
      toggleVoice();
    }
  });
}
