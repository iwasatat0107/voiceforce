'use strict';

// Content Script: 音声認識・UIオーバーレイ・Salesforce操作
// 各機能は Step 4（音声認識）、Step 5（ウィジェットUI）以降で実装する

// Salesforce のページでのみ動作する
const isSalesforceUrl = /\.(salesforce|force|lightning\.force)\.com/.test(window.location.hostname);

if (isSalesforceUrl) {
  // Step 5 で ui/widget.js のウィジェットを初期化
  // Step 4 で lib/speechRecognition.js の音声認識を初期化
}
