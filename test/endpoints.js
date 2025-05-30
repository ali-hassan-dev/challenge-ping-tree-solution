process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')
var redis = require('../lib/redis')
var constants = require('../lib/constants')

var API_URLS = constants.API_URLS
var TEST_DATA = constants.TEST_DATA
var ERROR_MESSAGES = constants.ERROR_MESSAGES

// Clear Redis before each test
test.beforeEach.cb(function (t) {
  redis.flushdb(function (err) {
    if (err) return t.end(err)
    t.end()
  })
})

test.serial.cb('healthcheck', function (t) {
  servertest(server(), API_URLS.HEALTH, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.status, 'OK', 'status is ok')
    t.end()
  })
})

test.serial.cb('POST /api/targets - creates a new target', function (t) {
  var targetData = Object.assign({}, TEST_DATA.TARGET_BASIC)
  var opts = { method: 'POST', encoding: 'json' }

  servertest(server(), API_URLS.TARGETS, opts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 201, 'correct statusCode')

    var target = res.body
    validateTargetResponse(t, target, targetData)
    t.end()
  }).end(JSON.stringify(targetData))
})

test.serial.cb('GET /api/targets - returns empty array when no targets exist', function (t) {
  servertest(server(), API_URLS.TARGETS, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.true(Array.isArray(res.body), 'should return an array')
    t.is(res.body.length, 0, 'should return empty array')
    t.end()
  })
})

test.serial.cb('GET /api/targets - returns all created targets', function (t) {
  var targetData1 = Object.assign({}, TEST_DATA.TARGET_SIMPLE)
  var targetData2 = Object.assign({}, TEST_DATA.TARGET_HIGH_VALUE)

  createTarget(targetData1, function (err, res1) {
    t.falsy(err, 'no error creating first target')
    t.is(res1.statusCode, 201, 'first target created')

    createTarget(targetData2, function (err, res2) {
      t.falsy(err, 'no error creating second target')
      t.is(res2.statusCode, 201, 'second target created')

      servertest(server(), API_URLS.TARGETS, { encoding: 'json' }, function (err, res) {
        t.falsy(err, 'no error getting targets')
        t.is(res.statusCode, 200, 'correct statusCode')
        t.true(Array.isArray(res.body), 'should return an array')
        t.is(res.body.length, 2, 'should return both targets')

        validateTargetsListResponse(t, res.body, [targetData1, targetData2])
        t.end()
      })
    })
  })
})

test.serial.cb('GET /api/target/:id - returns target by id', function (t) {
  var targetData = Object.assign({}, TEST_DATA.TARGET_BASIC)

  createTarget(targetData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    var getUrl = API_URLS.TARGET_BY_ID + createdTarget.id

    servertest(server(), getUrl, { encoding: 'json' }, function (err, res) {
      t.falsy(err, 'no error getting target by id')
      t.is(res.statusCode, 200, 'correct statusCode')

      var target = res.body
      t.is(target.id, createdTarget.id, 'should have correct id')
      validateTargetFields(t, target, targetData)
      t.end()
    })
  })
})

test.serial.cb('GET /api/target/:id - returns 404 for non-existent target', function (t) {
  var nonExistentId = 'non-existent-id'
  var url = API_URLS.TARGET_BY_ID + nonExistentId

  servertest(server(), url, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 404, 'correct statusCode')
    t.is(res.body.error, ERROR_MESSAGES.TARGET_NOT_FOUND, 'correct error message')
    t.end()
  })
})

test.serial.cb('GET /api/target/:id - returns 400 for empty id', function (t) {
  servertest(server(), API_URLS.TARGET_BY_ID, { encoding: 'json' }, function (err, res) {
    t.falsy(err, 'no error')
    t.true(res.statusCode === 400 || res.statusCode === 404, 'should return 400 or 404')
    t.end()
  })
})

test.serial.cb('POST /api/targets - returns 400 for missing required fields', function (t) {
  var opts = { method: 'POST', encoding: 'json' }

  servertest(server(), API_URLS.TARGETS, opts, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  }).end(JSON.stringify({}))
})

test.serial.cb('POST /api/target/:id - updates target successfully', function (t) {
  var originalData = Object.assign({}, TEST_DATA.TARGET_BASIC)
  var updateData = {
    url: 'http://updated-example.com',
    value: '0.75',
    maxAcceptsPerDay: '15'
  }

  createTarget(originalData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    updateTarget(createdTarget.id, updateData, function (err, res) {
      t.falsy(err, 'no error updating target')
      t.is(res.statusCode, 200, 'correct statusCode')

      var updatedTarget = res.body
      validateTargetUpdate(t, updatedTarget, createdTarget, updateData, originalData)
      t.end()
    })
  })
})

