'use strict';

/**
 * scripts/generate-test-audio.js
 *
 * macOS の `say` コマンドで自動テスト用の音声ファイルを生成する。
 *
 * 使い方:
 *   node scripts/generate-test-audio.js
 *
 * 出力先: __tests__/audio/*.wav
 * 形式: 16kHz mono WAV（webkitSpeechRecognition に最適）
 *
 * 注意:
 *   - macOS 専用（CI では実行しない）
 *   - 生成した .wav は git に含める（CI不要でどこでも再利用可能）
 *   - 日本語音声: Kyoko ボイス（macOS 標準）
 */

const { execSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const OUT_DIR = path.resolve(__dirname, '../__tests__/audio');
fs.mkdirSync(OUT_DIR, { recursive: true });

// 生成する音声フレーズ一覧
// [ファイル名, 発話テキスト, 期待される認識結果（参考）]
const PHRASES = [
  // ── ナビゲーション ──────────────────────────────────────────────
  ['navigate-opportunity-list',       '商談一覧を開いて',             'navigate Opportunity'],
  ['navigate-account-list',           '取引先一覧を開いて',           'navigate Account'],
  ['navigate-lead-list',              'リード一覧を開いて',           'navigate Lead'],
  ['navigate-contact-list',           '取引先責任者一覧を開いて',     'navigate Contact'],
  ['navigate-opportunity-all',        'すべての商談を開いて',         'navigate Opportunity (All)'],
  ['navigate-opportunity-recent',     '最近参照した商談を開いて',     'navigate Opportunity (RecentlyViewed)'],
  ['navigate-opportunity-mine',       '自分の商談を開いて',           'navigate Opportunity (MyOpportunities)'],
  // ── コマンド ────────────────────────────────────────────────────
  ['command-back',                    '戻って',                       'back'],
  ['command-yes',                     'はい',                         'confirm true'],
  ['command-no',                      'いいえ',                       'confirm false'],
  ['command-undo',                    '元に戻して',                   'undo'],
  ['command-stop',                    '止めて',                       'stop'],
  ['command-select-1',                '1番',                          'select index:1'],
  ['command-select-3',                '3番',                          'select index:3'],
];

const VOICE = 'Kyoko';        // macOS 日本語ボイス
const RATE = 150;             // 話速（デフォルト 175）
const FORMAT = 'LEF32@16000'; // 32bit float PCM 16kHz（Chrome が好む形式）

let generated = 0;
let skipped = 0;

for (const [filename, phrase, description] of PHRASES) {
  const outPath = path.join(OUT_DIR, `${filename}.wav`);

  if (fs.existsSync(outPath)) {
    console.log(`  skip  ${filename}.wav  (already exists)`);
    skipped++;
    continue;
  }

  try {
    execSync(
      `say --voice='${VOICE}' --rate=${RATE} --data-format='${FORMAT}' -o '${outPath}' '${phrase}'`,
      { stdio: 'pipe' }
    );
    console.log(`  ✓     ${filename}.wav  → 「${phrase}」  [${description}]`);
    generated++;
  } catch (err) {
    console.error(`  ✗     ${filename}.wav  → ${err.message}`);
  }
}

console.log(`\n完了: ${generated} 件生成, ${skipped} 件スキップ`);
console.log(`出力先: ${OUT_DIR}`);
