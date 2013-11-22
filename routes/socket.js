/*
 * Serve content over a socket
 */

var config = require('../config')
  , rdb = config.rdb
  , rdbLogger = config.rdbLogger
  , io = config.io
  , backend = require('../backend')
  , maxReports = config.maxReports
  , banExpiration = config.banExpiration
  , db = require('../db')
  , logger = require('../logger');

module.exports = function (socket) {

  // Add socket to session
  if (!isSocketValid(socket)) {
    emitError(socket);
    return;
  }
  var user = socket.handshake.user;

  // Add online
  backend.addOnline(user, socket);

  logger.info('socket',
              'New socket, ' + socket.id + ' ' + user.username
             );

  // Looking for a new stranger.
  socket.on('stranger:req', function (data) {
    logger.info('socket',
                'Socket requested, ' + socket.id + ' ' + user.username
               );

    if (isLoggedIn(socket)) {
      var res;
      rdb.srandmember('chat:waiting', function (err, reply) {
        if (err) {
          socket.emit('stranger:err',
                      {err: 'Something happened when looking up for strangers.'}
                     );
          logger.err('socket',
                     'Error when getting a random member of waiting list.');
        } else {
          res = getStrangerSocket(socket);

          if (res.ok) {
            res.strangerSocket.set('strangerSID', '');
            res.strangerSocket.set('lastStranger', user.username);
            //res.strangerSocket.set('lastStrangerIp', socket.handshake.sw.s().ip);
            socket.set('strangerSID', '');
            res.strangerSocket.emit('stranger:disconnected');
          }

          if (!reply) {
            rdb.sadd('chat:waiting', socket.id);
          } else {
            var strangerSocket = io.sockets.socket(reply);
            if (isSocketValid(strangerSocket)) {
              if (!isSocketValid(socket)) {
                emitError(socket);
                return;
              }
              if (strangerSocket.handshake.user.id === user.id) {
                rdb.sadd('chat:waiting', socket.id);
                return;
              }
              rdb.srem('chat:waiting', reply);
              logger.info('socket', 'Stranger found, ' + reply);

              socket.set('strangerSID', reply);
              strangerSocket.set('strangerSID', socket.id);

              user.update({ $inc: {chatCount: 1} });
              strangerSocket.handshake.user.update({ $inc: {chatCount: 1} });

              var selfTopics = user.topics;
              var strangerTopics = strangerSocket.handshake.user.topics;
              var commonTopics = [];
              var selfTopicsTranslated = [];
              var strangerTopicsTranslated = [];
              for (var i = 0; i < selfTopics.length && selfTopics.length > 0; i++) {
                for (var j = 0; j < strangerTopics.length && strangerTopics.length > 0; j++) {
                  var match = false;
                  if (selfTopics[i] == strangerTopics[j]) {
                    commonTopics.push(selfTopics[i]);
                    /*selfTopics.splice(selfTopics.indexOf(selfTopics[i]), 1);
                    strangerTopics.splice(strangerTopics.indexOf(strangerTopics[i]), 1);
                    i--;
                    j--;*/
                    continue;
                  }
                }
              }
              for (var i = 0; i < selfTopics.length; i++) {
                try {
                  if (commonTopics.indexOf(selfTopics[i]) === -1) {
                    selfTopicsTranslated.push(config.topicsList[selfTopics[i]].title);
                  }
                } catch (err) {
                  logger.err('Socket', 'Topic doesnt have title.');
                  logger.err('socket^', err.message);
                  continue;
                }
              }
              for (var i = 0; i < strangerTopics.length; i++) {
                try {
                  if (commonTopics.indexOf(strangerTopics[i]) === -1) {
                    strangerTopicsTranslated.push(
                      config.topicsList[strangerTopics[i]].title
                    );
                  }
                } catch (err) {
                  logger.err('Socket', 'Topic doesnt have title.');
                  logger.err('socket^', err.message);
                  continue;
                }
              }
              for (var i = 0; i < commonTopics.length; i++) {
                try {
                commonTopics[i] = config.topicsList[commonTopics[i]].title;
                } catch (err) {
                  logger.err('Socket', 'Topic doesnt have title.');
                  logger.err('socket^', err.message);
                  continue;
                }
              }

              var strangerData = {
                username: strangerSocket.handshake.user.username,
                commonTopics: commonTopics,
                strangerTopics: strangerTopicsTranslated,
                gravatarUrl: strangerSocket.handshake.user.gravatarUrl
              };
              var selfData = {
                username: user.username,
                commonTopics: commonTopics,
                strangerTopics: selfTopicsTranslated,
                gravatarUrl: user.gravatarUrl
              };
              socket.emit('stranger:res', strangerData);
              strangerSocket.emit('stranger:res', selfData);
            } else {
              if (typeof strangerSocket.id !== 'undefined') {
                strangerSocket.disconnect('Weird Socket');
              }
              rdb.sadd('chat:waiting', socket.id);
              logger.err('socket', 'Found stranger has no handshake. Still looking.');
              //logger.err('socket', strangerSocket);
            }
          }
        }
      });
    } else {
      emitError(socket);
      return;
    }
  });

  socket.on('stranger:report', function (data) {
    if (isLoggedIn(socket)) {
      if (data.noStranger) {
        socket.get('lastStranger', function (err, username) {
          if (err || !username) {
            logger.err('socket', 'No last stranger available.');
            if (err) logger.err('socket', err);
          } else {
            User.findOne({ username: username }, function (err, user_) {
              if (err) {
                logger.err('report',
                           err);
              } else if (!user_) {
                logger.err('report',
                           'Cant get user to report.');
              } else {
                user_.report(user);
              }
            });
          }
        });
      } else {
        var res = getStrangerSocket(socket);

        if (res.ok) {
          if (isSocketValid(res.strangerSocket)) {
            User.findOne(
              { username: res.strangerSocket.handshake.user.username },
              function (err, user_) {
                if (err) {
                  logger.err('report', err);
                } else if (!user_) {
                  logger.err('report', 'Cant get user for report.');
                } else {
                  user_.report(user);
                }
              });
          } else {
            logger.err('socket', 'stranger socket not valid for report.');
          }
        } else {
          logger.err('socket', 'Getting stranger socket for report failed.');
        }
      }
    } else {
      emitError(socket);
      return;
    }
  });

  // New message to be sent
  socket.on('msg:send', function (data) {
    if (isLoggedIn(socket)) {
      var msg = '';
      if (typeof data.msg === 'string') {
        msg = data.msg;
      } else {
        logger.err('socket',
                   'Message being sent is not string.'
                  );
        logger.err('socket',
                   String(data.msg)
                  );

        if (typeof data.msg.text === 'string') {
          msg = data.msg.text;
        }
      }
      if (msg.trim()) {
        user.update({ $inc: {msgCount: 1} });
        var res = getStrangerSocket(socket);

        if (res.ok) {
          msg = {text: msg};
          msg.from = 'stranger';
          res.strangerSocket.emit('msg:recv', {msg: msg});
        }
      } else {
        logger.err('socket',
                   'Message was not sent. ' + msg
                  );
        socket.emit('msg:failed');
      }
    }
  });

  // Typing status
  socket.on('msg:typing', function (data) {
    if (isLoggedIn(socket)) {
      var res = getStrangerSocket(socket);

      if (res.ok) {
        res.strangerSocket.emit('msg:strangerTyping', data);
      }
    }
  });

  // Friendship
  socket.on('friend:req', function (data) {
    if (isLoggedIn(socket)) {
      var res = getStrangerSocket(socket);

      if (res.ok) {
        res.strangerSocket.emit('friend:req');
      }
    } else {
      emitError(socket);
      return;
    }
  });

  socket.on('friend:res', function (data) {
    if (isLoggedIn(socket)) {
      var res = getStrangerSocket(socket);

      if (res.ok) {
        // Accept
        if (data['response']) {
          user.addFriend(res.strangerSocket.handshake.user.id);
          res.strangerSocket.handshake.user.addFriend(user.id);
        // Deny
        } else {
          // Notify stranger.
          res.strangerSocket.emit('friend:dec');
        }
      } else {
        // Notify user.
      }
    } else {
      emitError(socket);
      return;
    }
  });

  // Socket disconnected.
  socket.on('disconnect', function () {
    logger.info('socket', 'Socket disconnected, ' +
                socket.id + ' ' + user.username);
    rdb.srem('chat:waiting', socket.id, rdbLogger);
    backend.remOnline(user, socket.id);
    var res = getStrangerSocket(socket);

    if (res.ok) {
      logger.info('socket', 'Stranger disconnected, ' + res.strangerSocket.id);
      res.strangerSocket.set('strangerSID', '');
      res.strangerSocket.set('lastStranger', user.username);
      // TODO: Somehow keep their ips even if their session is destroyed.
      /*if (typeof socket.handshake.sw !== 'undefined') {
        if (typeof socket.handshake.sw.s() !== 'undefined') {
          res.strangerSocket.set('lastStrangerIp', socket.handshake.sw.s().ip);
        }
      }*/
      socket.set('strangerSID', '');
      res.strangerSocket.emit('stranger:disconnected');
    }
  });
};

