# YouTube Music Bot

A standalone Node + TypeScript music bot for the Discord clone. It connects to
the clone's WebSocket server ("the gateway") like any client but identifies as
a bot (`isBot: true` + token), listens for slash commands in chat, and
broadcasts YouTube playback commands per room.

The bot **never streams or downloads audio**. It parses YouTube URLs into
video ids and tells the human clients what to play; each client plays the
video with the YouTube IFrame Player API and reports end-of-track back. The
bot is the single source of truth for what's playing and where.

## Setup & run

```bash
cd music-bot
npm install
```

1. In the clone, join a room and click **🤖 Integrate Bot** — it issues a
   token bound to that room.
2. Copy the modal's `.env` snippet into `music-bot/.env`
   (see `.env.example`):

   ```bash
   WS_URL=ws://localhost:3000/ws
   BOT_TOKEN=<token from the modal>
   ROOM_ID=<room the token was registered for>
   # optional: BOT_NAME, COOLDOWN_MS (default 2000), DJ_ROLE
   ```

3. `npm start` — the bot runs as its **own process**, separate from the clone.
   The modal flips to "Connected ✓" when the handshake lands.

## Commands

| Command | Effect |
| --- | --- |
| `/play <youtube-url>` | Add to queue; start playing if idle |
| `/pause` | Pause |
| `/resume` | Resume |
| `/skip` | Next track |
| `/stop` | Stop and clear the queue (gated by `DJ_ROLE` if set) |
| `/queue` | Show the queue |
| `/nowplaying` | Current track + title + position |
| `/remove <n>` | Remove queue item n |
| `/clear` | Empty the upcoming queue (gated by `DJ_ROLE` if set) |
| `/loop` | Cycle loop mode: off → one → all |
| `/help` | List commands |

`/play` accepts `youtube.com/watch?v=ID`, `youtu.be/ID`, and
`youtube.com/embed/ID` (extra params fine); anything else gets
"invalid YouTube URL". Titles come from YouTube oEmbed (no API key) with the
video id as fallback. Track duration is never timed by the bot — it advances
only when clients report the video ended.

## Message shapes (must match the clone's `lib/protocol.ts`)

Outgoing handshake:

```json
{ "type": "join", "roomId": "general",
  "user": { "id": "bot-...", "displayName": "MusicBot", "isBot": true },
  "token": "<BOT_TOKEN>" }
```

Incoming chat (the bot acts only on texts starting with `/`):

```json
{ "type": "chat", "roomId": "general",
  "user": { "id": "u1", "displayName": "Ada" },
  "text": "/play https://youtu.be/dQw4w9WgXcQ", "timestamp": 1719990000000 }
```

Outgoing playback control (relayed by the server to all human clients;
`title` is an optional extra so clients can label the Now Playing chip):

```json
{ "type": "music", "roomId": "general", "action": "play",
  "videoId": "dQw4w9WgXcQ", "title": "…", "positionMs": 0,
  "serverTimestamp": 1719990000000 }
```

`action` ∈ `play | pause | resume | stop | seek`.

Incoming end-of-track report (sent by each human client; the bot dedupes and
auto-advances the queue respecting the loop mode):

```json
{ "type": "musicEvent", "roomId": "general", "event": "ended",
  "videoId": "dQw4w9WgXcQ" }
```

Replies (queue lists, now-playing, errors) go out as normal `chat` messages.

## Playback state machine

```text
Idle → Playing → Paused → Playing → … → (queue exhausted) → Idle
stop from any state → Stopped → Idle (queue cleared)
```

Every state change broadcasts the matching `music{...}` with `positionMs` and
a fresh `serverTimestamp` anchor so clients can sync roughly.

## Design pattern / class → file mapping

| Pattern / role | Class | File |
| --- | --- | --- |
| **Singleton** (one WS connection) | `MusicBotClient` | `src/infrastructure/MusicBotClient.ts` |
| **Facade** (playback subsystem entry) | `MusicFacade` | `src/business/MusicFacade.ts` |
| **Chain of Responsibility** base | `BaseHandler` | `src/business/validation/BaseHandler.ts` |
| Guard 1: ignore bot authors | `AuthorCheckHandler` | `src/business/validation/AuthorCheckHandler.ts` |
| Guard 2: registered command? | `ValidityCheckHandler` | `src/business/validation/ValidityCheckHandler.ts` |
| Guard 3: per-user cooldown | `CooldownCheckHandler` | `src/business/validation/CooldownCheckHandler.ts` |
| Guard 4: role gate for /stop, /clear | `PermissionCheckHandler` | `src/business/validation/PermissionCheckHandler.ts` |
| **Command** interface | `BotCommand` | `src/business/commands/BotCommand.ts` |
| Command registry | `CommandEngine` | `src/business/CommandEngine.ts` |
| One class per command | `PlayCommand`, `PauseCommand`, `ResumeCommand`, `SkipCommand`, `StopCommand`, `QueueCommand`, `NowPlayingCommand`, `RemoveCommand`, `ClearCommand`, `LoopCommand`, `HelpCommand` | `src/business/commands/*.ts` |
| **Observer** (gateway events) | `MusicBotClient extends EventEmitter`, subscribed by `MusicFacade` | `src/infrastructure/MusicBotClient.ts`, `src/business/MusicFacade.ts` |
| **Observer** (`trackEnded` / `trackStarted`) | `MusicPlayer extends EventEmitter`, observed by `MusicFacade` | `src/domain/MusicPlayer.ts` |
| Domain: user + permissions | `User` | `src/domain/User.ts` |
| Domain: parsed slash command | `Interaction` | `src/domain/Interaction.ts` |
| Domain: queued video | `Track` | `src/domain/Track.ts` |
| Domain: queue + loop mode | `Queue` | `src/domain/Queue.ts` |
| Domain: per-room player + state machine | `MusicPlayer` | `src/domain/MusicPlayer.ts` |
| Data access (per-room repository) | `PlayerRegistry` | `src/data/PlayerRegistry.ts` |
| Wire protocol types | — | `src/protocol.ts` |
| YouTube id regex + oEmbed | — | `src/util/youtube.ts` |
| Bootstrap / layer wiring | — | `src/index.ts` |

## Layered architecture

```text
1. Presentation    MusicBotClient          (WS connection to the gateway)
2. Business logic  MusicFacade, validation chain, CommandEngine, commands
3. Data access     PlayerRegistry          (per-room MusicPlayer repository)
4. Storage         in-memory               (behind the registry)
```