test.serial.cb('POST /api/target/:id - updates only provided fields', function (t) {
  var originalData = Object.assign({}, TEST_DATA.TARGET_SIMPLE)
  var partialUpdateData = { value: '0.99' }

  createTarget(originalData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    updateTarget(createdTarget.id, partialUpdateData, function (err, res) {
      t.falsy(err, 'no error updating target')
      t.is(res.statusCode, 200, 'correct statusCode')

      var updatedTarget = res.body
      validatePartialTargetUpdate(t, updatedTarget, createdTarget, partialUpdateData, originalData)
      t.end()
    })
  })
})

test.serial.cb('POST /api/target/:id - returns 404 for non-existent target', function (t) {
  var nonExistentId = 'non-existent-id'
  var updateData = { value: '0.75' }

  updateTarget(nonExistentId, updateData, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 404, 'correct statusCode')
    t.is(res.body.error, ERROR_MESSAGES.TARGET_NOT_FOUND, 'correct error message')
    t.end()
  })
})

test.serial.cb('POST /api/target/:id - returns 400 for empty update data', function (t) {
  var originalData = Object.assign({}, TEST_DATA.TARGET_SIMPLE)

  createTarget(originalData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    updateTarget(createdTarget.id, {}, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 400, 'correct statusCode')
      t.truthy(res.body.error, 'should have error message')
      t.end()
    })
  })
})

test.serial.cb('POST /api/target/:id - returns 400 for invalid update fields', function (t) {
  var originalData = Object.assign({}, TEST_DATA.TARGET_SIMPLE)
  var invalidUpdateData = { invalidField: 'invalid' }

  createTarget(originalData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created successfully')

    var createdTarget = createRes.body
    updateTarget(createdTarget.id, invalidUpdateData, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 400, 'correct statusCode')
      t.truthy(res.body.error, 'should have error message')
      t.end()
    })
  })
})

test.serial.cb('POST /route - accepts visitor matching target criteria', function (t) {
  var targetData = Object.assign({}, TEST_DATA.TARGET_BASIC)
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_VALID)

  createTarget(targetData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    routeVisitor(visitorInfo, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'accept', 'should accept visitor')
      t.is(res.body.url, targetData.url, 'should return target url')
      t.end()
    })
  })
})

test.serial.cb('POST /route - rejects visitor not matching geoState criteria', function (t) {
  var targetData = Object.assign({}, TEST_DATA.TARGET_BASIC)
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_INVALID_STATE)

  createTarget(targetData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    routeVisitor(visitorInfo, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'reject', 'should reject visitor')
      t.falsy(res.body.url, 'should not return url')
      t.end()
    })
  })
})

test.serial.cb('POST /route - rejects visitor not matching hour criteria', function (t) {
  var targetData = Object.assign({}, TEST_DATA.TARGET_BASIC)
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_INVALID_HOUR)

  createTarget(targetData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    routeVisitor(visitorInfo, function (err, res) {
      t.falsy(err, 'no error')
      t.is(res.statusCode, 200, 'correct statusCode')
      t.is(res.body.decision, 'reject', 'should reject visitor')
      t.falsy(res.body.url, 'should not return url')
      t.end()
    })
  })
})

test.serial.cb('POST /route - returns highest value target when multiple match', function (t) {
  var targetData1 = Object.assign({}, TEST_DATA.TARGET_SIMPLE)
  var targetData2 = {
    url: 'http://example2.com',
    value: '0.75',
    maxAcceptsPerDay: '10',
    accept: { geoState: { $in: ['ca'] } }
  }
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_VALID)

  createTarget(targetData1, function (err, res1) {
    t.falsy(err, 'no error creating first target')
    t.is(res1.statusCode, 201, 'first target created')

    createTarget(targetData2, function (err, res2) {
      t.falsy(err, 'no error creating second target')
      t.is(res2.statusCode, 201, 'second target created')

      routeVisitor(visitorInfo, function (err, res) {
        t.falsy(err, 'no error')
        t.is(res.statusCode, 200, 'correct statusCode')
        t.is(res.body.decision, 'accept', 'should accept visitor')
        t.is(res.body.url, targetData2.url, 'should return highest value target url')
        t.end()
      })
    })
  })
})

test.serial.cb('POST /route - rejects when target exceeds daily limit', function (t) {
  var targetData = {
    url: 'http://example.com',
    value: '0.50',
    maxAcceptsPerDay: '1',
    accept: { geoState: { $in: ['ca'] } }
  }
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_VALID)

  createTarget(targetData, function (err, createRes) {
    t.falsy(err, 'no error creating target')
    t.is(createRes.statusCode, 201, 'target created')

    routeVisitor(visitorInfo, function (err, res1) {
      t.falsy(err, 'no error on first request')
      t.is(res1.statusCode, 200, 'correct statusCode')
      t.is(res1.body.decision, 'accept', 'should accept first visitor')

      routeVisitor(visitorInfo, function (err, res2) {
        t.falsy(err, 'no error on second request')
        t.is(res2.statusCode, 200, 'correct statusCode')
        t.is(res2.body.decision, 'reject', 'should reject second visitor')
        t.falsy(res2.body.url, 'should not return url')
        t.end()
      })
    })
  })
})

