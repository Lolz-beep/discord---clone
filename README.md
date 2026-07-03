# Discord Clone

A minimal Discord-style web app: real-time text chat, voice, video, and screen
sharing in named rooms, built with Next.js (App Router, TypeScript), Tailwind
CSS, a custom `ws` WebSocket server, and peer-to-peer WebRTC (mesh, STUN only).

## Setup & run

```bash
npm install
npm run dev          # development (custom server with Next.js HMR)
```

Open `http://localhost:3000`, enter a display name, then create/join a room by
name in the sidebar. Open a second tab (or browser) with a different name and
join the same room to talk to yourself.

Production:

```bash
npm run build
npm start            # runs server.ts with NODE_ENV-equivalent prod mode (--prod)
```

Everything runs in **one process**: `server.ts` starts the Next.js request
handler and attaches the WebSocket server at `ws://<host>/ws`. There is no
separate socket process. (Next.js API routes don't hold long-lived sockets
well, hence the custom server.) State is in-memory — rooms and chat history
live for the lifetime of the server process; there is no database.

An external **bot** (e.g. a music bot) is a *separate project/process* that
connects to `ws://<host>/ws` as a client — see "Bot integration" below. A
ready-made YouTube music bot lives in [music-bot/](music-bot/) with its own
README and `npm install` / `npm start`.

## Browser permission notes

- `getUserMedia` (mic/camera) and `getDisplayMedia` (screen) only work in a
  **secure context**: `https://` or `http://localhost`. Plain `http://` on a
  LAN IP will not get media permissions.
- To test across two devices, either:
  - tunnel: `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`
    (WebSocket upgrade is proxied automatically), or
  - use a locally-trusted cert (e.g. `mkcert`) and terminate TLS in front of
    the app.
- Media is peer-to-peer mesh with **STUN only** (`stun:stun.l.google.com:19302`,
  no TURN), so peers behind symmetric NATs / strict firewalls may fail to
  connect media even though chat (which rides the WebSocket) still works.
- Autoplay policy: bot-driven music plays in a small YouTube panel
  (bottom-right). If the browser blocks unmuted autoplay, the panel shows a
  "Click to start playback" overlay — click it once.

## WebSocket message protocol

Endpoint: `ws://<host>/ws`. Every frame is one JSON object with a `type`
field. Types are defined in [lib/protocol.ts](lib/protocol.ts).

### Client → server

| Type | Shape | Notes |
| --- | --- | --- |
| `join` | `{ type, roomId, user: { id, displayName, isBot? }, token? }` | Joins (or creates) a room. A socket is in at most one room; joining another implies leaving. Bots (`isBot: true`) must send a `token` issued by `POST /api/bots/register`, and may only join the room the token was registered for. |
| `leave` | `{ type, roomId, userId }` | Leave the room. Also inferred on socket close. |
| `chat` | `{ type, roomId, user, text, timestamp }` | Broadcast to **all** room members, including bots and the sender (the echo is what clients render). |
| `signal` | `{ type, roomId, from, to, kind: "offer"\|"answer"\|"ice", payload }` | WebRTC signaling; relayed verbatim to the `to` user only. |
| `media` | `{ type, roomId, userId, micOn, camOn, screenOn }` | Local media flags so others can render mute icons / avatar placeholders. Sent to humans only. |
| `music` | `{ type, roomId, action, videoId, title?, positionMs, serverTimestamp }` | **Bot-only** (ignored from humans). Relayed unchanged to all human clients in the room; `action` is not interpreted by the server. `title` is an optional bot extra for the Now Playing chip. |
| `musicEvent` | `{ type, roomId, event: "ended", videoId }` | **Human-only** (ignored from bots). Sent by a client when the current YouTube video finishes; relayed to the room's bots so the bot can auto-advance its queue. |

### Server → client

| Type | Shape | Notes |
| --- | --- | --- |
| `peers` | `{ type, roomId, users[] }` | Sent to a joiner: everyone already in the room (bots included, flagged `isBot`). The joiner initiates WebRTC offers to each non-bot user. |
| `history` | `{ type, roomId, messages[] }` | Sent to a joiner: the room's session chat history (last 500). |
| `presence` | `{ type, roomId, userId, user?, event: "joined"\|"left" }` | `user` is included on `joined`. On `left`, clients tear down that peer's connection and tiles. |
| `chat`, `signal`, `media`, `music`, `musicEvent` | as above | Relayed/broadcast forms of the client messages (`music` goes to humans, `musicEvent` to bots). |
| `rooms` | `{ type, rooms: [{ name, count }] }` | Room list for the sidebar (human member counts); pushed on connect and whenever membership changes. |
| `error` | `{ type, message }` | e.g. a bot joining with an unknown token (socket then closes: `4001` invalid token, `4002` revoked, `4003` wrong room). |

### WebRTC call flow (mesh)

Documented in detail in [lib/mesh.ts](lib/mesh.ts). Summary:

1. Joiner receives `peers` and creates one `RTCPeerConnection` per existing
   human — the **joiner always initiates**, so offers never collide (no glare).
