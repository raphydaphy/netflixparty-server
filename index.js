const express = require("express");
const mysql = require("mysql");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

app.use(express.json())

/*****************
 * Initial Setup *
 *****************/

// An array of default usernames
const usernames = ["James", "Hannah", "Tracy", "Bob", "Troy", "George", "Eve"];
const icons = ["Batman", "DeadPool", "CptAmerica", "Wolverine", "IronMan", "Goofy", "Alien", "Mulan", "Snow-White", "Poohbear", "Sailormoon", "Sailor-Cat", "Pizza", "Cookie", "Chocobar", "hotdog", "Hamburger", "Popcorn", "IceCream", "ChickenLeg"];

// Possible playback states (serverside)
const states = {playing: "playing", paused: "paused"};

/**
 * User:
 *  - id (int)
 *  - name (string)
 *  - icon (string)
 *  - typing (bool)
 *  - active (bool)
 *  - buffering (bool)
 *  - sessionId (hash)
 *  - socket (<socket>)
 **/
var users = {};

/**
 * Session:
 *  - id (hash)
 *  - users (int[])
 *  - videoService (string)
 *  - videoId (int)
 *  - ownerId (int)
 *  - state (string)
 *  - syncFromEnd (bool)
 *  - lastKnownTime (timestamp)
 *  - lastKnownTimeUpdatedAt (timestamp)
 *  - messages:
 *     - id (hash)
 *     - userId (int)
 *     - content (string)
 *     - isSystemMsg (bool)
 *     - timestamp (int)
 *     - likes:
 *        - userId (int)
 *        - timestamp (int)
 **/
var sessions = {};

/*******************
 * Data Validation *
 *******************/

function validateHash(id) {
  return typeof id === "string" && id.length === 16;
}

function validateUInt(uint) {
  return typeof uint === "number" && uint % 1 === 0 && uint >= 0;
}

function validateBoolean(boolean) {
  return typeof boolean === "boolean";
}

function validateString(string) {
  return typeof string === "string" && string.length > 0;
}

function validateState(state) {
  return typeof state === "string" && states.hasOwnProperty(state);
}

function validateVideoId(videoId) {
  return typeof videoId === "number" && videoId % 1 === 0 && videoId >= 0;
}

function padIntegerWithZeros(x, minWidth) {
  var numStr = String(x);
  while (numStr.length < minWidth) {
    numStr = '0' + numStr;
  }
  return numStr;
}

function getSessionInfoError(userId, videoService, videoId) {
  if (!userId || !users.hasOwnProperty(userId)) {
    return "Invalid user ID";;
  } else if (videoService != "netflix") {
    return "Unsupported video service";
  } else if (!validateVideoId(videoId)) {
    return "Invalid video ID";
  }
  return null;
}

function userExists(userId) {
  return userId && users.hasOwnProperty(userId);
}

function sessionExists(sessionId) {
  return sessionId && sessions.hasOwnProperty(sessionId);
}

/********************
 * Helper Functions *
 ********************/

// generate a random hash with 64 bits of entropy
function hash64() {
  var result = "";
  var hexChars = "0123456789abcdef";
  for (var i = 0; i < 16; i += 1) {
    result += hexChars[Math.floor(Math.random() * 16)];
  }
  return result;
}

function isEnabled(argument, envVar) {
  return process.argv.includes("--" + argument);
}

function createUser(name, fn) {
  // A 64 bit hash used to authenticate users
  var token = hash64();
  // Use a default username if no name is provided
  var name = name || usernames[Math.floor(Math.random() * usernames.length)];
  // A random profile icon is picked when the account is created
  var icon = icons[Math.floor(Math.random() * icons.length)];

  // Name has a maximum length of 16 characters in the database
  name = name.substring(0, 16);

  var sql = `INSERT INTO users (token, name, icon) VALUES ("${token}", "${name}", "${icon}")`;
  con.query(sql, (err, result) => {
    if (err) {
      fn({error: err});
      throw err;
    }
    console.log("Created user #" + result.insertId);
    fn({
      id: result.insertId,
      token: token,
      name: name,
      icon: icon
    });
  });
}

