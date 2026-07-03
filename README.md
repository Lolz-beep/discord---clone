# Discord Clone

A minimal Discord-style web app: real-time text chat, voice, video, and screen
sharing in named rooms, built with Next.js (App Router, TypeScript), Tailwind
CSS, a custom `ws` WebSocket server, and peer-to-peer WebRTC (mesh, STUN only).

## Setup & run

```bash
npm install
npm run dev          # development (custom server with Next.js HMR)
```

Open http://localhost:3000, enter a display name, then create/join a room by
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
connects to `ws://<host>/ws` as a client — see "Bot integration" below.

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
- Autoplay policy: bot-driven music starts after you've interacted with the
  page. If the browser blocks it, the Now Playing chip in the top bar shows
  "Click to play" — click it once.

## WebSocket message protocol

Endpoint: `ws://<host>/ws`. Every frame is one JSON object with a `type`
field. Types are defined in [lib/protocol.ts](lib/protocol.ts).

### Client → server

| Type | Shape | Notes |
|---|---|---|
| `join` | `{ type, roomId, user: { id, displayName, isBot? }, token? }` | Joins (or creates) a room. A socket is in at most one room; joining another implies leaving. Bots (`isBot: true`) must send a non-empty `token`. |
| `leave` | `{ type, roomId, userId }` | Leave the room. Also inferred on socket close. |
| `chat` | `{ type, roomId, user, text, timestamp }` | Broadcast to **all** room members, including bots and the sender (the echo is what clients render). |
| `signal` | `{ type, roomId, from, to, kind: "offer"\|"answer"\|"ice", payload }` | WebRTC signaling; relayed verbatim to the `to` user only. |
| `media` | `{ type, roomId, userId, micOn, camOn, screenOn }` | Local media flags so others can render mute icons / avatar placeholders. Sent to humans only. |
| `music` | `{ type, roomId, action, track, positionMs, serverTimestamp }` | **Bot-only** (ignored from humans). Relayed unchanged to all human clients in the room. |

### Server → client

| Type | Shape | Notes |
|---|---|---|
| `peers` | `{ type, roomId, users[] }` | Sent to a joiner: everyone already in the room (bots included, flagged `isBot`). The joiner initiates WebRTC offers to each non-bot user. |
| `history` | `{ type, roomId, messages[] }` | Sent to a joiner: the room's session chat history (last 500). |
| `presence` | `{ type, roomId, userId, user?, event: "joined"\|"left" }` | `user` is included on `joined`. On `left`, clients tear down that peer's connection and tiles. |
| `chat`, `signal`, `media`, `music` | as above | Relayed/broadcast forms of the client messages. |
| `rooms` | `{ type, rooms: [{ name, count }] }` | Room list for the sidebar (human member counts); pushed on connect and whenever membership changes. |
| `error` | `{ type, message }` | e.g. a bot joining without a token (socket then closes with code `4001`). |

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

## Bot integration

The clone contains **no bot logic** — only the transport hook and client-side
playback. A bot is any WebSocket client that:

1. Connects to `ws://<host>/ws`.
2. Sends a `join` with `isBot: true` and a `token`. **Any non-empty token is
   accepted in this prototype** (there is no real auth); a missing/empty token
   gets an `error` frame and close code `4001`.
3. Receives every `chat` message in its room — including messages starting
   with `/`, so it can implement slash commands however it likes.
4. Sends `music` frames, which the server relays **unchanged** to all human
   clients in the room (never back to bots). The server does not interpret
   `action`.

```js
// minimal-bot.mjs — run with: node minimal-bot.mjs   (npm i ws)
import WebSocket from "ws";
const ws = new WebSocket("ws://localhost:3000/ws");
ws.on("open", () => {
  ws.send(JSON.stringify({
    type: "join", roomId: "general",
    user: { id: "bot-1", displayName: "MusicBot", isBot: true },
    token: "dev-token",
  }));
});
ws.on("message", (data) => {
  const msg = JSON.parse(data);
  if (msg.type === "chat" && msg.text.startsWith("/play")) {
    ws.send(JSON.stringify({
      type: "music", roomId: "general", action: "play",
      track: { url: "https://example.com/song.mp3", title: "Song" },
      positionMs: 0, serverTimestamp: Date.now(),
    }));
  }
});
```

On the human clients, an HTML5 `Audio` element loads `track.url`, seeks to
`positionMs + (now − serverTimestamp)` for rough sync, and a "Now Playing"
chip appears in the top bar. `pause`/`resume`/`seek`/`stop` are obeyed the
same way; the bot is the source of truth.

## Project layout

```
server.ts               custom Next.js server + ws hub (rooms, relay, bot hook)
lib/protocol.ts         shared typed message protocol
lib/mesh.ts             WebRTC mesh manager (signaling flow commented)
components/AppShell.tsx top-level client component: socket, media, state
components/*.tsx        Sidebar / TopBar / ChatPanel / VideoGrid / ControlBar / NameGate
app/                    App Router shell (page is a Server Component)
```
