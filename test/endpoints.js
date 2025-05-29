process.env.NODE_ENV = 'test'

var test = require('ava')
var servertest = require('servertest')

var server = require('../lib/server')

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