2. The initiator pre-adds three transceivers in a fixed order —
   `[mic audio, camera video, screen video]` — so both sides can classify
   incoming tracks by transceiver index without extra signaling, and toggling
   mic/cam/screen later is a plain `replaceTrack` with **no renegotiation**.
3. `offer` → `answer` → trickled `ice` candidates, all as `signal` messages
   relayed by the server. Candidates arriving before the remote description
   are queued.
4. On `presence: left` (or socket close), everyone closes that peer's
   connection and removes their tiles.

## Bot integration (pairing flow)

The clone contains **no bot logic** — only the transport hook, a pairing API,
and client-side playback. The bot is a **separate process**; the clone issues
it credentials, you start it yourself, and the clone confirms it connected.

### Pairing from the UI

1. Join a room and click **🤖 Integrate Bot** in the top bar.
2. Step 1 — pick a bot name (default `MusicBot`) and room, then
   **Generate connection**.
3. Step 2 — copy the credentials (`WS_URL`, `TOKEN`, `ROOM_ID`), paste the
   `.env` snippet into your bot project, and start the bot (e.g. `npm start`).
4. Step 3 — the modal polls the status endpoint every ~2s and flips from
   "Waiting for bot to connect…" to "Connected ✓" once the bot's WebSocket
   handshake lands. Closing the modal early keeps the pending registration
   (reopen to resume); **Cancel** revokes it.

### REST API (all in-memory, prototype-grade)

| Endpoint | Method | Body / Response |
| --- | --- | --- |
| `/api/bots/register` | POST | body `{ roomId, botName }` → `201 { botId, token, wsUrl, roomId }`. Creates a pending bot record (`connected: false`); `token` is a random UUID. |
| `/api/bots/:botId/status` | GET | `{ botId, botName, connected }` — the modal polls this. |
| `/api/bots/:botId` | DELETE | Revokes the registration; a connected bot's socket is closed (code `4002`). |
| `/api/rooms` | GET | `{ rooms: [{ name, count }] }` — active rooms for the modal's dropdown. |

### What the bot must do

Read three env vars and use them in its `join` handshake — nothing else about
the bot changes:

```bash
WS_URL=ws://localhost:3000/ws
BOT_TOKEN=<token from the modal>
ROOM_ID=<room the token was registered for>
```

1. Connect to `WS_URL`.
2. Send `join` with `isBot: true`, `roomId: ROOM_ID`, and `token: BOT_TOKEN`.
   The token must match a registered bot record **and** its room; otherwise
   the server sends an `error` frame and closes the socket (`4001` unknown
   token, `4003` wrong room). On success the record flips to
   `connected: true` (and back to `false` when the socket closes).
3. Receive every `chat` message in its room — including messages starting
   with `/`, so it can implement slash commands however it likes.
4. Send `music` frames, which the server relays **unchanged** to all human
   clients in the room (never back to bots). The server does not interpret
   `action`.
5. Receive `musicEvent { event: "ended", videoId }` from human clients when
   the current video finishes (one report per human — dedupe accordingly)
   and advance its own queue.

```js
// minimal-bot.mjs — run with: node minimal-bot.mjs   (npm i ws)
import WebSocket from "ws";
const { WS_URL, BOT_TOKEN, ROOM_ID } = process.env;
const ws = new WebSocket(WS_URL);
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "join", roomId: ROOM_ID,
    user: { id: "bot-1", displayName: "MusicBot", isBot: true },
    token: BOT_TOKEN,
  }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "chat" && msg.text.startsWith("/play")) {
    ws.send(JSON.stringify({
      type: "music", roomId: ROOM_ID, action: "play",
      videoId: "dQw4w9WgXcQ", title: "Song",
      positionMs: 0, serverTimestamp: Date.now(),
    }));
  }
});
```

The full-featured version of this (queue, loop modes, oEmbed titles, the
design-pattern architecture) is the [music-bot/](music-bot/) project.

On the human clients, a small YouTube IFrame player (bottom-right panel)
loads `videoId`, seeks to `positionMs + (now − serverTimestamp)` for rough
sync, and a "Now Playing" chip appears in the top bar.
`pause`/`resume`/`seek`/`stop` are obeyed the same way, and when the video
ends the client reports `musicEvent: ended` back so the bot can advance its
queue; the bot is the source of truth.

## Project layout

```text
server.ts               custom Next.js server: ws hub (rooms, relay, bot hook) + pairing REST API
lib/protocol.ts         shared typed message protocol
lib/mesh.ts             WebRTC mesh manager (signaling flow commented)
components/AppShell.tsx top-level client component: socket, media, state
components/BotModal.tsx bot pairing modal (register -> credentials -> live status)
components/YouTubePlayer.tsx  bot-driven YouTube IFrame playback + ended reporting
components/*.tsx        Sidebar / TopBar / ChatPanel / VideoGrid / ControlBar / NameGate
app/                    App Router shell (page is a Server Component)
music-bot/              standalone YouTube music bot (own package.json + README)
```
