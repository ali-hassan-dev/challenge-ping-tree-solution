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

function createTarget (targetData, callback) {
  var validationError = validateTargetData(targetData)
  if (validationError) {
    return handleError(validationError, 400, callback)
  }

  var target = buildNewTarget(targetData)

  redis.hset(TARGETS_KEY, target.id, JSON.stringify(target), function (redisError) {
    if (redisError) return handleError(redisError, 500, callback)
    callback(null, target)
  })
}

function getAllTargets (callback) {
  redis.hgetall(TARGETS_KEY, function (redisError, redisData) {
    if (redisError) return handleError(redisError, 500, callback)
    if (!redisData) return callback(null, [])

    var parsedTargets = parseTargetsFromRedis(redisData)
    var sortedTargets = sortTargetsByCreationDate(parsedTargets)

    callback(null, sortedTargets)
  })
}

function getTargetById (targetId, callback) {
  if (!targetId) {
    return handleError(new Error('Target ID is required'), 400, callback)
  }

  redis.hget(TARGETS_KEY, targetId, function (redisError, targetData) {
    if (redisError) return handleError(redisError, 500, callback)
    if (!targetData) return handleError(new Error('Target not found'), 404, callback)

    var parsedTarget = parseTargetData(targetData)
    if (!parsedTarget) {
      return handleError(new Error('Invalid target data in storage'), 500, callback)
    }

    callback(null, parsedTarget)
  })
}

function updateTarget (targetId, updateData, callback) {
  if (!targetId) {
    return handleError(new Error('Target ID is required'), 400, callback)
  }

  var validationError = validateUpdateData(updateData)
  if (validationError) {
    return handleError(validationError, 400, callback)
  }

  getExistingTarget(targetId, function (error, existingTarget) {
    if (error) return callback(error)

    var updatedTarget = mergeTargetData(existingTarget, updateData)
    saveUpdatedTarget(targetId, updatedTarget, callback)
  })
}

function makeDecision (visitorData, callback) {
  if (!visitorData) {
    return handleError(new Error('Visitor information is required'), 400, callback)
  }

  var validationError = validateVisitorInfo(visitorData)
  if (validationError) {
    return handleError(validationError, 400, callback)
  }

  getAllTargets(function (error, allTargets) {
    if (error) return callback(error)
    if (!allTargets || allTargets.length === 0) {
      return callback(null, { decision: 'reject' })
    }

    processDecisionForTargets(allTargets, visitorData, callback)
  })
}

function buildNewTarget (targetData) {
  return {
    id: cuid(),
    url: targetData.url,
    value: targetData.value,
    maxAcceptsPerDay: targetData.maxAcceptsPerDay,
    accept: targetData.accept,
    createdAt: new Date().toISOString()
  }
}

function parseTargetsFromRedis (redisData) {
  var parsedTargets = []
  Object.keys(redisData).forEach(function (key) {
    var target = parseTargetData(redisData[key])
    if (target) parsedTargets.push(target)
  })
  return parsedTargets
}

function parseTargetData (jsonString) {
  try {
    return JSON.parse(jsonString)
  } catch (parseError) {
    console.warn('Malformed target data found in Redis:', parseError.message)
    return null
  }
}

function sortTargetsByCreationDate (targets) {
  return targets.sort(function (targetA, targetB) {
    return new Date(targetB.createdAt) - new Date(targetA.createdAt)
  })
}

function getExistingTarget (targetId, callback) {
  redis.hget(TARGETS_KEY, targetId, function (redisError, targetData) {
    if (redisError) return handleError(redisError, 500, callback)
    if (!targetData) return handleError(new Error('Target not found'), 404, callback)

    var parsedTarget = parseTargetData(targetData)
    if (!parsedTarget) {
      return handleError(new Error('Invalid existing target data'), 500, callback)
    }

    callback(null, parsedTarget)
  })
}

function mergeTargetData (existingTarget, updateData) {
  return {
    id: existingTarget.id,
    url: updateData.url || existingTarget.url,
    value: updateData.value || existingTarget.value,
    maxAcceptsPerDay: updateData.maxAcceptsPerDay || existingTarget.maxAcceptsPerDay,
    accept: updateData.accept || existingTarget.accept,
    createdAt: existingTarget.createdAt,
    updatedAt: new Date().toISOString()
  }
}

function saveUpdatedTarget (targetId, updatedTarget, callback) {
  redis.hset(TARGETS_KEY, targetId, JSON.stringify(updatedTarget), function (redisError) {
    if (redisError) return handleError(redisError, 500, callback)
    callback(null, updatedTarget)
  })
}

function processDecisionForTargets (allTargets, visitorData, callback) {
  filterEligibleTargets(allTargets, visitorData, function (error, eligibleTargets) {
    if (error) return callback(error)
    if (eligibleTargets.length === 0) {
      return callback(null, { decision: 'reject' })
    }

    var bestTarget = selectBestTarget(eligibleTargets)
    var visitorDateString = extractDateFromTimestamp(visitorData.timestamp)

    trackAcceptForTarget(bestTarget.id, visitorDateString, function (trackError) {
      if (trackError) return callback(trackError)

      callback(null, {
        decision: 'accept',
        url: bestTarget.url
      })
    })
  })
}

