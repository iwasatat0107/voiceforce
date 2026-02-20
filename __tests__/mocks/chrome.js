// Chrome Extension API モック
const chromeMock = {
  storage: {
    local: {
      get: jest.fn((keys, cb) => {
        if (cb) cb({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, cb) => {
        if (cb) cb();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, cb) => {
        if (cb) cb();
        return Promise.resolve();
      }),
      clear: jest.fn((cb) => {
        if (cb) cb();
        return Promise.resolve();
      })
    },
    session: {
      get: jest.fn((keys, cb) => {
        if (cb) cb({});
        return Promise.resolve({});
      }),
      set: jest.fn((items, cb) => {
        if (cb) cb();
        return Promise.resolve();
      }),
      remove: jest.fn((keys, cb) => {
        if (cb) cb();
        return Promise.resolve();
      })
    }
  },
  identity: {
    launchWebAuthFlow: jest.fn(),
    getRedirectURL: jest.fn((path) => `https://test.chromiumapp.org/${path}`)
  },
  tabs: {
    update: jest.fn(),
    query: jest.fn(),
    create: jest.fn()
  },
  runtime: {
    sendMessage: jest.fn(),
    onMessage: {
      addListener: jest.fn(),
      removeListener: jest.fn()
    },
    getURL: jest.fn((path) => `chrome-extension://test-extension-id/${path}`),
    id: 'test-extension-id',
    lastError: null
  },
  commands: {
    onCommand: {
      addListener: jest.fn()
    }
  }
};

module.exports = chromeMock;
