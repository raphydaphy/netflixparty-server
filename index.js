const express = require("express");
const mysql = require("mysql");
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

/***************************
 * Generic Helper Functions
 ***************************/

// generate a random hash with 64 bits of entropy
function hash64() {
  var result = "";
  var hexChars = "0123456789abcdef";
  for (var i = 0; i < 16; i += 1) {
    result += hexChars[Math.floor(Math.random() * 16)];
  }
  return result;
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
  if (process.argv.includes("--setupdb") || process.env.SETUP_DB == "SETUP_DB") {
    console.log("Performing initial database setup...");
    var sql = `
      CREATE TABLE users ( 
        id INT NOT NULL AUTO_INCREMENT COMMENT "unique user id", 
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
  res.send("OK");
});

app.get("/create-user", function(req,res) {
  res.setHeader("Content-Type", "text/json");

  // Use a default username if no name is provided
  var name = req.query.name || usernames[Math.floor(Math.random() * usernames.length)];
  var icon = icons[Math.floor(Math.random() * icons.length)];

  // Name has a maximum length of 16 characters in the database
  name = name.substring(0, 16);

  var sql = `INSERT INTO users (name, icon) VALUES ("${name}", "${icon}")`;
  con.query(sql, function(err, result) {
    if (err) {
      res.send({error: err });
      throw err;
    }
    console.log("Created user #" + result.insertId);
    res.send({
      id: result.insertId,
      name: name,
      icon: icon
    });
  });
});

app.post("/log-event", function(req, res) {
  // TODO: logging
  console.log(req.body);
});

/****************
 * Socket Events
 ****************/

io.on("connection", function(socket) {
  socket.emit("userId", {
    userId: "0"
  });
});

/*************
 * Web Server
 *************/

var server = http.listen(process.env.PORT || 3000, function() {
  console.log("Listening on port %d.", server.address().port);
});