function getStrangerSocket(socket) {
  var ok = true,
    strangerSocket = null,
    err = null;

  socket.get('strangerSID', function (err_, sid) {
    if (err_ || !sid) {
      //socket.emit('msg:err');
      err = err_;
      ok = false;
    } else {
      strangerSocket = io.sockets.socket(sid);
    }
  });

  if (!isSocketValid(strangerSocket)) {
    ok = false;
    if (strangerSocket) {
      strangerSocket.emit('system:error');
    }
  }
  return {ok: ok, strangerSocket: strangerSocket, err: err};
}

function isLoggedIn(socket) {
  if (isSocketValid(socket)) {
    return true;
  }
  logger.info('socket', 'Socket is not logged in.');
  return false;
}

function emitError(socket) {
  if (typeof socket !== 'undefined' && socket) {
    if (typeof socket.handshake !== 'undefined' && socket.handshake) {
      if (typeof socket.handshake.user !== 'undefined' &&
          socket.handshake.user) {
        logger.info('socket', 'Some problem happend, emitting error.');
      } else {
        logger.err('socket', 'Socket lacking user data.');
        //logger.err('socket', socket.handshake);
      }
    } else {
      logger.err('socket', 'Socket has no handshake data.');
      //logger.err('socket', socket.handshake);
    }
    socket.emit('system:error');
  } else {
    logger.err('socket', 'User has no socket to emit error, weird!');
  }
}

function isSocketValid(socket) {
  if (typeof socket !== 'undefined' && socket !== null) {
    if (typeof socket.handshake !== 'undefined') {
      if (typeof socket.handshake.user !== 'undefined') {
        if (socket.handshake.user) {
          if (!socket.handshake.user.isBanned()) {
            return true;
          }
        }
      }
    }
  }

  return false;
}