function getToken(userId, fn) {
  if (!userId) return fn(null);
  var sql = `SELECT token FROM users WHERE id="${userId}"`;
  con.query(sql, (err, result, fields) => {
    if (err) throw err;
    if (result.length > 0) {
      return fn(result[0].token);
    }
    fn(null);
  });
}

// Tries to remove the specified user from their current session
// If they were the only active user left, the session is then deleted
function leaveSession(userId) {
  if (!userExists(userId)) return;
  var user = users[userId];
  var sessionId = user.sessionId;
  if (!sessionExists(sessionId)) return;
  var message = createMessage(userId, "left the session", true);
  user.sessionId = null;
  var session = sessions[sessionId];
  console.debug("User #" + userId + " left their session");
  var sessionUsers = 0;
  session.users.forEach(sessionUser => {
    if (users[sessionUser].sessionId == sessionId) {
      users[sessionUser].socket.emit("leaveSession", {
        userId: userId,
        message: message
      });
      sessionUsers++;
    }
  });
  if (sessionUsers == 0) {
    console.debug("Everyone has left session #" + sessionId + ", deleting");
    delete sessions[sessionId];
  }
}

function setupUser(socket, id, name, icon) {
  console.debug("User #" + id + " connected");
  if (userExists(id)) {
    var existingUser = users[id];
    if (existingUser.active) {
      console.debug("User #" + id + " opened multiple connections");
      leaveSession(id);
      existingUser.socket.disconnect();
    }
  }
  var user = {
    id: id,
    name: name,
    icon: icon,
    typing: false,
    buffering: false,
    active: true,
    sessionId: null,
    socket: socket
  };

  users[id] = user;
  socket.emit("init", {
    user: {
      id: user.id,
      name: user.name,
      icon: user.icon,
      typing: user.typing,
      buffering: user.buffering,
      active: user.active
    }
  });
}

function createMessage(userId, content, isSystemMsg) {
  var session = sessions[users[userId].sessionId];
  var messageId = hash64();
  while (session.messages.hasOwnProperty(messageId)) messageId = hash64();

  var message = {
    id: messageId,
    userId: userId,
    content: content,
    isSystemMsg: isSystemMsg,
    timestamp: Date.now(),
    likes: {}
  };

  session.messages[messageId] = message;
  return message;
}

function broadcastMessage(userId, content, isSystemMsg, ignoreSender=true) {
  var message = createMessage(userId, content, isSystemMsg);
  var session = sessions[users[userId].sessionId];
  session.users.forEach(sessionUser => {
    su = users[sessionUser];
    if ((sessionUser != userId || !ignoreSender) && su.sessionId == session.id) {
      su.socket.emit("sendMessage", {
        message: message
      });
    }
  });
  return message;
}

function getSession(userId) {
  if (!userExists(userId)) return {error: "Invalid user ID"};
  var user = users[userId];
  if (!sessionExists(user.sessionId)) return {error: "Invalid session"};
  return sessions[user.sessionId];
}

function getMessageInfo(userId, msgId) {
  var session = getSession(userId);
  if (session.error) return session;
  if (!session.messages.hasOwnProperty(msgId)) return {error: "Invalid message"};
  return {
    user: session.user,
    session: session,
    message: session.messages[msgId]
  };
}

function updateBufferingStatus(userId, buffering) {
  var session = getSession(userId);
  if (session.error) return console.warn("Recieved invalid buffering status:", session.error);
  users[userId].buffering = buffering;
  session.users.forEach(sessionUser => {
    if (sessionUser != userId && users[sessionUser].sessionId == session.id) {
      users[sessionUser].socket.emit("buffering", {
        userId: userId,
        buffering: buffering
      });
    }
  });
}

/***********************
 * Database Connection *
 ***********************/

