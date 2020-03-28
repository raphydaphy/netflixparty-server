var socket;
var userId;
var userName;
var sessionId;

jQuery(".data").text("undefined");

window.addEventListener("beforeunload", (event) => {
  if (socket) socket.emit("userDisconnected");
});

function addSessionUser(id, name) {
  jQuery("#session-users").children("ul").first().append(`<li id="session-user-${id}">${name}</li>`);
}

function removeSessionUser(id) {
  jQuery("#session-users").children("ul").first().children(`#session-user-${id}`).remove();
}

function clearSessionUsers() {
  jQuery("#session-users").children("ul").first().html("");
  jQuery("#session-users").hide();
}

function initSocket(args) {
  socket = io("http://localhost:3000?" + args);

  socket.on("error", data => {
    console.warn("Authentication error: " + data);
  });

  socket.on("init", data => {
    console.debug(`Connected as ${data.userName} with icon ${data.userIcon} and id #${data.userId}!`);
    userId = data.userId;
    userName = data.userName;
    jQuery("#user-id").text(userId);
    jQuery("#user-name").text(userName);
    jQuery("#user-icon").text(data.userIcon);
  });

  socket.on("disconnect", reason => {
    if (reason == "io server disconnect") {
      console.debug("Socket was disconnected by the server");
    }
  });
 }

function login() {
  if (socket) return console.warn("Can't login multiple times!");
  initSocket("userid=1&token=3791c5ec9bbd4fe6");
}

function loginIncognito() {
  if (socket) return console.warn("Can't login multiple times!");
  initSocket("incognito=true");
}

function logout() {
  if (!socket) return console.warn("Can't logout without logging in first!");
  socket.emit("userDisconnected");
  socket = userId = sessionId = null;
  jQuery(".data").text("undefined");
  jQuery("#session-id").val("");
  clearSessionUsers();
}

function createSession() {
  if (!socket) return console.warn("Can't create a session without authenticating first!");
  if (sessionId) return console.warn("Can't create a session while already in one!");
  socket.emit("createSession", {
    videoService: "netflix",
    videoId: 3,
    controlLock: true
  }, response => {
    if (response.error) return console.warn("Failed to create session: ", response.error);
    console.debug("Created session #" + response.sessionId);
    sessionId = response.sessionId;
    jQuery("#session-id").val(sessionId);
    jQuery("#session-users").show();
    addSessionUser(userId, userName);
  });
}

function joinSession() {
  if (!socket) return console.warn("Can't join a session without authenticating first!");
  if (sessionId) return console.warn("Can't join a session while already in one!");
  var joinId = jQuery("#session-id").val();
  if (!joinId && joinId.length == 0) return console.warn("Can't join empty session with empty ID!");
  console.debug("Joining session #" + joinId);
}

function leaveSession() {
  if (!socket) return console.warn("Can't leave a session without authenticating first!");
  if (!sessionId) return console.warn("Can't leave a session without joining one first!");
  console.debug("Left session #" + sessionId);
  socket.emit("leaveSession");
  sessionId = null;
  jQuery("#session-id").val("");
  clearSessionUsers();
}