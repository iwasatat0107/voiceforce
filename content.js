'use strict';

// Content Script: 音声認識・UIオーバーレイ
// ui/widget.js / lib/speechRecognition.js / lib/salesforceApi.js /
// lib/recordResolver.js / ui/candidateList.js は manifest.json で先に読み込まれる

const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  let widget = null;
  let speech = null;
  let activeCandidateSession = null;
  let candidateListUI = null;

  const getWidget = function() {
    if (!widget && typeof createWidget === 'function') { // eslint-disable-line no-undef
      widget = createWidget(); // eslint-disable-line no-undef
    }
    return widget;
  }

  const getCandidateList = function() {
    if (!candidateListUI && typeof createCandidateList === 'function') { // eslint-disable-line no-undef
      candidateListUI = createCandidateList(); // eslint-disable-line no-undef
    }
    return candidateListUI;
  }

  // オブジェクト別取得フィールド（candidateList 表示用）
  const SEARCH_FIELDS = {
    Opportunity: ['Id', 'Name'],
    Account:     ['Id', 'Name'],
    Contact:     ['Id', 'Name'],
    Lead:        ['Id', 'Name'],
    Task:        ['Id', 'Subject'],
    Event:       ['Id', 'Subject'],
  };

  const handleSearch = async function(intent, w) {
    // トークン取得
    const token = await new Promise((ok, fail) => {
      chrome.runtime.sendMessage({ type: 'GET_VALID_TOKEN' }, (res) => {
        if (res && res.success) ok(res.token);
        else fail(new Error('トークン取得に失敗しました'));
      });
    });

    const storageData = await new Promise((ok) =>
      chrome.storage.local.get(['instance_url'], ok)
    );
    const instanceUrl = storageData.instance_url || window.location.origin;

    const fields = SEARCH_FIELDS[intent.object] || ['Id', 'Name'];

    // SOSL 検索（salesforceApi.js のグローバル関数）
    const records = await sosl(instanceUrl, token, intent.keyword, intent.object, fields); // eslint-disable-line no-undef

    // 件数分岐（recordResolver.js のグローバル関数）
    const resolved = resolve(records); // eslint-disable-line no-undef

    if (resolved.category === 'single') {
      const url = buildRecordUrl(instanceUrl, intent.object, resolved.record.Id); // eslint-disable-line no-undef
      activeCandidateSession = null;
      getCandidateList()?.hide();
      w.setState('success', { message: resolved.message });
      setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef

    } else if (resolved.category === 'multiple') {
      activeCandidateSession = { candidates: resolved.candidates, object: intent.object, instanceUrl };
      const cl = getCandidateList();
      if (cl) {
        cl.show(resolved.candidates, (_idx, record) => {
          const url = buildRecordUrl(instanceUrl, intent.object, record.Id); // eslint-disable-line no-undef
          cl.hide();
          activeCandidateSession = null;
          navigateTo(url); // eslint-disable-line no-undef
        });
      }
      w.setState('success', { message: resolved.message });

    } else {
      // not_found / too_many
      activeCandidateSession = null;
      w.setState('success', { message: resolved.message });
    }
  }

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

    speech = createSpeechRecognition({ // eslint-disable-line no-undef
      onResult: (transcript) => {
        w.setTranscript(transcript);
        w.setState('processing');
        if (speech) speech.stop();

        // ruleEngine で解析
        const intent = match(transcript); // eslint-disable-line no-undef
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
          handleSearch(intent, w).catch((err) => {
            w.setState('error', { message: err.message || '検索エラー' });
            setTimeout(() => w.setState('idle'), 3000);
          });

        } else if (intent && intent.action === 'select') {
          const cl = getCandidateList();
          if (cl && activeCandidateSession) {
            cl.selectByNumber(intent.index);
          } else {
            w.setState('success', { message: `認識: ${transcript}` });
          }

        } else {
          w.setState('success', { message: `認識: ${transcript}` });
        }
      },
      onError: (err) => {
        w.setState('error', { message: err });
        setTimeout(() => w.setState('idle'), 3000);
      },
      onEnd: () => {
        if (w.getState() === 'listening') {
          w.setState('idle');
        }
      },
    });

    speech.start();
  }

  chrome.runtime.onMessage.addListener((message) => {
    if (message.type === 'TOGGLE_VOICE') {
      toggleVoice();
    }
  });
}
