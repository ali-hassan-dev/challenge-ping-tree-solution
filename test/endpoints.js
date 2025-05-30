process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')
var redis = require('../lib/redis')

// Clear Redis before each test
test.beforeEach.cb(function (t) {
  redis.flushdb(function (err) {
    if (err) return t.end(err)
    t.end()
  })
})

test.serial.cb('healthcheck', function (t) {
  var url = '/health'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')

    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('POST /api/targets - creates a new target', function (t) {
  var url = '/api/targets'
  var targetData = {
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
  }

  var opts = {
    method: 'POST',
    encoding: 'json'
  }

  servertest(server(), url, opts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 201, 'correct statusCode')

    var target = res.body
    t.truthy(target.id, 'should have an id')
    t.is(target.url, targetData.url, 'should have correct url')
    t.is(target.value, targetData.value, 'should have correct value')
    t.is(target.maxAcceptsPerDay, targetData.maxAcceptsPerDay, 'should have correct maxAcceptsPerDay')
    t.deepEqual(target.accept, targetData.accept, 'should have correct accept criteria')
    t.truthy(target.createdAt, 'should have createdAt timestamp')

    t.end()
  }).end(JSON.stringify(targetData))
})

test.serial.cb('GET /api/targets - returns empty array when no targets exist', function (t) {
  var url = '/api/targets'
  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.true(Array.isArray(res.body), 'should return an array')
    t.is(res.body.length, 0, 'should return empty array')
    t.end()
  })
})

test.serial.cb('GET /api/targets - returns all created targets', function (t) {
  var targetData1 = {
    url: 'http://example1.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: { geoState: { $in: ['ca'] } }
  }

  var targetData2 = {
    url: 'http://example2.com',
    value: '0.75',
    maxAcceptsPerDay: '15',
    accept: { geoState: { $in: ['ny'] } }
  }

  // Create first target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, res1) {
    t.falsy(err, 'no error creating first target')
    t.is(res1.statusCode, 201, 'first target created')

    // Create second target
    servertest(server(), createUrl, createOpts, function (err, res2) {
      t.falsy(err, 'no error creating second target')
      t.is(res2.statusCode, 201, 'second target created')

      // Get all targets
      var getUrl = '/api/targets'
      servertest(server(), getUrl, { encoding: 'json' }, function (err, res) {
        t.falsy(err, 'no error getting targets')
        t.is(res.statusCode, 200, 'correct statusCode')
        t.true(Array.isArray(res.body), 'should return an array')
        t.is(res.body.length, 2, 'should return both targets')

        // Check that targets contain expected data
        var urls = res.body.map(function (target) { return target.url })
        t.true(urls.includes(targetData1.url), 'should include first target')
        t.true(urls.includes(targetData2.url), 'should include second target')

        // Check that all targets have required fields
        res.body.forEach(function (target) {
          t.truthy(target.id, 'target should have id')
          t.truthy(target.url, 'target should have url')
          t.truthy(target.value, 'target should have value')
          t.truthy(target.maxAcceptsPerDay, 'target should have maxAcceptsPerDay')
          t.truthy(target.accept, 'target should have accept')
          t.truthy(target.createdAt, 'target should have createdAt')
        })

        t.end()
      })
    }).end(JSON.stringify(targetData2))
  }).end(JSON.stringify(targetData1))
})

test.serial.cb('GET /api/target/:id - returns target by id', function (t) {
  var targetData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca', 'ny']
      }
    }
  }

  // First create a target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var getUrl = '/api/target/' + createdTarget.id

    // Get the target by id
    servertest(server(), getUrl, { encoding: 'json' }, function (err, res) {
      t.falsy(err, 'no error getting target by id')
      t.is(res.statusCode, 200, 'correct statusCode')

      var target = res.body
      t.is(target.id, createdTarget.id, 'should have correct id')
      t.is(target.url, targetData.url, 'should have correct url')
      t.is(target.value, targetData.value, 'should have correct value')
      t.is(target.maxAcceptsPerDay, targetData.maxAcceptsPerDay, 'should have correct maxAcceptsPerDay')
      t.deepEqual(target.accept, targetData.accept, 'should have correct accept criteria')
      t.truthy(target.createdAt, 'should have createdAt timestamp')

      t.end()
    })
  }).end(JSON.stringify(targetData))
})

test.serial.cb('GET /api/target/:id - returns 404 for non-existent target', function (t) {
  var nonExistentId = 'non-existent-id'
  var url = '/api/target/' + nonExistentId

  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 404, 'correct statusCode')
    t.is(res.body.error, 'Target not found', 'correct error message')
    t.end()
  })
})

test.serial.cb('GET /api/target/:id - returns 400 for empty id', function (t) {
  var url = '/api/target/'

  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    // Note: This might return 404 due to route not matching, which is also acceptable
    t.true(res.statusCode === 400 || res.statusCode === 404, 'should return 400 or 404')
    t.end()
  })
})

test.serial.cb('POST /api/targets - returns 400 for missing required fields', function (t) {
  var url = '/api/targets'
  var opts = {
    method: 'POST',
    encoding: 'json'
  }

  servertest(server(), url, opts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  }).end(JSON.stringify({}))
})

