var cuid = require('cuid')
var redis = require('./redis')

var TARGETS_KEY = 'targets'

module.exports = {
  createTarget,
  validateTargetData,
  getAllTargets
}

function createTarget (targetData, cb) {
  var target = {
    id: cuid(),
    url: targetData.url,
    value: targetData.value,
    maxAcceptsPerDay: targetData.maxAcceptsPerDay,
    accept: targetData.accept,
    createdAt: new Date().toISOString()
  }

  redis.hset(TARGETS_KEY, target.id, JSON.stringify(target), function (err) {
    if (err) return cb(err)
    cb(null, target)
  })
}

function validateTargetData (data) {
  if (!data.url) return new Error('Missing required field: url')
  if (!data.value) return new Error('Missing required field: value')
  if (!data.maxAcceptsPerDay) return new Error('Missing required field: maxAcceptsPerDay')
  if (!data.accept) return new Error('Missing required field: accept')
  return null
}

function getAllTargets (cb) {
  redis.hgetall(TARGETS_KEY, function (err, data) {
    if (err) return cb(err)

    if (!data) return cb(null, [])

    var targets = []
    Object.keys(data).forEach(function (key) {
      try {
        targets.push(JSON.parse(data[key]))
      } catch (parseErr) {
        // Skip malformed data
      }
    })

    // Sort by creation date (newest first)
    targets.sort(function (a, b) {
      return new Date(b.createdAt) - new Date(a.createdAt)
    })

    cb(null, targets)
  })
}