var con = mysql.createConnection({
  host: process.env.MYSQL_HOST || "localhost",
  user: process.env.MYSQL_USER || "netflixparty",
  password: process.env.MYSQL_PASS || "password",
  database: process.env.MYSQL_DB || "netflixparty"
});

con.connect((err) => {
  if (err) throw err;
  console.log("Connected to the MySQL Database!");

  // Automatically create the necessary tables when the requested
  if (isEnabled("setupdb") || process.env.SETUP_DB == "SETUP_DB") {
    console.log("Performing initial database setup...");
    var sql = `
      CREATE TABLE users ( 
        id INT NOT NULL AUTO_INCREMENT COMMENT "unique user id",
        token VARCHAR(16) NOT NULL COMMENT "used for authentication",
        name VARCHAR(16) NOT NULL COMMENT "nickname",
        icon VARCHAR(64) NOT NULL COMMENT "profile picture filename",
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP COMMENT "account creation timestamp",
        PRIMARY KEY (id)
      ) 
      ENGINE = InnoDB
      COMMENT = "persistent user storage";
    `;
    con.query(sql, (err, result) => {
      if (err) throw err;
      console.log("Successfully created users table!");
    });
  }
});

/*****************
 * Web Endpoints *
 *****************/

app.get("/", (req, res) => {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

app.get("/stats", (req, res) => {
  res.send({
    "users": Object.keys(users).length,
    "sessions": Object.keys(sessions).length
  });
});

// Not for production
if (isEnabled("test")) {
  app.get("/test", (req, res) => {
    res.sendFile(path.join(__dirname, "test/test.html"));
  });

  app.get("/test.js", (req, res) => {
    res.sendFile(path.join(__dirname, "test/test.js"));
  });

  app.get("/test.css", (req, res) => {
    res.sendFile(path.join(__dirname, "test/test.css"));
  });
}

app.post("/create-user", (req, res) => {
  createUser(req.body.name, (result) => res.send(result));
});

app.post("/validate-token", (req, res) => {
  var userId = req.body.userid;
  var token = req.body.token;

  if (!userId) return res.send({result: "missing-user"});
  if (!token) return res.send({result: "missing-token"});

  getToken(userId, (realToken) => {
    if (!realToken) return res.send({result: "invalid-user"});
    if (realToken == token) return res.send({result: "success"});
    return res.send({result: "invalid-token"});
  });
})

app.post("/log-event", (req, res) => {
  // TODO: logging
  console.debug("Log Event: ", req.body);
});

app.post("/log-summary", (req, res) => {
  // TODO: summary log
  console.debug("Log Summary: ", req.body);
});

/*****************
 * Socket Events *
 *****************/

io.use((socket, next) => {
  if (socket.handshake.query.incognito == "true") return next();
  var id = socket.handshake.query.userid;
  var token = socket.handshake.query.token;

  if (!id || !token) {
    console.log("Recieved connection with missing credentials");
    return next(new Error("Missing credentials"));
  }
  getToken(id, (realToken) => {
    if (!realToken) {
      console.log(`Recieved connection from invalid user #${id}`);
      return next(new Error("Invalid user"));
    }
    if (token == realToken) return next();
    console.log(`Recieved connection for user #${id} with invalid token "${token}" (expected "${realToken}"`);
    return next(new Error("Invalid token"));
  });
});

io.on("connection", (socket) => {
  var userId;

  if (socket.handshake.query.incognito == "true") {
    createUser(null, data => {
      if (data.error) {
        return console.warn("Failed to create temporary incognito account!", data.error);
      }
      userId = data.id;
      setupUser(socket, userId, data.name, data.icon);
    });
  } else {
    userId = parseInt(socket.handshake.query.userid);
    // Fetch the users icon & name from the database
    var sql = `SELECT name, icon FROM users WHERE id="${userId}"`;
    con.query(sql, (err, result, fields) => {
      if (err) throw err;
      setupUser(socket, userId, result[0].name, result[0].icon);
    });
  }

  /******************
   * Session Events *
   ******************/

  socket.on("createSession", (data, fn) => {
    var error = getSessionInfoError(userId, data.videoService, data.videoId);
    if (error) return fn({error: error});

    var sessionId = hash64();
    var controlLock = validateBoolean(data.controlLock) ? data.controlLock : false;
    while (sessionExists(sessionId)) sessionId = hash64();

    console.debug("User #" + userId + " created session #" + sessionId);

    var session = {
      id: sessionId,
      users: [userId],
      messages: {},
      ownerId: data.controlLock ? userId : null,
      videoService: data.videoService,
      videoId: data.videoId,
      state: states.paused,
      syncFromEnd: false,
      lastKnownTime: 0,
      lastKnownTimeUpdatedAt: Date.now()
    };

    users[userId].sessionId = sessionId;
    sessions[sessionId] = session;

    createMessage(userId, "created the session", true);

    fn({session: session});
  });

  socket.on("joinSession", (data, fn) => {
    var error = getSessionInfoError(userId, data.videoService, data.videoId);
    if (error) return fn({error: error});
    var sessionId = data.id;
    if (!sessionExists(sessionId)) {
      console.warn("Invalid session id", sessionId);
      return fn({error: "Invalid session ID"});
    }

    var session = sessions[sessionId];
    if (session.videoService != data.videoService) {
      return fn({error: "Video service does not match the session"});
    } else if (session.videoId != data.videoId) {
      return fn({error: "Video ID does not match the session"});
    }

    if (users[userId].sessionId) {
      console.log("User #" + userId + " tried to join multiple sessions!");
      leaveSession(users[userId].sessionId);
    }

    console.debug("User #" + userId + " joined session #" + sessionId);

    var sessionUsers = {};
    users[userId].sessionId = sessionId;
    session.users.push(userId);

    var message = createMessage(userId, "joined the session", true);

    session.users.forEach(sessionUser => {
      // Collate the existing users' data to send to the new user
      sessionUsers[sessionUser] = {
        id: sessionUser,
        name: users[sessionUser].name,
        icon: users[sessionUser].icon,
        typing: users[sessionUser].typing,
        buffering: users[sessionUser].buffering,
        active: users[sessionUser].active
      }
      // Send the new user's data to existing users
      if (sessionUser != userId && users[sessionUser].sessionId == sessionId) {
        users[sessionUser].socket.emit("joinSession", {
          message: message,
          user: {
            id: userId,
            name: users[userId].name,
            icon: users[userId].icon,
            typing: users[userId].typing,
            buffering: users[userId].buffering,
            active: users[userId].active
          }
        });
      }
    });

    fn({
      session: session,
      users: sessionUsers
    });
  });

  socket.on("leaveSession", () => {
    leaveSession(userId);
  });

  socket.on("userDisconnected", () => {
    if (!userExists(userId)) return console.debug("Unknown user #" + userId + " tried to disconnect");
    leaveSession(userId);
    users[userId].active = false;
    console.debug("User #" + userId + " disconnected");
  });

  /***************
   * Chat Events *
   ***************/

  socket.on("sendMessage", (data, fn) => {
    if (!userExists(userId)) return fn({error: "Invalid user ID"});
    if (!validateString(data.content)) return fn({error: "Invalid message content"});
    var user = users[userId];
    if (!sessionExists(user.sessionId)) return fn({error: "Invalid session"});

    var message = broadcastMessage(userId, data.content, data.isSystemMsg || false);

    fn({ message: message });
  });

  socket.on("likeMessage", data => {
    var info = getMessageInfo(userId, data.msgId);
    if (info.error) return console.debug("Failed to like message:", info.error);
    var timestamp = Date.now();
    if (info.message.likes.hasOwnProperty(userId)) {
      return console.debug("User #" + userId + " tried to like a message they had already liked");
    }
    info.message.likes[userId] = {
      userId: userId,
      timestamp: timestamp
    };
    info.session.users.forEach(sessionUser => {
      if (users[sessionUser].sessionId == info.session.id) {
        users[sessionUser].socket.emit("likeMessage", {
          msgId: data.msgId,
          userId: userId,
          timestamp: timestamp
        });
      }
    });
  });

  socket.on("unlikeMessage", data => {
    var info = getMessageInfo(userId, data.msgId);
    if (info.error) return console.debug("Failed to unlike message:", info.error);
    if (!info.message.likes.hasOwnProperty(userId)) {
      return console.debug("User #" + userId + " tried to unlike a message that they hadn't already liked");
    }
    delete info.message.likes[userId];
    info.session.users.forEach(sessionUser => {
      if (users[sessionUser].sessionId == info.session.id) {
        users[sessionUser].socket.emit("unlikeMessage", {
          msgId: data.msgId,
          userId: userId
        });
      }
    });
  });

  socket.on("typing", data => {
    var session = getSession(userId);
    if (session.error) return console.debug("Failed to update typing status:", session.error);
    users[userId].typing = data.typing;
    session.users.forEach(sessionUser => {
      if (sessionUser != userId && users[sessionUser].sessionId == session.id) {
        users[sessionUser].socket.emit("typing", {
          userId: userId,
          typing: data.typing
        });
      }
    });
  });

  socket.on("changeName", (data, fn) => {
    if (!userExists(userId)) return fn({error: "Invalid user ID"});
    if (!validateString(data.name)) return fn({error: "Invalid name"});

    var user = users[userId];
    var session = getSession(userId);
    var message;

    user.name = data.name.substring(0, 16);;
    if (!session.error) {
      message = createMessage(userId, "changed their name", true);
    }

    var sql = `UPDATE users SET name="${user.name}" WHERE id="${userId}";`;
    con.query(sql, (err, result) => {
      if (err) throw err;
      console.debug("Changed user #" + userId + "'s name to " + user.name);
    });

    fn({
      name: user.name,
      message: message
    });

    if (session.error) return;

    session.users.forEach(sessionUser => {
      if (sessionUser != user.id && users[sessionUser].sessionId == session.id) {
        users[sessionUser].socket.emit("changeName", {
          userId: user.id,
          name: user.name,
          message: message
        });
      }
    });
  });

  // TODO: deduplication here ?
  socket.on("changeIcon", (data, fn) => {
    if (!userExists(userId)) return fn({error: "Invalid user ID"});
    if (!icons.includes(data.icon)) return fn({error: "Invalid icon"});

    var user = users[userId];
    var session = getSession(userId);
    var message;

    user.icon = data.icon;
    if (!session.error) {
      message = createMessage(userId, "changed their icon", true);
    }

    var sql = `UPDATE users SET icon="${user.icon}" WHERE id="${userId}";`;
    con.query(sql, (err, result) => {
      if (err) throw err;
      console.debug("Changed user #" + userId + "'s icon to " + user.icon);
    });

    fn({
      icon: user.icon,
      message: message
    });

    if (session.error) return;

    session.users.forEach(sessionUser => {
      if (sessionUser != user.id && users[sessionUser].sessionId == session.id) {
        users[sessionUser].socket.emit("changeIcon", {
          userId: user.id,
          icon: user.icon,
          message: message
        });
      }
    });
  });

  /*********************
   * Video Sync Events *
   *********************/

  socket.on("getServerTime", (data, fn) => {
    var version = data.version;
    fn({serverTime: Date.now()});
  });

  socket.on("buffering", (data, fn) => {
    updateBufferingStatus(userId, data.buffering);
  });

  socket.on("updateSession", (data, fn) => {
    var session = getSession(userId);
    if (session.error) return fn({error:session.error});
    if (!validateUInt(data.lastKnownTime)) return fn({error:"Invalid lastKnownTime"});
    if (!validateUInt(data.lastKnownTimeUpdatedAt)) return fn({error:"Invalid lastKnownTimeUpdatedAt"});
    if (!validateState(data.state)) return fn ({error:"Invalid state"});

    updateBufferingStatus(userId, data.buffering);

    if (session.ownerId && session.ownerId != userId) {
      return fn({error:"Control lock is enabled"});
    }

    var now = Date.now();
    var oldPredictedTime = session.lastKnownTime +
      (session.state === states.paused ? 0 : (
        now - session.lastKnownTimeUpdatedAt
      ));
    var newPredictedTime = data.lastKnownTime +
      (data.state === states.paused ? 0 : (
        now - data.lastKnownTimeUpdatedAt
      ));

    var stateUpdated = session.state !== data.state;
    var timeUpdated = Math.abs(newPredictedTime - oldPredictedTime) > 2500;

    var hours = Math.floor(newPredictedTime / (1000 * 60 * 60));
    newPredictedTime -= hours * 1000 * 60 * 60;
    var minutes = Math.floor(newPredictedTime / (1000 * 60));
    newPredictedTime -= minutes * 1000 * 60;
    var seconds = Math.floor(newPredictedTime / 1000);
    newPredictedTime -= seconds * 1000;

    var timeStr;
    if (hours > 0) {
      timeStr = String(hours) + ':' + String(minutes) + ':' + padIntegerWithZeros(seconds, 2);
    } else {
      timeStr = String(minutes) + ':' + padIntegerWithZeros(seconds, 2);
    }

    session.lastKnownTime = data.lastKnownTime;
    session.lastKnownTimeUpdatedAt = data.lastKnownTimeUpdatedAt;
    session.state = data.state;

    var message;

    if (stateUpdated && timeUpdated) {
      if (data.state === states.playing) {
        message = createMessage(userId, "started playing the video at " + timeStr, true);
      } else {
        console.log("paused");
        message = createMessage(userId, "paused the video at " + timeStr, true);
      }
    } else if (stateUpdated) {
      if (data.state === states.playing) {
        message = createMessage(userId, "started playing the video", true);
      } else {
        message = createMessage(userId, "paused the video", true);
      }
    } else if (timeUpdated) {
      message = createMessage(userId, "jumped to " + timeStr, true);
    }

    var updateData = {
      lastKnownTime: session.lastKnownTime,
      lastKnownTimeUpdatedAt: session.lastKnownTimeUpdatedAt,
      state: session.state
    };

    fn({message: message}, updateData);
    //console.debug("User " + userId + " updated session " + users[userId].sessionId + " with time " + data.lastKnownTime + " and state " + data.state + " for epoch " + JSON.stringify(data.lastKnownTimeUpdatedAt) + '.');

    session.users.forEach(sessionUser => {
      if (sessionUser != userId && users[sessionUser].sessionId == session.id) {
        users[sessionUser].socket.emit("updateSession", updateData);
      }
    });
  });

  socket.on("changeVideoId", (data, fn) => {
    var session = getSession(userId);
    if (session.error) return fn({error: session.error});
    if (session.ownerId && session.ownerId != userId) {
      return fn({error:"Control lock is enabled"});
    }
    if (!validateVideoId(data.newVideoId)) return fn({error: "Invalid video ID"});

    //console.debug("User #" + userId + " requested to change video from " + session.videoId + " to " + data.newVideoId);

    // The new episode is already playing
    if (data.newVideoId == session.videoId) return;

    var message = createMessage(userId, "started the next episode", true);
    session.videoId = data.newVideoId;

    fn({message: message});

    session.users.forEach(sessionUser => {
      if (sessionUser != userId && users[sessionUser].sessionId == session.id) {
        users[sessionUser].socket.emit("changeVideoId", {
          newVideoId: session.videoId,
          message: message
        });
      }
    });
  });
});

/**************
 * Web Server *
 **************/

var server = http.listen(process.env.PORT || 3000, () => {
  console.log("Listening on port %d.", server.address().port);
});