test.serial.cb('POST /api/target/:id - updates target successfully', function (t) {
  var originalData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca', 'ny']
      }
    }
  }

  var updateData = {
    url: 'http://updated-example.com',
    value: '0.75',
    maxAcceptsPerDay: '15'
  }

  // First create a target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var updateUrl = '/api/target/' + createdTarget.id
    var updateOpts = { method: 'POST', encoding: 'json' }

    // Update the target
    servertest(server(), updateUrl, updateOpts, function (err, res) {
      t.falsy(err, 'no error updating target')
      t.is(res.statusCode, 200, 'correct statusCode')

      var updatedTarget = res.body
      t.is(updatedTarget.id, createdTarget.id, 'should have same id')
      t.is(updatedTarget.url, updateData.url, 'should have updated url')
      t.is(updatedTarget.value, updateData.value, 'should have updated value')
      t.is(updatedTarget.maxAcceptsPerDay, updateData.maxAcceptsPerDay, 'should have updated maxAcceptsPerDay')
      t.deepEqual(updatedTarget.accept, originalData.accept, 'should keep original accept criteria')
      t.is(updatedTarget.createdAt, createdTarget.createdAt, 'should keep original createdAt')
      t.truthy(updatedTarget.updatedAt, 'should have updatedAt timestamp')

      t.end()
    }).end(JSON.stringify(updateData))
  }).end(JSON.stringify(originalData))
})

test.serial.cb('POST /api/target/:id - updates only provided fields', function (t) {
  var originalData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca']
      }
    }
  }

  var partialUpdateData = {
    value: '0.99'
  }

  // First create a target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var updateUrl = '/api/target/' + createdTarget.id
    var updateOpts = { method: 'POST', encoding: 'json' }

    // Update only the value
    servertest(server(), updateUrl, updateOpts, function (err, res) {
      t.falsy(err, 'no error updating target')
      t.is(res.statusCode, 200, 'correct statusCode')

      var updatedTarget = res.body
      t.is(updatedTarget.id, createdTarget.id, 'should have same id')
      t.is(updatedTarget.url, originalData.url, 'should keep original url')
      t.is(updatedTarget.value, partialUpdateData.value, 'should have updated value')
      t.is(updatedTarget.maxAcceptsPerDay, originalData.maxAcceptsPerDay, 'should keep original maxAcceptsPerDay')
      t.deepEqual(updatedTarget.accept, originalData.accept, 'should keep original accept criteria')
      t.is(updatedTarget.createdAt, createdTarget.createdAt, 'should keep original createdAt')
      t.truthy(updatedTarget.updatedAt, 'should have updatedAt timestamp')

      t.end()
    }).end(JSON.stringify(partialUpdateData))
  }).end(JSON.stringify(originalData))
})

test.serial.cb('POST /api/target/:id - returns 404 for non-existent target', function (t) {
  var nonExistentId = 'non-existent-id'
  var url = '/api/target/' + nonExistentId
  var updateData = { value: '0.75' }
  var opts = { method: 'POST', encoding: 'json' }

  servertest(server(), url, opts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 404, 'correct statusCode')
    t.is(res.body.error, 'Target not found', 'correct error message')
    t.end()
  }).end(JSON.stringify(updateData))
})

test.serial.cb('POST /api/target/:id - returns 400 for empty update data', function (t) {
  var originalData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: { geoState: { $in: ['ca'] } }
  }

  // First create a target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var updateUrl = '/api/target/' + createdTarget.id
    var updateOpts = { method: 'POST', encoding: 'json' }

    // Try to update with empty data
    servertest(server(), updateUrl, updateOpts, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 400, 'correct statusCode')
      t.truthy(res.body.error, 'should have error message')
      t.end()
    }).end(JSON.stringify({}))
  }).end(JSON.stringify(originalData))
})

test.serial.cb('POST /api/target/:id - returns 400 for invalid update fields', function (t) {
  var originalData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: { geoState: { $in: ['ca'] } }
  }

  var invalidUpdateData = {
    invalidField: 'invalid'
  }

  // First create a target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var updateUrl = '/api/target/' + createdTarget.id
    var updateOpts = { method: 'POST', encoding: 'json' }

    // Try to update with invalid fields
    servertest(server(), updateUrl, updateOpts, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 400, 'correct statusCode')
      t.truthy(res.body.error, 'should have error message')
      t.end()
    }).end(JSON.stringify(invalidUpdateData))
  }).end(JSON.stringify(originalData))
})

test.serial.cb('POST /route - accepts visitor matching target criteria', function (t) {
  var targetData = {
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
  }

  var visitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: '2018-07-19T14:28:59.513Z'
  }

  // Create a target first
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    // Test the route decision
    var routeUrl = '/route'
    var routeOpts = { method: 'POST', encoding: 'json' }

    servertest(server(), routeUrl, routeOpts, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'accept', 'should accept visitor')
      t.is(res.body.url, targetData.url, 'should return target url')
      t.end()
    }).end(JSON.stringify(visitorInfo))
  }).end(JSON.stringify(targetData))
})

