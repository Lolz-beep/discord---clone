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
import { createServer, type IncomingMessage, type ServerResponse } from "http";
import { randomUUID } from "crypto";
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

/** One relayed bot music frame, recorded for the monitoring API. */
interface MusicLogEntry {
  at: number; // server clock when it was relayed
  action: string;
  videoId: string;
  title?: string;
  positionMs: number;
}

/** One join/leave, recorded for the monitoring API. */
interface RoomEvent {
  at: number;
  event: "joined" | "left";
  userId: string;
  displayName?: string;
  isBot?: boolean;
}

interface Room {
  members: Map<string, Member>; // userId -> member (humans AND bots)
  history: ChatMessage[];
  musicLog: MusicLogEntry[]; // last 100 music frames that passed through
  eventLog: RoomEvent[]; // last 200 joins/leaves
}

/** A bot credential issued via POST /api/bots/register (pairing flow). */
interface BotRecord {
  botId: string;
  botName: string;
  roomId: string;
  token: string;
  connected: boolean;
  ws?: WebSocket;
}

// All state is in-memory; it lives for the lifetime of the server process.
const rooms = new Map<string, Room>();
// Which room/user a given socket belongs to, so we can clean up on disconnect.
const socketState = new Map<WebSocket, { roomId: string; userId: string }>();
// Registered bots (botId -> record) and which socket belongs to which bot.
const registeredBots = new Map<string, BotRecord>();
const socketBots = new Map<WebSocket, string>();

// Optional pre-seeded bot credential, so docker-compose (or CI) can pair a
// bot without the UI flow: set SEED_BOT_TOKEN (+ SEED_BOT_ROOM, SEED_BOT_NAME).
if (process.env.SEED_BOT_TOKEN) {
  const seeded: BotRecord = {
    botId: "seeded-bot",
    botName: process.env.SEED_BOT_NAME ?? "MusicBot",
    roomId: process.env.SEED_BOT_ROOM ?? "general",
    token: process.env.SEED_BOT_TOKEN,
    connected: false,
  };
  registeredBots.set(seeded.botId, seeded);
  console.log(`> Seeded bot credential for room "${seeded.roomId}" (botId: ${seeded.botId})`);
}

function getRoom(roomId: string): Room {
  let room = rooms.get(roomId);
  if (!room) {
    room = { members: new Map(), history: [], musicLog: [], eventLog: [] };
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
  const member = room.members.get(state.userId);
  room.members.delete(state.userId);
  room.eventLog.push({
    at: Date.now(),
    event: "left",
    userId: state.userId,
    displayName: member?.user.displayName,
    isBot: member?.user.isBot,
  });
  if (room.eventLog.length > 200) room.eventLog.shift();

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
      // Bot handshake: a client with isBot:true must present a token issued
      // by POST /api/bots/register. Unknown/missing tokens are rejected, and
      // the token is only valid for the room it was registered for.
      if (msg.user.isBot) {
        const bot = [...registeredBots.values()].find((b) => b.token === msg.token);
        if (!bot) {
          send(ws, { type: "error", message: "Invalid or unknown bot token" });
          ws.close(4001, "invalid bot token");
          return;
        }
        if (bot.roomId !== msg.roomId) {
          send(ws, {
            type: "error",
            message: `Token is registered for room "${bot.roomId}", not "${msg.roomId}"`,
          });
          ws.close(4003, "wrong room for bot token");
          return;
        }
        // Pairing complete: the setup modal polls /api/bots/:botId/status
        // and flips to "Connected" off this flag.
        bot.connected = true;
        bot.ws = ws;
        socketBots.set(ws, bot.botId);
      }

      // A socket can only be in one room at a time; switching rooms implies
      // leaving the old one.
      removeFromRoom(wss, ws);

      const room = getRoom(msg.roomId);
      room.members.set(msg.user.id, { user: msg.user, ws });
      socketState.set(ws, { roomId: msg.roomId, userId: msg.user.id });
      room.eventLog.push({
        at: Date.now(),
        event: "joined",
        userId: msg.user.id,
        displayName: msg.user.displayName,
        isBot: msg.user.isBot,
      });
      if (room.eventLog.length > 200) room.eventLog.shift();

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
      // Mirror the frame into the room's music log for the monitoring API
      // (GET /api/rooms/:roomId/music).
      room.musicLog.push({
        at: Date.now(),
        action: msg.action,
        videoId: msg.videoId,
        title: msg.title,
        positionMs: msg.positionMs,
      });
      if (room.musicLog.length > 100) room.musicLog.shift();
      break;
    }

    case "musicEvent": {
      // Human clients report end-of-track; relay to the room's bots so the
      // bot (the source of truth) can auto-advance its queue. Bots may get
      // one report per human — deduping is the bot's job.
      const state = socketState.get(ws);
      const sender = state && rooms.get(state.roomId)?.members.get(state.userId);
      if (!sender || sender.user.isBot) return; // only humans report playback
      const room = rooms.get(msg.roomId);
      if (!room) return;
      for (const member of room.members.values()) {
        if (member.user.isBot) send(member.ws, msg);
      }
      break;
    }
  }
}

