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
  let toggleCooldown = false;   // 連続押し防止（500ms デバウンス）

  // Cloudflare Worker URL（LLM フォールバック用）
  // デプロイ後は実際のURLに更新してください
  const WORKER_URL = 'https://voiceforce-worker.iwasatat0107.workers.dev';

  // オブジェクト日本語ラベル
  const SF_OBJECT_LABELS = {
    'Account':     '取引先',
    'Contact':     '取引先責任者',
    'Lead':        'リード',
    'Opportunity': '商談',
    'Task':        'ToDo',
  };

  // フィールド日本語ラベル（代表的な標準フィールド）
  const SF_FIELD_LABELS = {
    'Name':         '取引先名',
    'Phone':        '電話番号',
    'Industry':     '業種',
    'BillingState': '都道府県',
    'FirstName':    '名',
    'LastName':     '姓',
    'Email':        'メールアドレス',
    'Company':      '会社名',
    'StageName':    'フェーズ',
    'CloseDate':    '完了予定日',
    'Amount':       '金額',
    'Subject':      'タイトル',
    'Status':       'ステータス',
    'ActivityDate': '期日',
    'AccountId':    '取引先',
    'WhoId':        '関連する人',
    'WhatId':       '関連するレコード',
  };

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
  // isRetry=true の場合は再検索後も0件なら error で終了（EDITING ループ防止）
  const runSearch = async function(keyword, sfObject, isRetry) {
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
          if (isRetry) {
            // 再検索後も0件 → 検索不一致メッセージで終了（EDITING ループなし）
            w.setState('success', { message: `検索不一致：「${keyword}」は見つかりませんでした` });
          } else {
            // 初回0件 → EDITING 状態でキーワードを手動修正して再検索できるようにする
            w.setState('editing', {
              keyword,
              sfObject,
              onConfirm: (correctedKeyword, correctedObject) => {
                runSearch(correctedKeyword, correctedObject, true);
              },
              onCancel: () => { w.setState('idle'); },
            });
          }
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
          w.setState('error', { message: '接続が切れました\n① ツールバーの 🍤 をクリック\n② 「接続を解除」→「Salesforceに接続」' });
          setTimeout(() => w.setState('idle'), 6000);
        } else {
          w.setState('error', { message: err.message || '検索中にエラーが発生しました' });
          setTimeout(() => w.setState('idle'), 3000);
        }
      }
    });
  };

  // アクセストークン取得ヘルパー
  const getToken = function() {
    return new Promise((tokenRes, tokenRej) => {
      chrome.runtime.sendMessage({ type: 'GET_VALID_TOKEN' }, (r) => {
        if (chrome.runtime.lastError) {
          tokenRej(new Error(chrome.runtime.lastError.message));
          return;
        }
        if (r && r.success) { tokenRes(r.token); return; }
        tokenRej(new Error(r?.error || 'トークン取得に失敗しました'));
      });
    });
  };

  // トークンエラー判定・ウィジェット表示ヘルパー
  const handleApiError = function(err) {
    const w = getWidget();
    const isTokenErr = !err.message ||
      err.message.includes('セッション') || err.message.includes('トークン') ||
      err.message.includes('token') || err.message.includes('Receiving end') ||
      err.message.includes('message channel') || err.message.includes('closed') ||
      err.message.includes('unauthorized') || err.message.includes('INVALID_SESSION');
    if (isTokenErr) {
      w.setState('error', { message: '接続が切れました\n① ツールバーの 🍤 をクリック\n② 「接続を解除」→「Salesforceに接続」' });
      setTimeout(() => w.setState('idle'), 6000);
    } else {
      w.setState('error', { message: err.message || 'エラーが発生しました' });
      setTimeout(() => w.setState('idle'), 3000);
    }
  };

  // レコード作成実行（API コール → 成功なら作成レコードに遷移）
  const executeCreate = function(sfObject, fields) {
    const w = getWidget();
    w.setState('processing', { message: '作成中...' });
    chrome.storage.local.get(['instance_url'], async (result) => {
      const instanceUrl = result.instance_url || window.location.origin;
      try {
        const token = await getToken();
        const sfResult = await createRecord(instanceUrl, token, sfObject, fields); // eslint-disable-line no-undef
        const url = buildRecordUrl(instanceUrl, sfObject, sfResult.id); // eslint-disable-line no-undef
        const label = SF_OBJECT_LABELS[sfObject] || sfObject;
        w.setState('success', { message: `${label}を作成しました` });
        setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
      } catch (err) {
        console.warn('[VF] createRecord error:', err.message, err.sfErrorCode);
        if (err.sfErrorCode === 'REQUIRED_FIELD_MISSING') {
          w.setState('error', { message: `必須項目が不足しています\n${err.message || ''}` });
          setTimeout(() => w.setState('idle'), 5000);
        } else if (err.sfErrorCode === 'DUPLICATES_DETECTED') {
          w.setState('confirm', {
            message: '似たレコードがすでに存在します\nそれでも作成しますか？',
            onConfirm: (confirmed) => {
              if (!confirmed) { w.setState('idle'); return; }
              executeCreate(sfObject, Object.assign({}, fields, { AllowSave: true }));
            },
          });
        } else if (err.sfErrorCode === 'FIELD_CUSTOM_VALIDATION_EXCEPTION') {
          w.setState('error', { message: `入力規則エラー:\n${err.message}` });
          setTimeout(() => w.setState('idle'), 5000);
        } else {
          handleApiError(err);
        }
      }
    });
  };

  // 確認画面を表示してから作成実行
  const showCreateConfirm = function(sfObject, fields) {
    const w = getWidget();
    const label = SF_OBJECT_LABELS[sfObject] || sfObject;
    const fieldSummary = Object.entries(fields)
      .map(([k, v]) => `${SF_FIELD_LABELS[k] || k}: ${v}`)
      .join('\n');
    w.setState('confirm', {
      message: `${label}を作成します\n─────\n${fieldSummary}\n─────\n「はい」で確定`,
      onConfirm: (confirmed) => {
        if (!confirmed) { w.setState('idle'); return; }
        executeCreate(sfObject, fields);
      },
    });
  };

  // LLM create アクション処理
  const handleCreate = function(llmIntent) {
    const w = getWidget();
    const sfObject = llmIntent.object;
    if (!sfObject) {
      w.setState('error', { message: '作成するオブジェクトが認識できませんでした\n「ヘルプ」と言うと使い方を確認できます' });
      setTimeout(() => w.setState('idle'), 4000);
      return;
    }

    const fields = llmIntent.fields || {};
    const missingFields = llmIntent.missing_fields || [];

    if (missingFields.length > 0) {
      const label = SF_OBJECT_LABELS[sfObject] || sfObject;
      w.setState('field-input', {
        message: `${label}に必要な情報を入力してください`,
        fields: missingFields.map((key) => ({
          label: SF_FIELD_LABELS[key] || key,
          key,
          value: fields[key] || '',
        })),
        onSubmit: (values) => {
          const allFields = Object.assign({}, fields);
          Object.entries(values).forEach(([k, v]) => { if (v) allFields[k] = v; });
          showCreateConfirm(sfObject, allFields);
        },
        onCancel: () => { w.setState('idle'); },
      });
    } else {
      showCreateConfirm(sfObject, fields);
    }
  };

  const SPEECH_ERROR_MESSAGES = {
    'not-allowed':         'マイクのアクセスを許可してください',
    'audio-capture':       'マイクが使用できません',
    'network':             'ネットワークエラーが発生しました',
    'service-not-allowed': '音声認識サービスが利用できません',
  };

  const toggleVoice = function() {
    // 連続押し・キーリピートを無視（500ms デバウンス）
    if (toggleCooldown) return;
    toggleCooldown = true;
    setTimeout(() => { toggleCooldown = false; }, 500);

    const w = getWidget();
    if (!w) return;

    const state = w.getState();

    if (state === 'listening') {
      if (speech) speech.stop();
      w.setState('idle');
      return;
    }

    // 処理中は割り込みしない
    if (state === 'processing') return;

    // 候補選択中にトグルされたら候補リストをクリアして再スタート
    if (state === 'selecting') {
      const cl = getCandidateList();
      if (cl) cl.hide();
      pendingCandidates = null;
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

        } else if (intent && intent.action === 'help') {
          const HELP_TEXT = [
            '── 一覧を開く ──',
            '「商談」「取引先」「リード」',
            '「すべての商談を開いて」',
            '「最近の商談を開いて」',
            '「自分の商談を開いて」',
            '',
            '── レコードを検索 ──',
            '「田中商事の商談を開いて」',
            '「ABC株式会社を見せて」',
            '「取引先でABCを検索して」',
            '',
            '── 候補が複数のとき ──',
            '「1番」〜「5番」でレコードを選択',
            '',
            '── その他 ──',
            '「戻って」「戻る」「バック」',
            '「ヘルプ」でこの画面を再表示',
          ].join('\n');
          // duration: null で自動消滅しない（ユーザーが読み終えるまで表示）
          w.setState('success', { message: HELP_TEXT, duration: null });

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
          // ruleEngine にマッチしない → LLM（intentResolver）にフォールバック
          w.setState('processing', { message: 'AI解析中...' });
          const userId = chrome.runtime.id;
          const llmTimeout = new Promise((_, reject) =>
            setTimeout(() => {
              const e = new Error('timeout');
              e.isTimeout = true;
              reject(e);
            }, 10000)
          );
          Promise.race([
            resolveIntent(transcript, '', WORKER_URL, userId), // eslint-disable-line no-undef
            llmTimeout,
          ])
            .then((llmIntent) => {
              if (!validateLLMOutput(llmIntent, null)) { // eslint-disable-line no-undef
                w.setState('error', {
                  message: '解析に失敗しました\n「ヘルプ」と言うと使い方を確認できます',
                });
                setTimeout(() => w.setState('idle'), 4000);
                return;
              }
              if (llmIntent.action === 'navigate' && llmIntent.target === 'list') {
                chrome.storage.local.get(['instance_url'], (result) => {
                  const instanceUrl = result.instance_url || window.location.origin;
                  const url = buildListUrl(instanceUrl, llmIntent.object, llmIntent.filterName); // eslint-disable-line no-undef
                  w.setState('success', { message: llmIntent.message || '一覧を開きます' });
                  setTimeout(() => navigateTo(url), 1000); // eslint-disable-line no-undef
                });
              } else if (llmIntent.action === 'search') {
                const keyword = llmIntent.search_term || llmIntent.keyword;
                const sfObject = llmIntent.object || 'Account';
                if (keyword) {
                  runSearch(keyword, sfObject);
                } else {
                  w.setState('error', {
                    message: '検索キーワードが認識できませんでした\nもう一度お試しください',
                  });
                  setTimeout(() => w.setState('idle'), 3000);
                }
              } else if (llmIntent.action === 'unknown' || llmIntent.confidence < 0.5) {
                w.setState('error', {
                  message: llmIntent.message ||
                    `「${transcript}」は認識できませんでした\n「ヘルプ」と言うと使い方を確認できます`,
                });
                setTimeout(() => w.setState('idle'), 4000);
              } else if (llmIntent.action === 'create') {
                handleCreate(llmIntent);
              } else {
                // update / summary → 近日対応予定
                w.setState('error', {
                  message: 'この機能は近日対応予定です\n「ヘルプ」と言うと使い方を確認できます',
                });
                setTimeout(() => w.setState('idle'), 4000);
              }
            })
            .catch((err) => {
              if (err.isTimeout) {
                w.setState('error', {
                  message: '応答に時間がかかっています\nもう一度お試しください',
                });
              } else if (err.status === 429) {
                w.setState('error', {
                  message: '本日の音声解析の利用上限（10回）に達しました',
                });
              } else {
                w.setState('error', {
                  message: '解析に失敗しました\n「ヘルプ」と言うと使い方を確認できます',
                });
              }
              setTimeout(() => w.setState('idle'), 4000);
            });
        }
      },
      onError: (err) => {
        stopKeepalive();
        // aborted / no-speech はユーザー操作や無音によるもので正常終了扱い
        if (err === 'aborted' || err === 'no-speech') {
          if (w.getState() !== 'idle') w.setState('idle');
          return;
        }
        const msg = SPEECH_ERROR_MESSAGES[err] || '音声認識エラーが発生しました';
        w.setState('error', { message: msg });
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
