'use strict';

const fs = require('fs');
const path = require('path');
const { execSync } = require('child_process');

const SRC_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(SRC_DIR, 'dist');
const packageJson = JSON.parse(fs.readFileSync(path.join(SRC_DIR, 'package.json'), 'utf8'));
const version = packageJson.version;
const outputFile = path.join(SRC_DIR, `dist/voiceforce-v${version}.zip`);

if (!fs.existsSync(DIST_DIR)) {
  console.error('dist/ が見つかりません。先に npm run build を実行してください。');
  process.exit(1);
}

// dist/ 内のファイルをZIPに圧縮（zip コマンドを使用）
try {
  execSync(`cd "${DIST_DIR}" && zip -r "${outputFile}" . --exclude "*.zip"`, { stdio: 'inherit' });
  console.warn('Package created:', outputFile);
} catch (err) {
  console.error('Package creation failed:', err.message);
  process.exit(1);
}