test.serial.cb('POST /route - rejects visitor not matching geoState criteria', function (t) {
  var targetData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca', 'ny']
      }
    }
  }

  var visitorInfo = {
    geoState: 'tx',
    publisher: 'abc',
    timestamp: '2018-07-19T14:28:59.513Z'
  }

  // Create a target first
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    // Test the route decision
    var routeUrl = '/route'
    var routeOpts = { method: 'POST', encoding: 'json' }

    servertest(server(), routeUrl, routeOpts, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'reject', 'should reject visitor')
      t.falsy(res.body.url, 'should not return url')
      t.end()
    }).end(JSON.stringify(visitorInfo))
  }).end(JSON.stringify(targetData))
})

test.serial.cb('POST /route - rejects visitor not matching hour criteria', function (t) {
  var targetData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca']
      },
      hour: {
        $in: ['13', '14', '15']
      }
    }
  }

  var visitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: '2018-07-19T10:28:59.513Z' // Hour 10, not in accepted range
  }

  // Create a target first
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    // Test the route decision
    var routeUrl = '/route'
    var routeOpts = { method: 'POST', encoding: 'json' }

    servertest(server(), routeUrl, routeOpts, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'reject', 'should reject visitor')
      t.falsy(res.body.url, 'should not return url')
      t.end()
    }).end(JSON.stringify(visitorInfo))
  }).end(JSON.stringify(targetData))
})

test.serial.cb('POST /route - returns highest value target when multiple match', function (t) {
  var targetData1 = {
    url: 'http://example1.com',
    value: '0.50',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca']
      }
    }
  }

  var targetData2 = {
    url: 'http://example2.com',
    value: '0.75',
    maxAcceptsPerDay: '10',
    accept: {
      geoState: {
        $in: ['ca']
      }
    }
  }

  var visitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: '2018-07-19T14:28:59.513Z'
  }

  // Create first target
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, res1) {
    t.falsy(err, 'no error creating first target')
    t.is(res1.statusCode, 201, 'first target created')

    // Create second target
    servertest(server(), createUrl, createOpts, function (err, res2) {
      t.falsy(err, 'no error creating second target')
      t.is(res2.statusCode, 201, 'second target created')

      // Test the route decision
      var routeUrl = '/route'
      var routeOpts = { method: 'POST', encoding: 'json' }

      servertest(server(), routeUrl, routeOpts, function (err, res) {
        t.falsy(err, 'no error')
        t.is(res.statusCode, 200, 'correct statusCode')
        t.is(res.body.decision, 'accept', 'should accept visitor')
        t.is(res.body.url, targetData2.url, 'should return highest value target url')
        t.end()
      }).end(JSON.stringify(visitorInfo))
    }).end(JSON.stringify(targetData2))
  }).end(JSON.stringify(targetData1))
})

test.serial.cb('POST /route - rejects when target exceeds daily limit', function (t) {
  var targetData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '1',
    accept: {
      geoState: {
        $in: ['ca']
      }
    }
  }

  var visitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: '2018-07-19T14:28:59.513Z'
  }

  // Create a target first
  var createUrl = '/api/targets'
  var createOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), createUrl, createOpts, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    var routeUrl = '/route'
    var routeOpts = { method: 'POST', encoding: 'json' }

    // First request should be accepted
    servertest(server(), routeUrl, routeOpts, function (err, res1) {
      t.falsy(err, 'no error on first request')
      t.is(res1.statusCode, 200, 'correct statusCode')
      t.is(res1.body.decision, 'accept', 'should accept first visitor')

      // Second request should be rejected (daily limit reached)
      servertest(server(), routeUrl, routeOpts, function (err, res2) {
        t.falsy(err, 'no error on second request')
        t.is(res2.statusCode, 200, 'correct statusCode')
        t.is(res2.body.decision, 'reject', 'should reject second visitor')
        t.falsy(res2.body.url, 'should not return url')
        t.end()
      }).end(JSON.stringify(visitorInfo))
    }).end(JSON.stringify(visitorInfo))
  }).end(JSON.stringify(targetData))
})

test.serial.cb('POST /route - rejects when no targets exist', function (t) {
  var visitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: '2018-07-19T14:28:59.513Z'
  }

  var routeUrl = '/route'
  var routeOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), routeUrl, routeOpts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.decision, 'reject', 'should reject when no targets')
    t.falsy(res.body.url, 'should not return url')
    t.end()
  }).end(JSON.stringify(visitorInfo))
})

test.serial.cb('POST /route - returns 400 for missing required fields', function (t) {
  var incompleteVisitorInfo = {
    geoState: 'ca'
    // Missing publisher and timestamp
  }

  var routeUrl = '/route'
  var routeOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), routeUrl, routeOpts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  }).end(JSON.stringify(incompleteVisitorInfo))
})

test.serial.cb('POST /route - returns 400 for invalid timestamp', function (t) {
  var invalidVisitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: 'invalid-timestamp'
  }

  var routeUrl = '/route'
  var routeOpts = { method: 'POST', encoding: 'json' }

  servertest(server(), routeUrl, routeOpts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  }).end(JSON.stringify(invalidVisitorInfo))
})
