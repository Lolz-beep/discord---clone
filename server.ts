/**
 * Custom Next.js server with a single `ws` WebSocket endpoint at /ws.
 *
 * Next.js API routes can't hold long-lived sockets well, so this process owns
 * both the Next.js request handler and the WebSocket server. The ONE socket
 * carries: chat messages, WebRTC signaling (offer/answer/ICE), presence, and
 * bot "music" events. See lib/protocol.ts for the message types and README.md
 * for the protocol documentation.
 *
 * Run: `npm run dev` (development) or `npm run build && npm start` (production).
 */
import { createServer } from "http";
import { parse } from "url";
import next from "next";
import { WebSocketServer, WebSocket } from "ws";
import type {
  ChatMessage,
  ClientMessage,
  ServerMessage,
  User,
} from "./lib/protocol";

const dev = !process.argv.includes("--prod");
const port = parseInt(process.env.PORT ?? "3000", 10);
const MAX_HISTORY = 500; // chat messages kept per room (in-memory, for the session)

interface Member {
  user: User;
  ws: WebSocket;
}

interface Room {
  members: Map<string, Member>; // userId -> member (humans AND bots)
  history: ChatMessage[];
}

// All state is in-memory; it lives for the lifetime of the server process.
const rooms = new Map<string, Room>();
// Which room/user a given socket belongs to, so we can clean up on disconnect.
const socketState = new Map<WebSocket, { roomId: string; userId: string }>();

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { members: new Map(), history: [] };
    rooms.set(roomId, room);
  }
  return room;
}

function send(ws: WebSocket, msg: ServerMessage) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
}

/** Broadcast to every member of a room. Bots are members too, so they see all
 *  chat (including "/" slash commands). Use humansOnly for media/music/signal
 *  traffic that bots don't participate in. */
function broadcast(
  room: Room,
  msg: ServerMessage,
  opts: { exceptUserId?: string; humansOnly?: boolean } = {}
) {
  for (const [userId, member] of room.members) {
    if (userId === opts.exceptUserId) continue;
    if (opts.humansOnly && member.user.isBot) continue;
    send(member.ws, msg);
  }
}

/** Push the current room list (name + human member count) to every socket. */
function broadcastRoomList(wss: WebSocketServer) {
  const list: ServerMessage = {
    type: "rooms",
    rooms: [...rooms.entries()].map(([name, room]) => ({
      name,
      count: [...room.members.values()].filter((m) => !m.user.isBot).length,
    })),
  };
  const payload = JSON.stringify(list);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function removeFromRoom(wss: WebSocketServer, ws: WebSocket) {
  const state = socketState.get(ws);
  if (!state) return;
  socketState.delete(ws);

  const room = rooms.get(state.roomId);
  if (!room) return;
  room.members.delete(state.userId);

  // Tell everyone left in the room so they tear down peer connections/tiles.
  broadcast(room, {
    type: "presence",
    roomId: state.roomId,
    userId: state.userId,
    event: "left",
  });
  broadcastRoomList(wss);
}

function handleMessage(wss: WebSocketServer, ws: WebSocket, msg: ClientMessage) {
  switch (msg.type) {
    case "join": {
      // Bot handshake: any client with isBot:true must present a non-empty
      // token. For this prototype ANY non-empty token is accepted.
      if (msg.user.isBot && !(typeof msg.token === "string" && msg.token.length > 0)) {
        send(ws, { type: "error", message: "Bots must provide a non-empty token" });
        ws.close(4001, "missing bot token");
        return;
      }

      // A socket can only be in one room at a time; switching rooms implies
      // leaving the old one.
      removeFromRoom(wss, ws);

      const room = getRoom(msg.roomId);
      room.members.set(msg.user.id, { user: msg.user, ws });
      socketState.set(ws, { roomId: msg.roomId, userId: msg.user.id });

      // Tell the joiner who is already here. The joiner initiates WebRTC
      // offers to every non-bot user in this list (mesh topology).
      send(ws, {
        type: "peers",
        roomId: msg.roomId,
        users: [...room.members.values()]
          .filter((m) => m.user.id !== msg.user.id)
          .map((m) => m.user),
      });
      // Session chat history so late joiners see the conversation.
      send(ws, { type: "history", roomId: msg.roomId, messages: room.history });

      // Tell existing members someone arrived (they wait for the joiner's offer).
      broadcast(
        room,
        {
          type: "presence",
          roomId: msg.roomId,
          userId: msg.user.id,
          user: msg.user,
          event: "joined",
        },
        { exceptUserId: msg.user.id }
      );
      broadcastRoomList(wss);
      break;
    }

    case "leave": {
      removeFromRoom(wss, ws);
      break;
    }

    case "chat": {
      const room = rooms.get(msg.roomId);
      if (!room) return;
      const chat: ChatMessage = {
        roomId: msg.roomId,
        user: msg.user,
        text: msg.text,
        timestamp: msg.timestamp || Date.now(),
      };
      room.history.push(chat);
      if (room.history.length > MAX_HISTORY) room.history.shift();
      // Everyone INCLUDING bots and the sender (the echo is the render source
      // of truth, so all clients show identical ordering).
      broadcast(room, { type: "chat", ...chat });
      break;
    }

    case "signal": {
      // WebRTC signaling relay: deliver offer/answer/ICE only to its target.
      const room = rooms.get(msg.roomId);
      const target = room?.members.get(msg.to);
      if (target) send(target.ws, msg);
      break;
    }

    case "media": {
      // Mic/cam/screen state flags, mirrored to other humans for tile UI.
      const room = rooms.get(msg.roomId);
      if (!room) return;
      broadcast(room, msg, { exceptUserId: msg.userId, humansOnly: true });
      break;
    }

    case "music": {
      // Bot integration hook: relay bot-originated music events to all HUMAN
      // clients in the room, payload untouched. The server does not interpret
      // `action` — the bot is the source of truth, clients just obey.
      const state = socketState.get(ws);
      const sender = state && rooms.get(state.roomId)?.members.get(state.userId);
      if (!sender?.user.isBot) return; // only bots may drive music
      const room = rooms.get(msg.roomId);
      if (!room) return;
      broadcast(room, msg, { humansOnly: true });
      break;
    }
  }
}

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Must be obtained after prepare(); routes non-/ws upgrades (Next HMR) to Next.
  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer((req, res) => {
    handle(req, res, parse(req.url ?? "/", true));
  });

  const wss = new WebSocketServer({ noServer: true });

  // Route upgrade requests: /ws is ours, everything else (e.g. Next.js HMR in
  // dev) goes to Next.
  server.on("upgrade", (req, socket, head) => {
    const { pathname } = parse(req.url ?? "/");
    if (pathname === "/ws") {
      wss.handleUpgrade(req, socket, head, (ws) => wss.emit("connection", ws, req));
    } else {
      handleUpgrade(req, socket, head);
    }
  });

  wss.on("connection", (ws) => {
    // New sockets immediately learn the room list for the sidebar.
    broadcastRoomList(wss);

    ws.on("message", (data) => {
      let msg: ClientMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        send(ws, { type: "error", message: "invalid JSON" });
        return;
      }
      try {
        handleMessage(wss, ws, msg);
      } catch (err) {
        console.error("error handling message", msg?.type, err);
      }
    });

    ws.on("close", () => removeFromRoom(wss, ws));
    ws.on("error", () => removeFromRoom(wss, ws));
  });

  server.listen(port, () => {
    console.log(
      `> Discord clone ready on http://localhost:${port} (ws endpoint: /ws, ${dev ? "dev" : "prod"})`
    );
  });
});