function selectBestTarget (eligibleTargets) {
  // Sort by value (highest first), then by creation date for tie-breaking
  var sortedTargets = eligibleTargets.sort(function (targetA, targetB) {
    var valueA = parseFloat(targetA.value)
    var valueB = parseFloat(targetB.value)

    if (valueB !== valueA) {
      return valueB - valueA
    }

    // Tie-breaker: prefer newer targets (created later)
    return new Date(targetB.createdAt) - new Date(targetA.createdAt)
  })

  return sortedTargets[0]
}

function extractDateFromTimestamp (timestamp) {
  return new Date(timestamp).toISOString().split('T')[0]
}

function validateVisitorInfo (visitorData) {
  if (!visitorData.geoState) return new Error('Missing required field: geoState')
  if (!visitorData.publisher) return new Error('Missing required field: publisher')
  if (!visitorData.timestamp) return new Error('Missing required field: timestamp')

  var timestamp = new Date(visitorData.timestamp)
  if (isNaN(timestamp.getTime())) {
    return new Error('Invalid timestamp format')
  }

  return null
}

function filterEligibleTargets (allTargets, visitorData, callback) {
  var timestamp = new Date(visitorData.timestamp)
  var hourString = timestamp.getUTCHours().toString()
  var dateString = timestamp.toISOString().split('T')[0]

  var eligibleTargets = []
  var processedCount = 0
  var hasCalledBack = false

  if (allTargets.length === 0) {
    return callback(null, [])
  }

  allTargets.forEach(function (target) {
    var eligibilityOptions = {
      target,
      visitorData,
      hourString,
      dateString
    }

    checkTargetEligibility(eligibilityOptions, function (error, isEligible) {
      if (hasCalledBack) return

      if (error) {
        hasCalledBack = true
        return callback(error)
      }

      if (isEligible) {
        eligibleTargets.push(target)
      }

      processedCount++
      if (processedCount === allTargets.length) {
        hasCalledBack = true
        callback(null, eligibleTargets)
      }
    })
  })
}

function checkTargetEligibility (options, callback) {
  var acceptCriteria = options.target.accept || {}

  if (!isGeoStateEligible(acceptCriteria, options.visitorData.geoState)) {
    return callback(null, false)
  }

  if (!isHourEligible(acceptCriteria, options.hourString)) {
    return callback(null, false)
  }

  checkDailyAcceptLimit(options.target, options.dateString, callback)
}

function isGeoStateEligible (acceptCriteria, visitorGeoState) {
  if (!acceptCriteria.geoState || !acceptCriteria.geoState.$in) {
    return true
  }
  return acceptCriteria.geoState.$in.includes(visitorGeoState)
}

function isHourEligible (acceptCriteria, hourString) {
  if (!acceptCriteria.hour || !acceptCriteria.hour.$in) {
    return true
  }
  return acceptCriteria.hour.$in.includes(hourString)
}

function checkDailyAcceptLimit (target, dateString, callback) {
  getAcceptCountForDate(target.id, dateString, function (error, currentAcceptCount) {
    if (error) return callback(error)

    var maxAcceptsAllowed = parseInt(target.maxAcceptsPerDay, 10)
    var isUnderLimit = currentAcceptCount < maxAcceptsAllowed

    callback(null, isUnderLimit)
  })
}

function getAcceptCountForDate (targetId, dateString, callback) {
  var redisKey = buildAcceptCountKey(targetId, dateString)

  redis.get(redisKey, function (redisError, countValue) {
    if (redisError) return handleError(redisError, 500, callback)
    callback(null, parseInt(countValue, 10) || 0)
  })
}

function trackAcceptForTarget (targetId, dateString, callback) {
  var redisKey = buildAcceptCountKey(targetId, dateString)

  redis.incr(redisKey, function (incrementError, newCount) {
    if (incrementError) return handleError(incrementError, 500, callback)

    setKeyExpiration(redisKey, callback)
  })
}

function buildAcceptCountKey (targetId, dateString) {
  return ACCEPTS_KEY + ':' + targetId + ':' + dateString
}

function setKeyExpiration (redisKey, callback) {
  var expirationSeconds = 24 * 60 * 60 // 24 hours in seconds

  redis.expire(redisKey, expirationSeconds, function (expireError) {
    if (expireError) return handleError(expireError, 500, callback)
    callback(null)
  })
}

function validateTargetData (targetData) {
  if (!targetData.url) return new Error('Missing required field: url')
  if (!targetData.value) return new Error('Missing required field: value')
  if (!targetData.maxAcceptsPerDay) return new Error('Missing required field: maxAcceptsPerDay')
  if (!targetData.accept) return new Error('Missing required field: accept')
  return null
}

function validateUpdateData (updateData) {
  if (!updateData || Object.keys(updateData).length === 0) {
    return new Error('Update data cannot be empty')
  }

  var allowedFields = ['url', 'value', 'maxAcceptsPerDay', 'accept']
  var hasValidField = allowedFields.some(function (fieldName) {
    return Object.hasOwnProperty.call(updateData, fieldName)
  })

  if (!hasValidField) {
    return new Error('At least one valid field (url, value, maxAcceptsPerDay, accept) must be provided')
  }

  return null
}

function handleError (error, statusCode, callback) {
  error.statusCode = statusCode
  callback(error)
}
