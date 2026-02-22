'use strict';

const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const instanceUrlEl = document.getElementById('instance-url');
const connectForm = document.getElementById('connect-form');
const disconnectSection = document.getElementById('disconnect-section');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');
const clientIdInput = document.getElementById('client-id-input');
const clientSecretInput = document.getElementById('client-secret-input');
const instanceUrlInput = document.getElementById('instance-url-input');

function updateUI(isConnected, instanceUrl) {
  if (isConnected) {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = '接続済み';
    instanceUrlEl.textContent = instanceUrl || '';
    instanceUrlEl.style.display = instanceUrl ? 'block' : 'none';
    connectForm.style.display = 'none';
    disconnectSection.style.display = 'block';
  } else {
    statusBadge.className = 'status-badge disconnected';
    statusText.textContent = '未接続';
    instanceUrlEl.style.display = 'none';
    connectForm.style.display = 'block';
    disconnectSection.style.display = 'none';
  }
}

function loadStatus() {
  chrome.storage.local.get(['instance_url'], (result) => {
    const isConnected = !!result.instance_url;
    updateUI(isConnected, result.instance_url);
  });
}

connectBtn.addEventListener('click', () => {
  const clientId = clientIdInput.value.trim();
  const clientSecret = clientSecretInput.value.trim();
  const instanceUrl = instanceUrlInput.value.trim() || 'https://login.salesforce.com';

  // バリデーション
  if (!clientId) {
    clientIdInput.style.borderColor = 'rgb(239, 68, 68)';
    clientIdInput.focus();
    return;
  }
  clientIdInput.style.borderColor = '';

  chrome.runtime.sendMessage(
    { type: 'CONNECT_SALESFORCE', clientId, clientSecret, instanceUrl },
    (response) => {
      if (response && response.success) {
        loadStatus();
      } else {
        const err = response && response.error ? response.error : '接続に失敗しました';
        statusText.textContent = `エラー: ${err}`;
      }
    }
  );
});

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'DISCONNECT_SALESFORCE' }, () => {
    updateUI(false, null);
  });
});

loadStatus();

// 現在のショートカットキーを動的に表示
chrome.commands.getAll((commands) => {
  const cmd = commands.find(c => c.name === 'toggle-voice');
  const el = document.getElementById('shortcut-key');
  if (cmd && cmd.shortcut) {
    el.textContent = cmd.shortcut;
    el.classList.remove('unset');
  } else {
    el.textContent = '未設定';
  }
});

// chrome://extensions/shortcuts を開いてカスタマイズ画面へ誘導
document.getElementById('customize-shortcut-btn').addEventListener('click', () => {
  chrome.tabs.create({ url: 'chrome://extensions/shortcuts' });
});
