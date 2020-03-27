const express = require("express");
const app = express();

var http = require("http").createServer(app);
var io = require("socket.io")(http);

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

/****************
 * Web Endpoints
 ****************/

app.get("/", function(req, res) {
  res.setHeader('Content-Type', 'text/plain');
  res.send('OK');
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