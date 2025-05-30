var cuid = require('cuid')
var redis = require('./redis')

var TARGETS_KEY = 'targets'
var ACCEPTS_KEY = 'accepts'

module.exports = {
  createTarget,
  getAllTargets,
  getTargetById,
  updateTarget,
  makeDecision
}

function createTarget (targetData, cb) {
  // Validate data first
  var validationError = validateTargetData(targetData)
  if (validationError) {
    validationError.statusCode = 400
    return cb(validationError)
  }

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

function getTargetById (id, cb) {
  if (!id) {
    var err = new Error('Target ID is required')
    err.statusCode = 400
    return cb(err)
  }

  redis.hget(TARGETS_KEY, id, function (err, data) {
    if (err) return cb(err)

    if (!data) {
      var notFoundErr = new Error('Target not found')
      notFoundErr.statusCode = 404
      return cb(notFoundErr)
    }

    try {
      var target = JSON.parse(data)
      cb(null, target)
    } catch (parseErr) {
      var parseError = new Error('Invalid target data')
      parseError.statusCode = 500
      cb(parseError)
    }
  })
}

function updateTarget (id, updateData, cb) {
  if (!id) {
    var err = new Error('Target ID is required')
    err.statusCode = 400
    return cb(err)
  }

  // First check if target exists
  redis.hget(TARGETS_KEY, id, function (err, existingData) {
    if (err) return cb(err)

    if (!existingData) {
      var notFoundErr = new Error('Target not found')
      notFoundErr.statusCode = 404
      return cb(notFoundErr)
    }

    try {
      var existingTarget = JSON.parse(existingData)
    } catch (parseErr) {
      var parseError = new Error('Invalid existing target data')
      parseError.statusCode = 500
      return cb(parseError)
    }

    // Validate update data
    var validationError = validateUpdateData(updateData)
    if (validationError) {
      validationError.statusCode = 400
      return cb(validationError)
    }

    // Create updated target by merging existing with new data
    var updatedTarget = {
      id: existingTarget.id,
      url: updateData.url || existingTarget.url,
      value: updateData.value || existingTarget.value,
      maxAcceptsPerDay: updateData.maxAcceptsPerDay || existingTarget.maxAcceptsPerDay,
      accept: updateData.accept || existingTarget.accept,
      createdAt: existingTarget.createdAt,
      updatedAt: new Date().toISOString()
    }

    // Save updated target to Redis
    redis.hset(TARGETS_KEY, id, JSON.stringify(updatedTarget), function (err) {
      if (err) return cb(err)
      cb(null, updatedTarget)
    })
  })
}

function makeDecision (visitorInfo, cb) {
  if (!visitorInfo) {
    var err = new Error('Visitor information is required')
    err.statusCode = 400
    return cb(err)
  }

  var validationError = validateVisitorInfo(visitorInfo)
  if (validationError) {
    validationError.statusCode = 400
    return cb(validationError)
  }

  getAllTargets(function (err, targets) {
    if (err) return cb(err)

    if (!targets || targets.length === 0) {
      return cb(null, { decision: 'reject' })
    }

    filterEligibleTargets(targets, visitorInfo, function (err, eligibleTargets) {
      if (err) return cb(err)

      if (eligibleTargets.length === 0) {
        return cb(null, { decision: 'reject' })
      }

      // Sort by value (highest first) and return the best target
      eligibleTargets.sort(function (a, b) {
        return parseFloat(b.value) - parseFloat(a.value)
      })

      var bestTarget = eligibleTargets[0]

      // Track the accept using visitor's timestamp
      var visitorDate = new Date(visitorInfo.timestamp).toISOString().split('T')[0]
      trackAccept(bestTarget.id, visitorDate, function (err) {
        if (err) return cb(err)

        cb(null, {
          decision: 'accept',
          url: bestTarget.url
        })
      })
    })
  })
}

function validateVisitorInfo (visitorInfo) {
  if (!visitorInfo.geoState) return new Error('Missing required field: geoState')
  if (!visitorInfo.publisher) return new Error('Missing required field: publisher')
  if (!visitorInfo.timestamp) return new Error('Missing required field: timestamp')

  // Validate timestamp format
  var timestamp = new Date(visitorInfo.timestamp)
  if (isNaN(timestamp.getTime())) {
    return new Error('Invalid timestamp format')
  }

  return null
}

function filterEligibleTargets (targets, visitorInfo, cb) {
  var timestamp = new Date(visitorInfo.timestamp)
  var hour = timestamp.getUTCHours().toString()
  var today = timestamp.toISOString().split('T')[0]

  var eligibleTargets = []
  var processed = 0
  var hasCalledBack = false

  if (targets.length === 0) {
    return cb(null, [])
  }

  targets.forEach(function (target) {
    checkTargetEligibility({
      target,
      visitorInfo,
      hour,
      today
    }, function (err, isEligible) {
      if (hasCalledBack) return

      if (err) {
        hasCalledBack = true
        return cb(err)
      }

      if (isEligible) {
        eligibleTargets.push(target)
      }

      processed++
      if (processed === targets.length) {
        hasCalledBack = true
        cb(null, eligibleTargets)
      }
    })
  })
}

function checkTargetEligibility (options, cb) {
  // Check accept criteria
  var accept = options.target.accept || {}

  // Check geoState criteria
  if (accept.geoState && accept.geoState.$in) {
    if (!accept.geoState.$in.includes(options.visitorInfo.geoState)) {
      return cb(null, false)
    }
  }

  // Check hour criteria
  if (accept.hour && accept.hour.$in) {
    if (!accept.hour.$in.includes(options.hour)) {
      return cb(null, false)
    }
  }

  // Check daily accept limit
  getAcceptCountForTargetToday(options.target.id, options.today, function (err, acceptCount) {
    if (err) return cb(err)

    var maxAccepts = parseInt(options.target.maxAcceptsPerDay, 10)
    var isUnderLimit = acceptCount < maxAccepts

    cb(null, isUnderLimit)
  })
}

function getAcceptCountForTargetToday (targetId, today, cb) {
  var key = ACCEPTS_KEY + ':' + targetId + ':' + today

  redis.get(key, function (err, count) {
    if (err) return cb(err)
    cb(null, parseInt(count, 10) || 0)
  })
}

function trackAccept (targetId, date, cb) {
  var key = ACCEPTS_KEY + ':' + targetId + ':' + date

  redis.incr(key, function (err, newCount) {
    if (err) return cb(err)

    // Set expiration to end of day (86400 seconds = 24 hours)
    redis.expire(key, 86400, function (expireErr) {
      if (expireErr) return cb(expireErr)
      cb(null, newCount)
    })
  })
}

function validateTargetData (data) {
  if (!data.url) return new Error('Missing required field: url')
  if (!data.value) return new Error('Missing required field: value')
  if (!data.maxAcceptsPerDay) return new Error('Missing required field: maxAcceptsPerDay')
  if (!data.accept) return new Error('Missing required field: accept')
  return null
}

function validateUpdateData (data) {
  if (!data || Object.keys(data).length === 0) {
    return new Error('Update data cannot be empty')
  }

  // At least one field must be provided for update
  var allowedFields = ['url', 'value', 'maxAcceptsPerDay', 'accept']
  var hasValidField = allowedFields.some(function (field) {
    return Object.hasOwn(data, field)
  })

  if (!hasValidField) {
    return new Error('At least one valid field (url, value, maxAcceptsPerDay, accept) must be provided')
  }

  return null
}