// ---------------------------------------------------------------------------
// REST API for the bot pairing flow (issue credentials -> user starts their
// separate bot process -> the setup modal polls until it connects).
// ---------------------------------------------------------------------------

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let data = "";
    req.on("data", (chunk) => {
      data += chunk;
      if (data.length > 64 * 1024) {
        reject(new Error("body too large"));
        req.destroy();
      }
    });
    req.on("end", () => {
      try {
        resolve(data ? JSON.parse(data) : {});
      } catch (err) {
        reject(err);
      }
    });
    req.on("error", reject);
  });
}

/** Handles /api/* routes. Returns false if the path isn't ours. */
async function handleApi(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string
): Promise<boolean> {
  const method = req.method ?? "GET";

  // POST /api/bots/register -> issue credentials for a new (pending) bot.
  if (pathname === "/api/bots/register" && method === "POST") {
    let body: Record<string, unknown>;
    try {
      body = await readJsonBody(req);
    } catch {
      json(res, 400, { error: "invalid JSON body" });
      return true;
    }
    const roomId = typeof body.roomId === "string" ? body.roomId.trim() : "";
    const botName =
      typeof body.botName === "string" && body.botName.trim()
        ? body.botName.trim()
        : "MusicBot";
    if (!roomId) {
      json(res, 400, { error: "roomId is required" });
      return true;
    }
    const bot: BotRecord = {
      botId: randomUUID(),
      botName,
      roomId,
      token: randomUUID(),
      connected: false,
    };
    registeredBots.set(bot.botId, bot);
    // Derive the ws URL from how this request reached us, so it works through
    // tunnels (ngrok/cloudflared) too.
    const proto =
      (req.headers["x-forwarded-proto"] as string) === "https" ? "wss" : "ws";
    const host = req.headers.host ?? `localhost:${port}`;
    json(res, 201, {
      botId: bot.botId,
      token: bot.token,
      wsUrl: `${proto}://${host}/ws`,
      roomId: bot.roomId,
    });
    return true;
  }

  // GET /api/rooms -> active rooms (for the modal's room dropdown).
  if (pathname === "/api/rooms" && method === "GET") {
    json(res, 200, {
      rooms: [...rooms.entries()].map(([name, room]) => ({
        name,
        count: [...room.members.values()].filter((m) => !m.user.isBot).length,
      })),
    });
    return true;
  }

  // GET /api/bots -> every registered bot with its live status (monitoring).
  if (pathname === "/api/bots" && method === "GET") {
    json(res, 200, {
      bots: [...registeredBots.values()].map(({ ws: _ws, ...bot }) => bot),
    });
    return true;
  }

  // GET /api/rooms/:roomId/(members|messages|music|events)
  // Read-only monitoring: the REST API never changes room state — all the
  // real action happens over the WebSocket. These let tools like Postman
  // watch what's going on.
  const roomMonitor = pathname.match(
    /^\/api\/rooms\/([^/]+)\/(members|messages|music|events)$/
  );
  if (roomMonitor && method === "GET") {
    const roomId = decodeURIComponent(roomMonitor[1]);
    const room = rooms.get(roomId);
    if (!room) {
      json(res, 404, { error: `room "${roomId}" does not exist` });
      return true;
    }
    switch (roomMonitor[2]) {
      case "members":
        json(res, 200, {
          roomId,
          members: [...room.members.values()].map((m) => m.user),
        });
        return true;
      case "messages":
        json(res, 200, { roomId, count: room.history.length, messages: room.history });
        return true;
      case "music": {
        // Playback state as observed by the server (the bot's music frames
        // pass through here, so this is an accurate mirror).
        const lastTrack = [...room.musicLog].reverse().find((e) => e.action !== "seek");
        const nowPlaying =
          lastTrack && lastTrack.action !== "stop"
            ? {
                videoId: lastTrack.videoId,
                title: lastTrack.title ?? null,
                state: lastTrack.action === "pause" ? "paused" : "playing",
                since: lastTrack.at,
              }
            : null;
        json(res, 200, { roomId, nowPlaying, log: room.musicLog });
        return true;
      }
      case "events":
        json(res, 200, { roomId, events: room.eventLog });
        return true;
    }
  }

  // GET /api/bots/:idOrToken/status | DELETE /api/bots/:idOrToken
  // Accepts EITHER the botId or the token — you already know your own token
  // (it's in the bot's .env), so no need to remember a separate id.
  const botMatch = pathname.match(/^\/api\/bots\/([^/]+)(\/status)?$/);
  if (botMatch) {
    const key = decodeURIComponent(botMatch[1]);
    const bot =
      registeredBots.get(key) ??
      [...registeredBots.values()].find((b) => b.token === key);
    if (method === "GET" && botMatch[2] === "/status") {
      if (!bot) {
        json(res, 404, { error: "unknown bot (looked up by id and by token)" });
        return true;
      }
      json(res, 200, {
        botId: bot.botId,
        botName: bot.botName,
        roomId: bot.roomId,
        connected: bot.connected,
      });
      return true;
    }
    if (method === "DELETE" && !botMatch[2]) {
      if (!bot) {
        json(res, 404, { error: "unknown bot (looked up by id and by token)" });
        return true;
      }
      registeredBots.delete(bot.botId);
      // Revoking a connected bot kicks its socket; the close handler then
      // removes it from its room and notifies members.
      bot.ws?.close(4002, "bot revoked");
      json(res, 200, { ok: true });
      return true;
    }
  }

  if (pathname.startsWith("/api/")) {
    json(res, 404, { error: "not found" });
    return true;
  }
  return false;
}

