module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/__tests__'],
  testMatch: ['**/*.test.js'],
  testPathIgnorePatterns: [
    '/node_modules/',
    '__tests__/prompt/' // プロンプトテストはCIでは除外・手動実行のみ
  ],
  collectCoverageFrom: [
    'lib/**/*.js',
    'ui/**/*.js',
    '!**/node_modules/**'
  ],
  coverageThreshold: {
    global: {
      branches: 70,
      functions: 80,
      lines: 80,
      statements: 80
    }
  },
  setupFiles: ['<rootDir>/__tests__/setup.js'],
  moduleNameMapper: {
    '^@lib/(.*)$': '<rootDir>/lib/$1',
    '^@ui/(.*)$': '<rootDir>/ui/$1'
  }
};
