var concat = require('concat-stream')
var http = require('http')
var fs = require('fs')
var url = require('url')
var async = require('async')

// local requires
var checkPR = require('./prcheck.js')
var checkCollab = require('./collabcheck.js')
var mergePR = require('./merge.js')

// q to slow it down enough for the GitHub API
var q = async.queue(function que (pullreq, callback) {
  console.log(new Date(), 'QUEUE', pullreq.number)
  mergePR(pullreq, function donePR (err, message) {
    if (err) console.log(new Date(), message, err)
    // setTimeout(function() { callback(err) }, 1000)
    // what is this cb doing with err
    callback(err)
  })
}, 1)

console.log('QUEUE LENGTH', q.length())

q.drain = function drain () { console.log('Queue drain') }

module.exports = function (onHook) {
  var server = http.createServer(handler)

  // handler routes the requests to RR
  // to the appropriate places
  function handler (req, res) {
    console.log('>>>>>', new Date(), req.method, req.url)

    // End point to latest data
    if (req.url === ('/data')) {
      console.log(new Date(), 'Request for data')
      return fs.readFile(process.env['CONTRIBUTORS'], function (err, data) {
        if (err) return console.log(new Date(), err)
        res.statusCode = 200
        res.end(JSON.stringify(JSON.parse(data.toString())))
      })
    }

    // When RR gets a push from email when added as collab
    // Email from GitHub -> cloudmail.in -> here
    if (req.url === '/push') {
      return handleEmail(req, res)
    }

    // When a PR is made to patchwork repo
    // Comes from a GitHub webhook Patchwork repo
    if (req.url.match('/orderin')) {
      return getPR(req, res)
    }

    // When Git-it verifies user made a PR
    // Comes from verify step in Git-it challenge #10
    var queryURL
    var username
    if (req.url.match('/pr')) {
      queryURL = url.parse(req.url, true)
      username = queryURL.query.username
      return checkPR(username, function (err, pr) {
        // where does this res come from? The req.
        prStatus(res, err, pr)
      })
    }

    // When Git-it verifies user added RR as collab
    // Comes from verify step in Git-it challenge #8
    if (req.url.match('/collab')) {
      queryURL = url.parse(req.url, true)
      username = queryURL.query.username
      return checkCollab(username, function (err, collab) {
        collabStatus(res, err, collab)
      })
    }

    // When any other request goes to reporobot.jlord.us
    res.statusCode = 404
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      error: 404,
      message: 'not_found'
    }, true, 2))
  }

  function handleEmail (req, res) {
    req.pipe(concat(function (buff) {
      try {
        var emailObj = JSON.parse(buff)
      } catch (e) {
        return console.log(new Date(), 'Error parsing email JSON', req.headers, buff.length, [buff.toString()])
      }

      if (onHook) {
        onHook(emailObj, function (err, message) {
          if (err) console.log(new Date(), message, err)
        })
      }
    }))

    // TODO Why is this needed, and otherwise
    // cutting off getting the whole request
    setTimeout(function () {
      res.statusCode = 200
      res.end('Thank you.')
    }, 1000)
  }

  function getPR (req, res) {
    req.pipe(concat(function (buff) {
      var pullreq = JSON.parse(buff)

      // Check if it's a closed PR
      if (pullreq.action && pullreq.action === 'closed') {
        console.log(new Date(), 'SKIPPING: Closed pull request')
      } else {
        // Send open PR to the queue
        q.push(pullreq, function (err, message) {
          if (err) console.log(new Date(), message, err)
          console.log(new Date(), pullreq.number, 'Finished PR')
        })
      }

      res.statusCode = 200
      res.setHeader('content-type', 'application/json')
      res.end()
    }))
  }

  function prStatus (res, err, pr) {
    if (err) {
      console.log(err)
      res.statusCode = 500
      res.end(JSON.stringify({error: err}))
      return
    }
    res.statusCode = 200
    res.end(JSON.stringify({
      pr: pr
    }, true, 2))
  }

  function collabStatus (res, err, collab) {
    if (err) {
      console.log(err)
      res.statusCode = 500
      res.end(JSON.stringify({error: err}))
      return
    }
    res.statusCode = 200
    res.setHeader('content-type', 'application/json')
    res.end(JSON.stringify({
      collab: collab
    }, true, 2))
  }

  return server
}
