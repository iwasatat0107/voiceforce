module.exports = {
  env: {
    browser: true,
    es2021: true,
    webextensions: true
  },
  extends: [
    'eslint:recommended'
  ],
  parserOptions: {
    ecmaVersion: 'latest',
    sourceType: 'module'
  },
  rules: {
    'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    'no-console': ['warn', { allow: ['warn', 'error'] }],
    'eqeqeq': 'error',
    'no-eval': 'error',
    'no-implied-eval': 'error',
    'no-new-func': 'error',
    'no-script-url': 'error'
  },
  globals: {
    chrome: 'readonly',
    webkitSpeechRecognition: 'readonly',
    module: 'writable',         // lib/*.js の CommonJS 互換エクスポートパターン
    importScripts: 'readonly'   // Service Worker の importScripts()
  },
  overrides: [
    {
      // Node.js ファイル（設定ファイル・スクリプト）
      files: ['.eslintrc.js', 'jest.config.js', 'scripts/**/*.js', 'worker/**/*.js'],
      env: {
        browser: false,
        node: true,
        es2021: true
      },
      parserOptions: {
        sourceType: 'commonjs'
      }
    },
    {
      // テストファイルとモック
      files: ['__tests__/**/*.js'],
      env: {
        browser: true,
        node: true,
        jest: true,
        es2021: true
      },
      parserOptions: {
        sourceType: 'commonjs'
      }
    }
  ]
};
