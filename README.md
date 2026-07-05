# Discord Clone

Minimal Discord-style app: text chat, voice, video, and screen share in named
rooms. Next.js (App Router, TypeScript) + Tailwind, one custom `ws` WebSocket
server, peer-to-peer WebRTC mesh (STUN only). A YouTube music bot lives in
[music-bot/](music-bot/) as its own project.

## Run

```bash
npm install
npm run dev                  # dev server at http://localhost:3000

npm run build && npm start   # production

docker compose up --build    # clone + music bot together, already paired
```

Enter a name, create/join a room in the sidebar. Test with a second tab.
With Docker, the bot is auto-paired via `SEED_BOT_TOKEN` (defaults in
[docker-compose.yml](docker-compose.yml)) — join `general` and type `/help`.

Everything runs in one process (`server.ts` = Next.js + WebSocket at `/ws`).
All state is in-memory; a restart wipes rooms, chat, and bot registrations.

**Notes:**

- Mic/camera/screen need HTTPS or `localhost`. For a second device use a
  tunnel: `ngrok http 3000` or `cloudflared tunnel --url http://localhost:3000`.
- STUN only (no TURN) — media may fail behind strict firewalls; chat still works.
- If autoplay is blocked, click the overlay on the YouTube panel once.
- `EADDRINUSE :3000` = another instance is already running; stop it first.

## WebSocket protocol

Endpoint `ws://<host>/ws`, one JSON object per frame, typed in
[lib/protocol.ts](lib/protocol.ts).

| Type | Shape | Direction / routing |
| --- | --- | --- |
| `join` | `{ roomId, user: { id, displayName, isBot? }, token? }` | Client → server. Creates the room if new. Bots need a registered `token` for that room. |
| `leave` | `{ roomId, userId }` | Client → server (also inferred on disconnect). |
| `chat` | `{ roomId, user, text, timestamp }` | Broadcast to everyone in the room, bots and sender included. |
| `signal` | `{ roomId, from, to, kind: "offer"\|"answer"\|"ice", payload }` | Relayed only to `to` (WebRTC signaling). |
| `media` | `{ roomId, userId, micOn, camOn, screenOn }` | Broadcast to humans (mute/cam icons on tiles). |
| `music` | `{ roomId, action, videoId, title?, positionMs, serverTimestamp }` | Bot → humans, relayed unchanged. `action`: play/pause/resume/seek/stop. |
| `musicEvent` | `{ roomId, event: "ended", videoId }` | Human → bots (video finished; bot advances its queue). |
| `peers` | `{ roomId, users[] }` | Server → joiner: who's already here. |
| `history` | `{ roomId, messages[] }` | Server → joiner: chat history (last 500). |
| `presence` | `{ roomId, userId, user?, event: "joined"\|"left" }` | Server → room. |
| `rooms` | `{ rooms: [{ name, count }] }` | Server → all (sidebar list). |
| `error` | `{ message }` | Close codes: `4001` bad token, `4002` revoked, `4003` wrong room. |

**Call flow (mesh):** the joiner gets `peers` and initiates one connection
per human (no glare). Each connection pre-adds three transceivers —
`[mic, camera, screen]` — so tracks are identified by slot and toggling is a
plain `replaceTrack`, no renegotiation. Full commentary in
[lib/mesh.ts](lib/mesh.ts); code-level docs in
[CODE-WALKTHROUGH.md](CODE-WALKTHROUGH.md).

## Bot integration

The clone has no bot logic — just pairing + relay. The bot is a separate
process that joins with `isBot: true` + a token, sees all chat (so it can
parse `/commands`), and sends `music` frames that clients obey.

**Pairing:** join a room → **Integrate Bot** → generate credentials →
paste the `.env` snippet into your bot → start it → the modal flips to
"Connected ✓". Or skip the UI entirely by starting the server with
`SEED_BOT_TOKEN=<token>` (what docker compose does).

See [music-bot/README.md](music-bot/README.md) for the bot itself (commands,
message shapes, architecture).

## REST API

Read-only monitoring plus pairing — it never drives chat or playback.
Importable Postman collection in [postman/](postman/).

| Endpoint | Method | Returns |
| --- | --- | --- |
| `/api/bots/register` | POST | `{ botId, token, wsUrl, roomId }` for body `{ roomId, botName }` |
| `/api/bots` | GET | All registered bots + live `connected` flag |
| `/api/bots/:idOrToken/status` | GET | `{ botId, botName, roomId, connected }` — accepts botId **or token** |
| `/api/bots/:idOrToken` | DELETE | Revoke (kicks a connected bot, code `4002`) |
| `/api/rooms` | GET | Active rooms + human counts |
| `/api/rooms/:roomId/members` | GET | Current members (bots flagged) |
| `/api/rooms/:roomId/messages` | GET | Chat history |
| `/api/rooms/:roomId/events` | GET | Join/leave log |
| `/api/rooms/:roomId/music` | GET | `nowPlaying` + log of relayed music frames |

