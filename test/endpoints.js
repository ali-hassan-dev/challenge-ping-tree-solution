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
