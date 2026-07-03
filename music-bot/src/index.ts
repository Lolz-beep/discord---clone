/**
 * Bootstrap: wire the layers together and connect.
 *
 *   Presentation    MusicBotClient (singleton WS connection)
 *   Business logic  MusicFacade + validation chain + CommandEngine + commands
 *   Data access     PlayerRegistry (inside the facade)
 *   Storage         in-memory (behind the registry)
 */
import { loadEnv, requireEnv } from "./util/env";
import { MusicBotClient } from "./infrastructure/MusicBotClient";
import { CommandEngine } from "./business/CommandEngine";
import { MusicFacade } from "./business/MusicFacade";
import { AuthorCheckHandler } from "./business/validation/AuthorCheckHandler";
import { ValidityCheckHandler } from "./business/validation/ValidityCheckHandler";
import { CooldownCheckHandler } from "./business/validation/CooldownCheckHandler";
import { PermissionCheckHandler } from "./business/validation/PermissionCheckHandler";
import { PlayCommand } from "./business/commands/PlayCommand";
import { PauseCommand } from "./business/commands/PauseCommand";
import { ResumeCommand } from "./business/commands/ResumeCommand";
import { SkipCommand } from "./business/commands/SkipCommand";
import { StopCommand } from "./business/commands/StopCommand";
import { QueueCommand } from "./business/commands/QueueCommand";
import { NowPlayingCommand } from "./business/commands/NowPlayingCommand";
import { RemoveCommand } from "./business/commands/RemoveCommand";
import { ClearCommand } from "./business/commands/ClearCommand";
import { LoopCommand } from "./business/commands/LoopCommand";
import { HelpCommand } from "./business/commands/HelpCommand";

loadEnv();

// SINGLETON: the only WS connection to the gateway lives here.
const client = MusicBotClient.getInstance({
  wsUrl: requireEnv("WS_URL"),
  token: requireEnv("BOT_TOKEN"),
  roomId: requireEnv("ROOM_ID"),
  botName: process.env.BOT_NAME || "MusicBot",
});

// COMMAND PATTERN: one class per command, registered by name.
const engine = new CommandEngine();
engine.registerCommand("play", new PlayCommand());
engine.registerCommand("pause", new PauseCommand());
engine.registerCommand("resume", new ResumeCommand());
engine.registerCommand("skip", new SkipCommand());
engine.registerCommand("stop", new StopCommand());
engine.registerCommand("queue", new QueueCommand());
engine.registerCommand("nowplaying", new NowPlayingCommand());
engine.registerCommand("remove", new RemoveCommand());
engine.registerCommand("clear", new ClearCommand());
engine.registerCommand("loop", new LoopCommand());
engine.registerCommand("help", new HelpCommand(engine));

// CHAIN OF RESPONSIBILITY: guards run in this exact order before any command.
const validationPipeline = new AuthorCheckHandler();
validationPipeline
  .setNext(new ValidityCheckHandler(engine))
  .setNext(new CooldownCheckHandler(parseInt(process.env.COOLDOWN_MS ?? "2000", 10)))
  .setNext(new PermissionCheckHandler(process.env.DJ_ROLE));

// FACADE: subscribes to the client's events and owns the players.
new MusicFacade(client, engine, validationPipeline);

client.connect();

process.on("SIGINT", () => {
  console.log("\n[bot] shutting down");
  client.disconnect();
  process.exit(0);
});
