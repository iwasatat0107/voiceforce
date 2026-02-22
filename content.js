'use strict';

// Content Script: 音声認識・UIオーバーレイ
// ui/widget.js と lib/speechRecognition.js は manifest.json で先に読み込まれる

const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  let widget = null;
  let speech = null;

  function getWidget() {
    if (!widget && typeof createWidget === 'function') { // eslint-disable-line no-undef
      widget = createWidget(); // eslint-disable-line no-undef
    }
    return widget;
  }

  function toggleVoice() {
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
              // ListView API でリストビュー ID を検索
              try {
                const token = await new Promise((resolve, reject) => {
                  chrome.runtime.sendMessage({ type: 'GET_VALID_TOKEN' }, (res) => {
                    if (res && res.success) resolve(res.token);
                    else reject(new Error('token error'));
                  });
                });
                const apiUrl = `${instanceUrl}/services/data/v59.0/sobjects/${intent.object}/listviews`;
                const resp = await fetch(apiUrl, { headers: { Authorization: `Bearer ${token}` } });
                const data = await resp.json();
                const views = data.listviews || [];
                // filterName に対応する検索キーワード（英語・日本語両対応）
                const FILTER_KEYWORDS = {
                  'All': ['all', '__all', 'すべて', '全て', '全部'],
                  'RecentlyViewed': ['recent', '__recent', '最近'],
                  'MyOpportunities': ['myopportunities', '自分', 'my'],
                };
                const keywords = FILTER_KEYWORDS[intent.filterName] || [intent.filterName.toLowerCase()];
                const found = views.find(v => {
                  const dn = v.developerName.toLowerCase();
                  const lb = v.label.toLowerCase();
                  return keywords.some(kw => dn.includes(kw) || lb.includes(kw));
                });
                const url = buildListUrl(instanceUrl, intent.object, found ? found.id : null); // eslint-disable-line no-undef
                w.setState('success', { message: intent.message });
                setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
              } catch (_) {
                const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
                w.setState('success', { message: intent.message });
                setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
              }
            } else {
              const url = buildListUrl(instanceUrl, intent.object); // eslint-disable-line no-undef
              w.setState('success', { message: intent.message });
              setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
            }
          });
        } else if (intent && intent.action === 'back') {
          goBack(); // eslint-disable-line no-undef
          w.setState('success', { message: '前のページに戻ります' });
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
