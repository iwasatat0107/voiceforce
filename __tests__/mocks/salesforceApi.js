'use strict';

// lib/salesforceApi.js の Jest モック
// recordResolver 等のテストで利用する

const salesforceApi = {
  sosl:         jest.fn(),
  soql:         jest.fn(),
  getRecord:    jest.fn(),
  createRecord: jest.fn(),
  updateRecord: jest.fn(),
  deleteRecord: jest.fn(),
  SF_ERROR_CODES: {
    TOKEN_EXPIRED:     'TOKEN_EXPIRED',
    PERMISSION_DENIED: 'PERMISSION_DENIED',
    RATE_LIMITED:      'RATE_LIMITED',
    CONFLICT:          'CONFLICT',
    NOT_FOUND:         'NOT_FOUND',
    SERVER_ERROR:      'SERVER_ERROR',
    UNKNOWN_ERROR:     'UNKNOWN_ERROR',
  },
};

module.exports = salesforceApi;
