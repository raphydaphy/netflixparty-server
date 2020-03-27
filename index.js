const express = require("express");
const mysql = require("mysql");
const path = require("path");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

app.use(express.json())

/****************
 * Initial Setup
 ****************/

// An array of default usernames
const usernames = ["James", "Hannah", "Tracy", "Bob", "Troy", "George", "Eve"];
const icons = ["Batman", "DeadPool", "CptAmerica", "Wolverine", "IronMan", "Goofy", "Alien", "Mulan", "Snow-White", "Poohbear", "Sailormoon", "Sailor-Cat", "Pizza", "Cookie", "Chocobar", "hotdog", "Hamburger", "Popcorn", "IceCream", "ChickenLeg"];

/*******************
 * Helper Functions
 *******************/

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

function getToken(userId, fn) {
  if (userId == undefined) return fn(undefined);
  var sql = `SELECT token FROM users WHERE id="${userId}"`;
  con.query(sql, function(err, result, fields) {
    if (err) throw err;
    if (result.length > 0) {
      return fn(result[0].token);
    }
    fn(undefined);
  });
}

/**********************
 * Database Connection
 **********************/

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

/****************
 * Web Endpoints
 ****************/

app.get("/", function(req, res) {
  res.setHeader("Content-Type", "text/plain");
  res.end("OK");
});

// Not for production
if (isEnabled("test")) {
  app.get("/test", function(req, res) {
    res.sendFile(path.join(__dirname, "test.html"));
  });
}

app.post("/create-user", function(req,res) {
  // A 64 bit hash used to authenticate users
  var token = hash64();
  // Use a default username if no name is provided
  var name = req.body.name || usernames[Math.floor(Math.random() * usernames.length)];
  // A random profile icon is picked when the account is created
  var icon = icons[Math.floor(Math.random() * icons.length)];

  // Name has a maximum length of 16 characters in the database
  name = name.substring(0, 16);

  var sql = `INSERT INTO users (token, name, icon) VALUES ("${token}", "${name}", "${icon}")`;
  con.query(sql, function(err, result) {
    if (err) {
      res.send({error: err});
      throw err;
    }
    console.log("Created user #" + result.insertId);
    res.send({
      id: result.insertId,
      token: token,
      name: name,
      icon: icon
    });
  });
});

app.post("/validate-token", function(req, res) {
  var userId = req.body.userid;
  var token = req.body.token;

  if (userId == undefined) return res.send({result: "missing-user"});
  if (token == undefined) return res.send({result: "missing-token"});

  getToken(userId, function(realToken) {
    if (realToken == undefined) return res.send({result: "invalid-user"});
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

/****************
 * Socket Events
 ****************/

io.use((socket, next) => {
  var id = socket.handshake.query.userid;
  var token = socket.handshake.query.token;

  if (id == undefined || token == undefined) {
    console.log("Recieved connection with missing credentials");
    return next(new Error("Missing credentials"));
  }
  getToken(id, function(realToken) {
    if (realToken == undefined) {
      console.log(`Recieved connection from invalid user #${id}`);
      return next(new Error("Invalid user"));
    }
    if (token == realToken) return next();
    console.log(`Recieved connection for user #${id} with invalid token "${token}" (expected "${realToken}"`);
    return next(new Error("Invalid token"));
  });
});

io.on("connection", function(socket) {
  var userId = socket.handshake.query.userid;

  console.debug("Connected with id " + userId);
});

/*************
 * Web Server
 *************/

var server = http.listen(process.env.PORT || 3000, function() {
  console.log("Listening on port %d.", server.address().port);
});