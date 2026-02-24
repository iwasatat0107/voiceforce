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
          w.setState('success', { message: `「${keyword}」を検索します` });
          setTimeout(() => {
            // Salesforce グローバル検索バーにキーワードを入力して Enter を送信
            const SEARCH_SELECTORS = [
              '.slds-global-header__search input',
              'input[type="search"]',
              'input[aria-label*="Search"]',
              'input[aria-label*="検索"]',
            ];
            let input = null;
            for (const sel of SEARCH_SELECTORS) {
              input = document.querySelector(sel);
              if (input) break;
            }
            if (input) {
              input.focus();
              const setter = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set;
              setter.call(input, keyword);
              input.dispatchEvent(new Event('input', { bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keydown',  { key: 'Enter', keyCode: 13, bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', keyCode: 13, charCode: 13, bubbles: true }));
              input.dispatchEvent(new KeyboardEvent('keyup',    { key: 'Enter', keyCode: 13, bubbles: true }));
            } else {
              // 検索バーが見つからない場合は URL フォールバック
              chrome.storage.local.get(['instance_url'], (storageResult) => {
                const instanceUrl = storageResult.instance_url || window.location.origin;
                const url = buildSearchUrl(instanceUrl, keyword); // eslint-disable-line no-undef
                navigateTo(url); // eslint-disable-line no-undef
              });
            }
          }, 500);

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
