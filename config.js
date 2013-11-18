var express = require('express')
  , app = express()
  , server = require('http').createServer(app)
  , io = require('socket.io').listen(server)
  , redis = require('redis')
  , volatileConfig = require('./volatile-config');

/*var pub = redis.createClient();
var sub = redis.createClient();
var client = redis.createClient();*/

var rdb = redis.createClient();
var RedisStore = require('connect-redis')(express);

var secretKey = volatileConfig.secretKey;
var sessionPrefix = 'sess:';
var sessionExpiration = 1000 * 60 * 60 * 2;
var memberSessionExpiration = 1000 * 60 * 60 * 24 * 2;
var parseCookie = express.cookieParser(secretKey);
var sessionSingleton = require('./singleton').SessionSingleton.getInstance();

var mongoose = require('mongoose');

var mongoServer = volatileConfig.mongoServer;
var logger = require('./logger');
var User = require('./db').User;

var maxReports = 3;
var banExpiration = 1000 * 60 * 60 * 24 * 3;

var minMutualInterest = 0;

var verificationResendExpiration = 1000 * 60 * 2;

var emailUsername = volatileConfig.emailUsername;
var emailPassword = volatileConfig.emailPassword;

// Redis and session configuration
rdb.select(3, redis.print);
/*pub.select(3, redis.print);
sub.select(3, redis.print);
client.select(3, redis.print);*/

rdb.on('error', function (err) {
  logger.err('redis', err);
});

var redisStore = new RedisStore({
  client: rdb
});

function rdbLogger(err, res, action) {
  if (err) {
    logger.err('redis', err);
  } else {
    if (typeof action === 'defined') {
      res = action + ' ' + res;
    }
    logger.info('redis', res);
  }
}

mongoose.connect(mongoServer);

var db = mongoose.connection;
db.on('error', function (err) {
  logger.err('mongoose connection',
             'Error while connecting to mongodb.');
  throw "MongoDB connection error.";
});

// Websocket authorization
io.set('log level', 2);
io.configure('production', function () {
  io.set('transports', [
    'websocket',
    'xhr-polling',
    'htmlfile',
    'flashsocket',
    'jsonp-polling'
  ]);
  io.enable('browser client minification', true);
  io.enable('browser client etag', true);
  io.enable('browser client gzip', true);
  /*io.set('store', new SocketRedisStore({
    redisPub: pub,
    redisSub: sub,
    redisClient: client
  }));*/
});
io.set('polling duration', 20);
io.set('authorization', function (hs, accept) {
  if (hs.headers.cookie) {
    var sessionID;
    parseCookie(hs, null, function (data) {
      sessionID = hs.signedCookies['connect.sid'];
    });
    hs.sessionStore = redisStore;
    if (!sessionID) {
      accept('[Handshake] has no socket.', false);
    }
    hs.sessionID = sessionID;
    redisStore.get(sessionID, function (err, session) {
      if (err || !session) {
        logger.err('Socket handshake',
                   'Couldnt get session ' + err);
        accept('Error while handshaking.', false);
      } else if (typeof session.passport === 'undefined' ||
                 typeof session.passport.user === 'undefined' ||
                 ! session.passport.user) {
        logger.err('Socket handshake',
                   'Couldnt get user data from passport.');
        accept('Error while handshaking.', false);
      } else {
        //hs.sw = new sessionSingleton.getSession(hs, session);
        User.findOne({ _id: session.passport.user }, function (err, user) {
          if (err) {
            logger.err('Socket handshake',
                       err);
            accept('Error while handshaking.', false);
          } else if (!user) {
            logger.err('Socket handshake',
                       'No user found with id in passport. ' +
                       session.passport.user);
            accept('Error while handshaking.', false);
          } else {
            hs.user = user;
            accept(null, true);
          }
        });
      }
    });
  } else {
    return accept('No cookie found', false);
  }
});

// AppConfs

topicsList = {
  'literature': {title: 'ادبیات', thumb: '/static/img/topics/literature.png'},
  'film': {title: 'فیلم', thumb: '/static/img/topics/film.png'},
  'music': {title: 'موسیقی', thumb: '/static/img/topics/music.png'},
  'science': {title: 'علم', thumb: '/static/img/topics/science.png'},
  'technology': {title: 'تکنولوژی', thumb: '/static/img/topics/technology.png'},
  'book': {title: 'کتاب', thumb: '/static/img/topics/book.png'},
  'politics': {title: 'سیاست', thumb: '/static/img/topics/politics.png'},
  'religion': {title: 'مذهبی', thumb: '/static/img/topics/religion.png'},
  'commerce': {title: 'تجارت', thumb: '/static/img/topics/commerce.png'},
  'psychology': {title: 'روان‌شناسی', thumb: '/static/img/topics/psychology.png'},
  'computer': {title: 'کامپیوتر', thumb: '/static/img/topics/computer.png'},
  'foreign-languages': {title: 'زبان‌های خارجی', thumb: '/static/img/topics/foreign-languages.png'},
  'computer-games': {title: 'بازی‌های رایانه‌ای', thumb: '/static/img/topics/computer-games.png'},
  'sports': {title: 'ورزش', thumb: '/static/img/topics/sports.png'},
  'travel': {title: 'گردشگری', thumb: '/static/img/topics/travel.png'},
  'entertainment': {title: 'سرگرمی', thumb: '/static/img/topics/entertainment.png'},
};

// Exports
module.exports = {
  express: express,
  app: app,
  server: server,
  io: io,
  rdb: rdb,
  rdbLogger: rdbLogger,
  redisStore: redisStore,
  secretKey: secretKey,
  sessionExpiration: sessionExpiration,
  parseCookie: parseCookie,
  maxReports: maxReports,
  banExpiration: banExpiration,
  verificationResendExpiration: verificationResendExpiration,
  emailUsername: emailUsername,
  emailPassword: emailPassword,
  topicsList: topicsList,
};