const app = next({ dev });
const handle = app.getRequestHandler();

app.prepare().then(() => {
  // Must be obtained after prepare(); routes non-/ws upgrades (Next HMR) to Next.
  const handleUpgrade = app.getUpgradeHandler();

  const server = createServer(async (req, res) => {
    const parsedUrl = parse(req.url ?? "/", true);
    try {
      if (await handleApi(req, res, parsedUrl.pathname ?? "/")) return;
    } catch (err) {
      console.error("api error", err);
      if (!res.headersSent) json(res, 500, { error: "internal error" });
      return;
    }
    handle(req, res, parsedUrl);
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

    const cleanup = () => {
      removeFromRoom(wss, ws);
      // If this socket was a paired bot, mark it disconnected so the status
      // endpoint (and any open setup modal) reflects reality.
      const botId = socketBots.get(ws);
      if (botId) {
        socketBots.delete(ws);
        const bot = registeredBots.get(botId);
        if (bot) {
          bot.connected = false;
          bot.ws = undefined;
        }
      }
    };
    ws.on("close", cleanup);
    ws.on("error", cleanup);
  });

  server.on("error", (err: NodeJS.ErrnoException) => {
    if (err.code === "EADDRINUSE") {
      console.error(
        `Port ${port} is already in use — another instance of this server ` +
          `(npm run dev / npm start) is probably still running.\n` +
          `Stop it, or run on another port:  $env:PORT = "3001"; npm run dev`
      );
      process.exit(1);
    }
    throw err;
  });

  server.listen(port, () => {
    console.log(
      `> Discord clone ready on http://localhost:${port} (ws endpoint: /ws, ${dev ? "dev" : "prod"})`
    );
  });
});
