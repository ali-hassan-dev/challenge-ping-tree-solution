module.exports = {
  API_URLS: {
    HEALTH: '/health',
    TARGETS: '/api/targets',
    TARGET_BY_ID: '/api/target/',
    ROUTE: '/route'
  },
  TEST_DATA: {
    TARGET_BASIC: {
      url: 'http://example.com',
      value: '0.50',
      maxAcceptsPerDay: '10',
      accept: {
        geoState: {
          $in: ['ca', 'ny']
        },
        hour: {
          $in: ['13', '14', '15']
        }
      }
    },
    TARGET_SIMPLE: {
      url: 'http://example1.com',
      value: '0.50',
      maxAcceptsPerDay: '10',
      accept: { geoState: { $in: ['ca'] } }
    },
    TARGET_HIGH_VALUE: {
      url: 'http://example2.com',
      value: '0.75',
      maxAcceptsPerDay: '15',
      accept: { geoState: { $in: ['ny'] } }
    },
    VISITOR_VALID: {
      geoState: 'ca',
      publisher: 'abc',
      timestamp: '2018-07-19T14:28:59.513Z'
    },
    VISITOR_INVALID_STATE: {
      geoState: 'tx',
      publisher: 'abc',
      timestamp: '2018-07-19T14:28:59.513Z'
    },
    VISITOR_INVALID_HOUR: {
      geoState: 'ca',
      publisher: 'abc',
      timestamp: '2018-07-19T10:28:59.513Z'
    }
  },
  ERROR_MESSAGES: {
    TARGET_NOT_FOUND: 'Target not found'
  }
}
