var socket;
var userId;

var session;
var users = {};

var typingTimer = null;

jQuery(".data").text("undefined");
jQuery(".session-input").attr("placeholder", "undefined");

window.addEventListener("beforeunload", (event) => {
  if (socket) socket.emit("userDisconnected");
});

function removeLike(data) {
  if (!users.hasOwnProperty(data.userId)) {
    console.warn("Tried toremove like from unknown user " + data.userId + " for message with id " + data.msgId);
    return;
  } else if (!session.messages.hasOwnProperty(data.msgId)) {
    console.warn("User " + data.userId + " tried to unlike unknown message " + data.msgId);
    return;
  }

  var msg = session.messages[data.msgId];
  delete msg.likes[data.userId];

  var likesHtml = jQuery("#msg-" + msg.id).children(".liked-by");
  if (Object.keys(msg.likes).length > 0) {
    var likesString;
    for (var like in msg.likes) {
      var name = users[like].name;
      if (likesString) {
        likesString += " and " + name;
      } else {
        likesString = "Liked by " + name;
      }
    }
    likesHtml.text(likesString);
  } else {
    likesHtml.remove();
  }
}

function addLike(data, updateArray=true) {
  if (!users.hasOwnProperty(data.userId)) {
    console.warn("Recieved like from unknown user " + data.userId + " for message with id " + data.msgId);
    return;
  } else if (!session.messages.hasOwnProperty(data.msgId)) {
    console.warn("User " + data.userId + " tried to like unknown message " + data.msgId);
    return;
  }

  var msg = session.messages[data.msgId];

  if (updateArray) {
     msg.likes[data.userId] = {
      userId: data.userId,
      timestamp: data.timestamp
    }; 
  }

  var msgHtml = jQuery("#msg-" + msg.id);
  var userName = users[data.userId].name;

  if (msgHtml.children(".liked-by").length > 0) {
    msgHtml.children(".liked-by").first().append(" and " + userName)
  } else {
    msgHtml.append(`
    <font class="liked-by" size="1">Liked by ${users[data.userId].name}</font>
  `);
  }
}

function addMessage(message) {
  session.messages[message.id] = message;
  var msgStr = `${users[message.userId].name}: ${message.content}`;
  if (message.isSystemMsg) {
    msgStr = `<i>${users[message.userId].name} ${message.content}</i>`;
  }
  jQuery("#chat-history").append(`
    <div class="chat-message" id="msg-${message.id}">
      <div class="msg-txt">${msgStr}</div>
    </div>
  `);

  for (var like in message.likes) {
    addLike({
      msgId: message.id,
      userId: like
    }, false);
  }

  jQuery("#chat-history").scrollTop(jQuery("#chat-history").prop("scrollHeight"));
  jQuery("#msg-" + message.id).dblclick(e => {
    if (message.isSystemMsg) return;
    // For simpler testing, liking a previously liked message will remove the like
    if (message.likes.hasOwnProperty(userId)) {
      socket.emit("unlikeMessage", {
        msgId: message.id
      });
    } else {
      socket.emit("likeMessage", {
        msgId: message.id
      });
    }
  });
}

function addSessionUser(id, name) {
  jQuery("#session-users").children("ul").first().append(`<li id="session-user-${id}">${name}</li>`);
}

function removeSessionUser(id) {
  jQuery("#session-users").children("ul").first().children(`#session-user-${id}`).remove();
}

