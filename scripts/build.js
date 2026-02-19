'use strict';

const fs = require('fs');
const path = require('path');

const SRC_DIR = path.resolve(__dirname, '..');
const DIST_DIR = path.resolve(SRC_DIR, 'dist');

function copyFile(src, dest) {
  const destDir = path.dirname(dest);
  fs.mkdirSync(destDir, { recursive: true });
  fs.copyFileSync(src, dest);
}

function copyDir(srcDir, destDir) {
  if (!fs.existsSync(srcDir)) return;
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const srcPath = path.join(srcDir, entry.name);
    const destPath = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyDir(srcPath, destPath);
    } else {
      copyFile(srcPath, destPath);
    }
  }
}

// dist/ をクリーン
if (fs.existsSync(DIST_DIR)) {
  fs.rmSync(DIST_DIR, { recursive: true });
}
fs.mkdirSync(DIST_DIR);

// ルートファイルをコピー
const rootFiles = ['manifest.json', 'background.js', 'content.js', 'content.css', 'popup.html', 'popup.js'];
for (const file of rootFiles) {
  const src = path.join(SRC_DIR, file);
  if (fs.existsSync(src)) {
    copyFile(src, path.join(DIST_DIR, file));
  }
}

// lib/, ui/, icons/, _locales/ をコピー
for (const dir of ['lib', 'ui', 'icons', '_locales']) {
  copyDir(path.join(SRC_DIR, dir), path.join(DIST_DIR, dir));
}

console.warn('Build complete:', DIST_DIR);
