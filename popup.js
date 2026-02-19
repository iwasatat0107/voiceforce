'use strict';

const statusBadge = document.getElementById('status-badge');
const statusText = document.getElementById('status-text');
const instanceUrlEl = document.getElementById('instance-url');
const connectBtn = document.getElementById('connect-btn');
const disconnectBtn = document.getElementById('disconnect-btn');

async function updateUI(isConnected, instanceUrl) {
  if (isConnected) {
    statusBadge.className = 'status-badge connected';
    statusText.textContent = '接続済み';
    instanceUrlEl.textContent = instanceUrl || '';
    instanceUrlEl.style.display = instanceUrl ? 'block' : 'none';
    connectBtn.style.display = 'none';
    disconnectBtn.style.display = 'block';
  } else {
    statusBadge.className = 'status-badge disconnected';
    statusText.textContent = '未接続';
    instanceUrlEl.style.display = 'none';
    connectBtn.style.display = 'block';
    disconnectBtn.style.display = 'none';
  }
}

async function loadStatus() {
  chrome.storage.local.get(['instance_url'], (result) => {
    const isConnected = !!result.instance_url;
    updateUI(isConnected, result.instance_url);
  });
}

connectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'CONNECT_SALESFORCE' });
});

disconnectBtn.addEventListener('click', () => {
  chrome.runtime.sendMessage({ type: 'DISCONNECT_SALESFORCE' }, () => {
    updateUI(false, null);
  });
});

loadStatus();
