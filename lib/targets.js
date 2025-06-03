var cuid = require('cuid')

var redis = require('./redis')

var TARGETS_KEY = 'targets'
var ACCEPTS_KEY = 'accepts'
var EXPIRATION_SECONDS = 24 * 60 * 60
var REQUIRED_TARGET_FIELDS = ['url', 'value', 'maxAcceptsPerDay', 'accept']
var UPDATABLE_FIELDS = ['url', 'value', 'maxAcceptsPerDay', 'accept']
var REQUIRED_VISITOR_FIELDS = ['geoState', 'publisher', 'timestamp']

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
  saveTargetToRedis(target, callback)
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

  fetchTargetFromRedis(targetId, callback)
}

function updateTarget (targetId, updateData, callback) {
  if (!targetId) {
    return handleError(new Error('Target ID is required'), 400, callback)
  }

  var validationError = validateUpdateData(updateData)
  if (validationError) {
    return handleError(validationError, 400, callback)
  }

  processTargetUpdate(targetId, updateData, callback)
}

function makeDecision (visitorData, callback) {
  if (!visitorData) {
    return handleError(
      new Error('Visitor information is required'),
      400,
      callback
    )
  }

  var validationError = validateVisitorData(visitorData)
  if (validationError) {
    return handleError(validationError, 400, callback)
  }

  processVisitorDecision(visitorData, callback)
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

function saveTargetToRedis (target, callback) {
  redis.hset(
    TARGETS_KEY,
    target.id,
    JSON.stringify(target),
    function (redisError) {
      if (redisError) return handleError(redisError, 500, callback)
      callback(null, target)
    }
  )
}

function fetchTargetFromRedis (targetId, callback) {
  redis.hget(TARGETS_KEY, targetId, function (redisError, targetData) {
    if (redisError) return handleError(redisError, 500, callback)
    if (!targetData) {
      return handleError(new Error('Target not found'), 404, callback)
    }

    var parsedTarget = parseTargetData(targetData)
    if (!parsedTarget) {
      return handleError(
        new Error('Invalid target data in storage'),
        500,
        callback
      )
    }

    callback(null, parsedTarget)
  })
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

function processTargetUpdate (targetId, updateData, callback) {
  fetchTargetFromRedis(targetId, function (error, existingTarget) {
    if (error) return callback(error)

    var updatedTarget = mergeTargetData(existingTarget, updateData)
    saveUpdatedTarget(targetId, updatedTarget, callback)
  })
}

function mergeTargetData (existingTarget, updateData) {
  return {
    id: existingTarget.id,
    url: updateData.url || existingTarget.url,
    value: updateData.value || existingTarget.value,
    maxAcceptsPerDay:
      updateData.maxAcceptsPerDay || existingTarget.maxAcceptsPerDay,
    accept: updateData.accept || existingTarget.accept,
    createdAt: existingTarget.createdAt,
    updatedAt: new Date().toISOString()
  }
}

function saveUpdatedTarget (targetId, updatedTarget, callback) {
  redis.hset(
    TARGETS_KEY,
    targetId,
    JSON.stringify(updatedTarget),
    function (redisError) {
      if (redisError) return handleError(redisError, 500, callback)
      callback(null, updatedTarget)
    }
  )
}

function processVisitorDecision (visitorData, callback) {
  getAllTargets(function (error, allTargets) {
    if (error) return callback(error)
    if (!allTargets || allTargets.length === 0) {
      return callback(null, { decision: 'reject' })
    }

    findEligibleTargets(allTargets, visitorData, callback)
  })
}

function findEligibleTargets (allTargets, visitorData, callback) {
  var filterOptions = buildFilterOptions(visitorData)
  processTargetsAsync(allTargets, filterOptions, function (error, eligible) {
    if (error) return callback(error)
    if (eligible.length === 0) {
      return callback(null, { decision: 'reject' })
    }

    selectAndTrackTarget(eligible, filterOptions.dateString, callback)
  })
}

function buildFilterOptions (visitorData) {
  var timestamp = new Date(visitorData.timestamp)
  return {
    visitorData,
    hourString: timestamp.getUTCHours().toString(),
    dateString: timestamp.toISOString().split('T')[0]
  }
}

function processTargetsAsync (targets, filterOptions, callback) {
  var eligibleTargets = []
  var processedCount = 0
  var hasCalledBack = false

  if (targets.length === 0) return callback(null, [])

  targets.forEach(function (target) {
    checkSingleTargetEligibility(
      target,
      filterOptions,
      function (error, isEligible) {
        if (hasCalledBack) return

        if (error) {
          hasCalledBack = true
          return callback(error)
        }

        if (isEligible) eligibleTargets.push(target)

        processedCount++
        if (processedCount === targets.length) {
          hasCalledBack = true
          callback(null, eligibleTargets)
        }
      }
    )
  })
}

function checkSingleTargetEligibility (target, filterOptions, callback) {
  var acceptCriteria = target.accept || {}
  var visitorData = filterOptions.visitorData

  if (!isGeoStateEligible(acceptCriteria, visitorData.geoState)) {
    return callback(null, false)
  }

  if (!isHourEligible(acceptCriteria, filterOptions.hourString)) {
    return callback(null, false)
  }

  checkDailyAcceptLimit(target, filterOptions.dateString, callback)
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
  getAcceptCountForDate(
    target.id,
    dateString,
    function (error, currentAcceptCount) {
      if (error) return callback(error)

      var maxAcceptsAllowed = parseInt(target.maxAcceptsPerDay, 10)
      var isUnderLimit = currentAcceptCount < maxAcceptsAllowed
      callback(null, isUnderLimit)
    }
  )
}

function selectAndTrackTarget (eligibleTargets, dateString, callback) {
  var bestTarget = selectBestTarget(eligibleTargets)
  trackAcceptForTarget(bestTarget.id, dateString, function (trackError) {
    if (trackError) return callback(trackError)

    callback(null, {
      decision: 'accept',
      url: bestTarget.url
    })
  })
}

function selectBestTarget (eligibleTargets) {
  var sortedTargets = eligibleTargets.sort(function (targetA, targetB) {
    var valueA = parseFloat(targetA.value)
    var valueB = parseFloat(targetB.value)

    if (valueB !== valueA) return valueB - valueA

    return new Date(targetB.createdAt) - new Date(targetA.createdAt)
  })

  return sortedTargets[0]
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
  redis.expire(redisKey, EXPIRATION_SECONDS, function (expireError) {
    if (expireError) return handleError(expireError, 500, callback)
    callback(null)
  })
}

function validateTargetData (targetData) {
  var missingFieldError = validateRequiredFields(
    targetData,
    REQUIRED_TARGET_FIELDS
  )
  if (missingFieldError) return missingFieldError

  return validateNumericFields(targetData)
}

function validateUpdateData (updateData) {
  if (!updateData || Object.keys(updateData).length === 0) {
    return new Error('Update data cannot be empty')
  }

  var hasValidField = UPDATABLE_FIELDS.some(function (fieldName) {
    return Object.hasOwnProperty.call(updateData, fieldName)
  })

  if (!hasValidField) {
    return new Error(
      'At least one valid field ' +
      '(url, value, maxAcceptsPerDay, accept) must be provided'
    )
  }

  return validateNumericFields(updateData)
}

function validateVisitorData (visitorData) {
  var missingFieldError = validateRequiredFields(
    visitorData,
    REQUIRED_VISITOR_FIELDS
  )
  if (missingFieldError) return missingFieldError

  var timestamp = new Date(visitorData.timestamp)
  if (isNaN(timestamp.getTime())) {
    return new Error('Invalid timestamp format')
  }

  return null
}

function validateRequiredFields (data, requiredFields) {
  for (var i = 0; i < requiredFields.length; i++) {
    var field = requiredFields[i]
    if (!data[field]) {
      return new Error('Missing required field: ' + field)
    }
  }
  return null
}

function validateNumericFields (data) {
  if (data.value !== undefined) {
    var parsedValue = parseFloat(data.value)
    if (isNaN(parsedValue) || parsedValue < 0) {
      return new Error('Value must be a valid positive number')
    }
  }

  if (data.maxAcceptsPerDay !== undefined) {
    var parsedMaxAccepts = parseInt(data.maxAcceptsPerDay, 10)
    if (isNaN(parsedMaxAccepts) || parsedMaxAccepts <= 0) {
      return new Error('maxAcceptsPerDay must be a valid positive integer')
    }
  }

  return null
}

function handleError (error, statusCode, callback) {
  error.statusCode = statusCode
  callback(error)
}