function setChatVisible(visible) {
  jQuery("#main").css("position", visible ? "absolute" : "");
  jQuery("#chat-container-outer").attr("hidden", !visible);
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
  jQuery("#chat-history").html("");
  setChatVisible(false);
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
  setChatVisible(true);

  session.users.forEach(sessionUser => {
    if (users[sessionUser].active) {
      addSessionUser(sessionUser, users[sessionUser].name);
    } else {
      console.log("ignoring inactive user #" + sessionUser);
    }
  });

  for (var messageId in session.messages) {
    addMessage(session.messages[messageId]);
  }
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
    console.debug(`Connected as ${data.user.name} with icon ${data.user.icon} and id #${data.user.id}!`);
    userId = data.user.id;
    users[userId] = data.user;
    jQuery("#user-id").text(userId);
    jQuery("#user-name").text(data.user.name);
    jQuery("#user-icon").text(data.user.icon);
  });

  /******************
   * Session Events *
   ******************/

  socket.on("joinSession", data => {
    if (!session) return console.error("Recieved join message from user #" + data.user.id + " despite not being in a session!");

    console.debug("User #" + data.user.id + " joined the session!");
    users[data.user.id] = data.user;

    session.users.push(data.user.id);
    addSessionUser(data.user.id, data.user.name);
    addMessage(data.message);
  });

  socket.on("leaveSession", data => {
    if (!session) {
      return console.error("Recieved leave message from user #" + data.userId + " despite not being in a session!");
    } else if (!session.users.includes(data.userId)) {
      return console.error("User #" + data.userId + " left session that they weren't in");
    }

    console.debug("User #" + data.userId + " left the session!");
    addMessage(data.message);
    users[data.userId].active = false;
    removeSessionUser(data.userId);
  });

  socket.on("disconnect", reason => {
    if (reason == "io server disconnect") {
      console.debug("Socket was disconnected by the server");
    }
  });

  /***************
   * Chat Events *
   ***************/

  socket.on("sendMessage", data => {
    if (!session) {
      return console.error("Recieved message despite not being in a session", data.message);
    } else if (!session.users.includes(data.message.userId)) {
      return console.error("Recieved message from user in a different session", data.message);
    }
    addMessage(data.message);
  });

  socket.on("likeMessage", data => addLike(data));
  socket.on("unlikeMessage", data => removeLike(data));

  socket.on("typing", data => {
    if (!session) {
      return console.error("Recieved typing status despite not being in a session", data);
    } else if (!users.hasOwnProperty(data.userId)) {
      return console.warn("Tried to update typing status for unknown user #" + data.userId);
    } else if (!session.users.includes(data.userId)) {
      return console.error("Recieved typing status from user in a different session", data);
    }
    users[data.userId].typing = data.typing;
    var typingUsers = [];
    for (var user in users) {
      if (users[user].typing) {
        typingUsers.push(user);
      }
    }
    var typingMsg = typingUsers.length + " people are typing...";
    if (typingUsers.length == 2) {
      typingMsg = users[typingUsers[0]].name + " and " + users[typingUsers[1]].name + " are typing...";
    } else if (typingUsers.length == 1) {
      typingMsg = users[typingUsers[0]].name + " is typing...";
    } else if (typingUsers.length == 0) {
      typingMsg = "<br />";
    }
    jQuery("#presence-indicator").html(typingMsg);
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

jQuery("#chat-input").keyup(function(e) {
  e.stopPropagation();

  // event keycode 13 is the enter key
  if (e.which === 13) {
    var content = jQuery("#chat-input").val().replace(/^\s+|\s+$/g, "");
    if (content !== "") {
      if (typingTimer !== null) {
        clearTimeout(typingTimer);
        typingTimer = null;
        socket.emit("typing", {
          typing: false
        });
      }
      
      jQuery("#chat-input").prop("disabled", true);
      socket.emit("sendMessage", {
        content: content,
        isSystemMsg: false
      }, function() {
        jQuery("#chat-input").val("").prop("disabled", false).focus();
        if (response.error) return console.warn("Failed to send message:", response.error);
        addMessage(response.message);
      });
    }
  } else {
    if (typingTimer === null) {
      socket.emit("typing", { 
        typing: true 
      });
    } else {
      clearTimeout(typingTimer);
    }
    typingTimer = setTimeout(function() {
      typingTimer = null;
      socket.emit("typing", { 
        typing: false 
      });
    }, 500);
  }
});