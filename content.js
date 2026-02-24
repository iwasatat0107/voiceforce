'use strict';

// Content Script: 音声認識・UIオーバーレイ
// ui/widget.js / lib/speechRecognition.js は manifest.json で先に読み込まれる

const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  let widget = null;
  let speech = null;

  const getWidget = function() {
    if (!widget && typeof createWidget === 'function') { // eslint-disable-line no-undef
      widget = createWidget(); // eslint-disable-line no-undef
    }
    return widget;
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

              // SOSL 検索
              const records = await sosl(instanceUrl, token, keyword, sfObject); // eslint-disable-line no-undef
              const resolved = resolve(records); // eslint-disable-line no-undef

              if (resolved.category === 'not_found') {
                w.setState('success', { message: resolved.message });
              } else if (resolved.category === 'single') {
                const url = buildRecordUrl(instanceUrl, sfObject, resolved.record.Id); // eslint-disable-line no-undef
                w.setState('success', { message: `「${resolved.record.Name}」を開きます` });
                setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
              } else {
                // multiple / too_many → 検索ページへ遷移
                w.setState('success', { message: resolved.message });
                setTimeout(() => {
                  chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword }).catch(() => {});
                }, 1000);
              }
            } catch (err) {
              console.warn('[VF] search error:', err.message);
              // トークンエラー（未接続・期限切れ）はフォールバック遷移
              const isTokenErr = !err.message || err.message.includes('トークン') ||
                err.message.includes('token') || err.message.includes('Receiving end') ||
                err.message.includes('message channel') || err.message.includes('closed') ||
                err.message.includes('unauthorized') || err.message.includes('INVALID_SESSION');
              if (isTokenErr) {
                w.setState('success', { message: `「${keyword}」を検索します（再接続を推奨）` });
                setTimeout(() => {
                  chrome.runtime.sendMessage({ type: 'NAVIGATE_TO_SEARCH', keyword }).catch(() => {});
                }, 800);
              } else {
                w.setState('error', { message: err.message || '検索中にエラーが発生しました' });
                setTimeout(() => w.setState('idle'), 3000);
              }
            }
          });

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
