'use strict';

const { defineConfig } = require('@playwright/test');
const path = require('path');

module.exports = defineConfig({
  testDir: '__tests__/playwright',
  timeout: 30000,
  use: {
    headless: false, // 拡張機能はheadlessでは動かない
  },
  projects: [
    {
      name: 'chrome-extension',
      use: {
        channel: 'chromium',
        launchOptions: {
          args: [
            `--disable-extensions-except=${path.resolve(__dirname, 'dist')}`,
            `--load-extension=${path.resolve(__dirname, 'dist')}`,
          ],
        },
      },
    },
  ],
});
