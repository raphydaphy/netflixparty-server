var socket;
var userId;

var session;
var users = {};

jQuery(".data").text("undefined");
jQuery(".session-input").attr("placeholder", "undefined");

window.addEventListener("beforeunload", (event) => {
  if (socket) socket.emit("userDisconnected");
});

function addSessionUser(id, name) {
  jQuery("#session-users").children("ul").first().append(`<li id="session-user-${id}">${name}</li>`);
}

function removeSessionUser(id) {
  jQuery("#session-users").children("ul").first().children(`#session-user-${id}`).remove();
}

function endSession() {
  jQuery(".session-input").val("");
  jQuery("#session-service").val("netflix");
  jQuery("#session-owner").text("");
  jQuery("#session-lock").attr("disabled", false);
  jQuery("#session-lock").prop("checked", false);
  jQuery("#session-owner-li").hide();
  jQuery("#session-users").children("ul").first().html("");
  jQuery("#session-users").hide();
}

function initSession(newSession) {
  session = newSession;
  jQuery("#session-id").val(session.id);
  jQuery("#session-lock").prop("checked", newSession.ownerId);
  jQuery("#session-lock").attr("disabled", true);
  if (session.ownerId) {
    jQuery("#session-owner-li").show();
    jQuery("#session-owner").text(session.ownerId);
  }
  jQuery("#session-users").show();
  session.users.forEach(sessionUser => {
    if (users[sessionUser].active) {
      addSessionUser(sessionUser, users[sessionUser].name);
    } else {
      console.log("ignoring inactive user #" + sessionUser);
    }
  });
}

function getSessionInfo(context) {
  if (!socket) return { error:"Can't " + context + " a session without authenticating first!" };
  if (session) return { error:"Can't " + context + " a session while already in one!" };
  var videoService = jQuery("#session-service").val();
  if (!videoService || videoService == "") return { error:"Can't " + context + " a session without a video service!" };
  var videoId = jQuery("#session-video").val();
  if (!videoId || videoId == "") return { error:"Can't " + context + " a session without a video ID!" };
  return {
    videoService: videoService,
    videoId: parseInt(videoId)
  };
}

function initSocket(args) {
  socket = io("http://localhost:3000?" + args);

  socket.on("error", data => {
    console.warn("Authentication error: " + data);
  });

  socket.on("init", data => {
    console.debug(`Connected as ${data.userName} with icon ${data.userIcon} and id #${data.userId}!`);
    userId = data.userId;
    users[userId] = {
      id: userId,
      name: data.userName,
      icon: data.userIcon,
      typing: false,
      active: true
    }
    jQuery("#user-id").text(userId);
    jQuery("#user-name").text(data.userName);
    jQuery("#user-icon").text(data.userIcon);
  });

  socket.on("joinSession", data => {
    if (!session) return console.error("Recieved join message from user #" + data.userId + " despite not being in a session!");

    console.debug("User #" + data.userId + " joined the session!");
    users[data.userId] = {
      id: data.userId,
      name: data.userName,
      icon: data.userIcon,
      typing: false,
      active: true
    };

    session.users.push(data.userId);
    addSessionUser(data.userId, users[data.userId].name);
  });

  socket.on("leaveSession", data => {
    if (!session) return console.error("Recieved leave message from user #" + data.userId + " despite not being in a session!");
    if (!session.users.includes(data.userId)) return console.error("User #" + data.userId + " left session that they weren't in");
    console.debug("User #" + data.userId + " left the session!");

    users[data.userId].active = false;
    removeSessionUser(data.userId);
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
  socket = userId = session = null;
  jQuery(".data").text("undefined");
  endSession();
}

function createSession() {
  var info = getSessionInfo("create");
  if (info.error) return console.warn(info.error);

  socket.emit("createSession", {
    videoService: info.videoService,
    videoId: info.videoId,
    controlLock: jQuery("#session-lock").prop("checked")
  }, response => {
    if (response.error) return console.warn("Failed to create session:", response.error);
    console.debug("Created session #" + response.session.id);
    initSession(response.session);
  });
}

function joinSession() {
  var info = getSessionInfo("join");
  if (info.error) return console.warn(info.error);
  var joinId = jQuery("#session-id").val();
  if (!joinId || joinId.length == 0) return console.warn("Can't join session with empty ID!");
  
  socket.emit("joinSession", {
    id: joinId,
    videoService: info.videoService,
    videoId: info.videoId
  }, response => {
    if (response.error) return console.warn("Failed to join session:", response.error);
    console.debug("Joining session #" + joinId);
    users = response.users;
    initSession(response.session);
  });
}

function leaveSession() {
  if (!socket) return console.warn("Can't leave a session without authenticating first!");
  if (!session) return console.warn("Can't leave a session without joining one first!");
  console.debug("Left session #" + session.id);
  socket.emit("leaveSession");
  session = null;
  endSession();
}