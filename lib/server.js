var URL = require('url')
var http = require('http')
var cuid = require('cuid')
var Corsify = require('corsify')
var sendJson = require('send-data/json')
var ReqLogger = require('req-logger')
var healthPoint = require('healthpoint')
var HttpHashRouter = require('http-hash-router')
var body = require('body/json')

var redis = require('./redis')
var targets = require('./targets')
var version = require('../package.json').version
var { TARGETS, TARGET_BY_ID, ROUTE } = require('../lib/constants').API_URLS

var router = HttpHashRouter()
var logger = ReqLogger({ version })
var health = healthPoint({ version }, redis.healthCheck)
var cors = Corsify({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, accept, content-type'
})

router.set('/favicon.ico', empty)
router.set(TARGETS,
  {
    POST: postTargets,
    GET: getTargets
  }
)
router.set(TARGET_BY_ID + ':id',
  {
    GET: getTargetById,
    POST: updateTargetById
  }
)
router.set(ROUTE, { POST: postRoute })

module.exports = function createServer () {
  return http.createServer(cors(handler))
}

function handler (req, res) {
  if (req.url === '/health') return health(req, res)
  req.id = cuid()
  logger(req, res, { requestId: req.id }, function (info) {
    info.authEmail = (req.auth || {}).email
    console.log(info)
  })
  router(req, res, { query: getQuery(req.url) }, onError.bind(null, req, res))
}

function getTargetById (req, res, opts) {
  var targetId = opts.params.id

  targets.getTargetById(targetId, function (err, target) {
    if (err) return onError(req, res, err)
    sendJson(req, res, target)
  })
}

function getTargets (req, res) {
  targets.getAllTargets(function (err, allTargets) {
    if (err) return onError(req, res, err)
    sendJson(req, res, allTargets)
  })
}

function postTargets (req, res) {
  parseJsonBody(req, res, function (err, data) {
    if (err) return onError(req, res, err)

    targets.createTarget(data, function (err, target) {
      if (err) return onError(req, res, err)
      res.statusCode = 201
      sendJson(req, res, target)
    })
  })
}

function updateTargetById (req, res, opts) {
  var targetId = opts.params.id

  parseJsonBody(req, res, function (err, data) {
    if (err) return onError(req, res, err)

    targets.updateTarget(targetId, data, function (err, updatedTarget) {
      if (err) return onError(req, res, err)
      sendJson(req, res, updatedTarget)
    })
  })
}

function postRoute (req, res) {
  parseJsonBody(req, res, function (err, data) {
    if (err) return onError(req, res, err)

    targets.makeDecision(data, function (err, decision) {
      if (err) return onError(req, res, err)
      sendJson(req, res, decision)
    })
  })
}

function parseJsonBody (req, res, callback) {
  body(req, res, function (err, data) {
    if (err) {
      var badRequestError = new Error('Invalid JSON in request body')
      badRequestError.statusCode = 400
      return callback(badRequestError)
    }
    callback(null, data)
  })
}

function onError (req, res, err) {
  if (!err) return

  res.statusCode = err.statusCode || 500
  logError(req, res, err)
  sendJson(req, res, {
    error: err.message || http.STATUS_CODES[res.statusCode]
  })
}

function logError (req, res, err) {
  if (process.env.NODE_ENV === 'test') return

  var logType = res.statusCode >= 500 ? 'error' : 'warn'
  console[logType]({
    err,
    requestId: req.id,
    statusCode: res.statusCode
  }, err.message)
}

function empty (req, res) {
  res.writeHead(204)
  res.end()
}

function getQuery (url) {
  return URL.parse(url, true).query // eslint-disable-line
}