test.serial.cb('POST /route - rejects when no targets exist', function (t) {
  var visitorInfo = Object.assign({}, TEST_DATA.VISITOR_VALID)

  routeVisitor(visitorInfo, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 200, 'correct statusCode')
    t.is(res.body.decision, 'reject', 'should reject when no targets')
    t.falsy(res.body.url, 'should not return url')
    t.end()
  })
})

test.serial.cb('POST /route - returns 400 for missing required fields', function (t) {
  var incompleteVisitorInfo = { geoState: 'ca' }

  routeVisitor(incompleteVisitorInfo, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  })
})

test.serial.cb('POST /route - returns 400 for invalid timestamp', function (t) {
  var invalidVisitorInfo = {
    geoState: 'ca',
    publisher: 'abc',
    timestamp: 'invalid-timestamp'
  }

  routeVisitor(invalidVisitorInfo, function (err, res) {
    t.falsy(err, 'no error')
    t.is(res.statusCode, 400, 'correct statusCode')
    t.truthy(res.body.error, 'should have error message')
    t.end()
  })
})

function createTarget (targetData, callback) {
  var opts = { method: 'POST', encoding: 'json' }
  servertest(server(), API_URLS.TARGETS, opts, callback).end(JSON.stringify(targetData))
}

function updateTarget (targetId, updateData, callback) {
  var url = API_URLS.TARGET_BY_ID + targetId
  var opts = { method: 'POST', encoding: 'json' }
  servertest(server(), url, opts, callback).end(JSON.stringify(updateData))
}

function routeVisitor (visitorInfo, callback) {
  var opts = { method: 'POST', encoding: 'json' }
  servertest(server(), API_URLS.ROUTE, opts, callback).end(JSON.stringify(visitorInfo))
}

function validateTargetResponse (t, target, targetData) {
  t.truthy(target.id, 'should have an id')
  validateTargetFields(t, target, targetData)
  t.truthy(target.createdAt, 'should have createdAt timestamp')
}

function validateTargetFields (t, target, targetData) {
  t.is(target.url, targetData.url, 'should have correct url')
  t.is(target.value, targetData.value, 'should have correct value')
  t.is(target.maxAcceptsPerDay, targetData.maxAcceptsPerDay, 'should have correct maxAcceptsPerDay')
  t.deepEqual(target.accept, targetData.accept, 'should have correct accept criteria')
}

function validateTargetsListResponse (t, targets, expectedTargets) {
  var urls = targets.map(function (target) { return target.url })
  expectedTargets.forEach(function (expectedTarget) {
    t.true(urls.includes(expectedTarget.url), 'should include target: ' + expectedTarget.url)
  })

  targets.forEach(function (target) {
    validateTargetStructure(t, target)
  })
}

function validateTargetStructure (t, target) {
  t.truthy(target.id, 'target should have id')
  t.truthy(target.url, 'target should have url')
  t.truthy(target.value, 'target should have value')
  t.truthy(target.maxAcceptsPerDay, 'target should have maxAcceptsPerDay')
  t.truthy(target.accept, 'target should have accept')
  t.truthy(target.createdAt, 'target should have createdAt')
}

function validateTargetUpdate (t, updatedTarget, createdTarget, updateData, originalData) {
  t.is(updatedTarget.id, createdTarget.id, 'should have same id')
  t.is(updatedTarget.url, updateData.url, 'should have updated url')
  t.is(updatedTarget.value, updateData.value, 'should have updated value')
  t.is(updatedTarget.maxAcceptsPerDay, updateData.maxAcceptsPerDay, 'should have updated maxAcceptsPerDay')
  t.deepEqual(updatedTarget.accept, originalData.accept, 'should keep original accept criteria')
  t.is(updatedTarget.createdAt, createdTarget.createdAt, 'should keep original createdAt')
  t.truthy(updatedTarget.updatedAt, 'should have updatedAt timestamp')
}

function validatePartialTargetUpdate (t, updatedTarget, createdTarget, partialUpdateData, originalData) {
  t.is(updatedTarget.id, createdTarget.id, 'should have same id')
  t.is(updatedTarget.url, originalData.url, 'should keep original url')
  t.is(updatedTarget.value, partialUpdateData.value, 'should have updated value')
  t.is(updatedTarget.maxAcceptsPerDay, originalData.maxAcceptsPerDay, 'should keep original maxAcceptsPerDay')
  t.deepEqual(updatedTarget.accept, originalData.accept, 'should keep original accept criteria')
  t.is(updatedTarget.createdAt, createdTarget.createdAt, 'should keep original createdAt')
  t.truthy(updatedTarget.updatedAt, 'should have updatedAt timestamp')
}
