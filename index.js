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

/**
 * User:
 *  - id (int)
 *  - name (string)
 *  - icon (string)
 *  - typing (bool)
 *  - active (bool)
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
 **/
var sessions = {};

/*******************
 * Data Validation *
 *******************/

function validateHash(id) {
  return typeof id === "string" && id.length === 16;
}

function validateLastKnownTime(lastKnownTime) {
  return typeof lastKnownTime === "number" && astKnownTime % 1 === 0 && lastKnownTime >= 0;
}

function validateTimestamp(timestamp) {
  return typeof timestamp === "number" && timestamp % 1 === 0 && timestamp >= 0;
}

function validateBoolean(boolean) {
  return typeof boolean === "boolean";
}

function validateState(state) {
  return typeof state === "string" && (state === "playing" || state === "paused");
}

function validateVideoId(videoId) {
  return typeof videoId === "number" && videoId % 1 === 0 && videoId >= 0;
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
  con.query(sql, function(err, result) {
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
  con.query(sql, function(err, result, fields) {
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
  if (!userId || !users.hasOwnProperty(userId)) return;
  var user = users[userId];
  var sessionId = user.sessionId;
  user.sessionId = null;
  if (!sessionId || !sessions.hasOwnProperty(sessionId)) return;
  var session = sessions[sessionId];
  console.debug("User #" + userId + " left their session");
  var sessionUsers = 0;
  session.users.forEach(sessionUser => {
    if (users[sessionUser].sessionId == sessionId) {
      users[sessionUser].socket.emit("leaveSession", {
        userId: userId
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
  if (users.hasOwnProperty(id)) {
    var existingUser = users[id];
    if (existingUser.active) {
      console.debug("User #" + id + " opened multiple connections");
      leaveSession(id);
      existingUser.socket.disconnect();
    }
  }
  users[id] = {
    id: id,
    name: name,
    icon: icon,
    typing: false,
    active: true,
    sessionId: null,
    socket: socket
  };
  socket.emit("init", {
    userId: id,
    userName: name,
    userIcon: icon
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

con.connect(function(err) {
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
    con.query(sql, function(err, result) {
      if (err) throw err;
      console.log("Successfully created users table!");
    });
  }
});

/*****************
 * Web Endpoints *
 *****************/

app.get("/", function(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

app.get("/stats", function(req, res) {
  res.send({
    "users": Object.keys(users).length,
    "sessions": Object.keys(sessions).length
  });
});

// Not for production
if (isEnabled("test")) {
  app.get("/test", function(req, res) {
    res.sendFile(path.join(__dirname, "test/test.html"));
  });

  app.get("/test.js", function(req, res) {
    res.sendFile(path.join(__dirname, "test/test.js"));
  });

  app.get("/test.css", function(req, res) {
    res.sendFile(path.join(__dirname, "test/test.css"));
  });
}

app.post("/create-user", function(req,res) {
  createUser(req.body.name, (result) => res.send(result));
});

app.post("/validate-token", function(req, res) {
  var userId = req.body.userid;
  var token = req.body.token;

  if (!userId) return res.send({result: "missing-user"});
  if (!token) return res.send({result: "missing-token"});

  getToken(userId, function(realToken) {
    if (!realToken) return res.send({result: "invalid-user"});
    if (realToken == token) return res.send({result: "success"});
    return res.send({result: "invalid-token"});
  });
})

app.post("/log-event", function(req, res) {
  // TODO: logging
  console.debug("Log Event: ", req.body);
});

app.post("/log-summary", function(req, res) {
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
  getToken(id, function(realToken) {
    if (!realToken) {
      console.log(`Recieved connection from invalid user #${id}`);
      return next(new Error("Invalid user"));
    }
    if (token == realToken) return next();
    console.log(`Recieved connection for user #${id} with invalid token "${token}" (expected "${realToken}"`);
    return next(new Error("Invalid token"));
  });
});

io.on("connection", function(socket) {
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
    userId = socket.handshake.query.userid;
    // Fetch the users icon & name from the database
    var sql = `SELECT name, icon FROM users WHERE id="${userId}"`;
    con.query(sql, function(err, result, fields) {
      if (err) throw err;
      setupUser(socket, userId, result[0].name, result[0].icon);
    });
  }

  socket.on("createSession", (data, fn) => {
    var error = getSessionInfoError(userId, data.videoService, data.videoId);
    if (error) return fn({error: error});

    var sessionId = hash64();
    var controlLock = validateBoolean(data.controlLock) ? data.controlLock : false;
    while (sessions.hasOwnProperty(sessionId)) sessionId = hash64();

    console.debug("User #" + userId + " created session #" + sessionId);

    var session = {
      id: sessionId,
      users: [userId],
      ownerId: data.controlLock ? userId : null,
      videoService: data.videoService,
      videoId: data.videoId
    };

    users[userId].sessionId = sessionId;
    sessions[sessionId] = session;

    fn({
      session: session
    });
  });

  socket.on("joinSession", (data, fn) => {
    var error = getSessionInfoError(userId, data.videoService, data.videoId);
    if (error) return fn({error: error});
    var sessionId = data.id;
    if (!sessionId || !sessions.hasOwnProperty(sessionId)) {
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

    session.users.forEach(sessionUser => {
      // Collate the existing users' data to send to the new user
      sessionUsers[sessionUser] = {
        id: sessionUser,
        name: users[sessionUser].name,
        icon: users[sessionUser].icon,
        typing: users[sessionUser].typing,
        active: users[sessionUser].active
      }
      // Send the new user's data to existing users
      if (sessionUser != userId && users[sessionUser].sessionId == sessionId) {
        users[sessionUser].socket.emit("joinSession", {
          userId: userId,
          userName: users[userId].name,
          userIcon: users[userId].icon
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
    if (userId && users.hasOwnProperty(userId)) {
      leaveSession(userId);
      users[userId].active = false;
      console.debug("User #" + userId + " disconnected");
    }
  });
});

/**************
 * Web Server *
 **************/

var server = http.listen(process.env.PORT || 3000, function() {
  console.log("Listening on port %d.", server.address().port);
});