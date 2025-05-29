var cuid = require('cuid')
var redis = require('./redis')

var TARGETS_KEY = 'targets'

module.exports = {
  createTarget,
  getAllTargets,
  getTargetById,
  updateTarget
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
