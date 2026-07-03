import { randomUUID } from "crypto";
import type { MusicBotClient } from "../infrastructure/MusicBotClient";
import type { CommandEngine } from "./CommandEngine";
import type { BaseHandler } from "./validation/BaseHandler";
import type { CommandContext } from "./CommandContext";
import { PlayerRegistry } from "../data/PlayerRegistry";
import { MusicPlayer } from "../domain/MusicPlayer";
import { User } from "../domain/User";
import { Interaction } from "../domain/Interaction";
import type { Track } from "../domain/Track";
import type { ChatMessage, MusicEndedEvent } from "../protocol";
import { canonicalUrl, extractVideoId, fetchTitle } from "../util/youtube";

/**
 * FACADE — the one clean entry point into the playback subsystem. The rest
 * of the app (and the gateway events) never touch MusicPlayer/Queue/commands
 * directly; everything goes through here.
 *
 * Holds: the MusicBotClient (singleton), the CommandEngine, the head of the
 * validation pipeline (Chain of Responsibility), and per-room players via
 * the PlayerRegistry (Map<roomId, MusicPlayer> behind a repository).
 */
export class MusicFacade {
  private readonly players: PlayerRegistry;

  constructor(
    private readonly client: MusicBotClient,
    private readonly commandEngine: CommandEngine,
    private readonly validationPipeline: BaseHandler
  ) {
    this.players = new PlayerRegistry(
      (msg) => this.client.send(msg), // every player state change hits the wire
      (player) => this.observePlayer(player)
    );

    // OBSERVER hookup #1: react to gateway events, no polling.
    // Incoming chat -> maybe a slash command.
    this.client.on("chat", (msg: ChatMessage) => this.onChat(msg));
    // Incoming end-of-track report from a human client -> player decides
    // whether it's genuine (dedupe) and then emits "trackEnded".
    this.client.on("musicEvent", (msg: MusicEndedEvent) => {
      if (msg.event === "ended") this.players.get(msg.roomId)?.reportEnded(msg.videoId);
    });
  }

  /** OBSERVER hookup #2: subscribe to each new player's lifecycle events. */
  private observePlayer(player: MusicPlayer) {
    // Natural end of track -> auto-advance respecting loopMode.
    player.on("trackEnded", () => player.autoAdvance());
    // Announce whatever starts (from /play, /skip, or auto-advance).
    player.on("trackStarted", (track: Track) => {
      this.client.sendChat(player.roomId, `Now playing: **${track.title}** (${track.url})`);
    });
  }

  getPlayer(roomId: string): MusicPlayer {
    return this.players.getOrCreate(roomId);
  }

  // ---- inbound chat -> Interaction -> validation chain -> command ----------

  private onChat(msg: ChatMessage) {
    if (!msg.text.startsWith("/")) return; // only slash commands
    const [rawName, ...args] = msg.text.slice(1).trim().split(/\s+/);
    const commandName = (rawName ?? "").toLowerCase();
    if (!commandName) return;

    const user = new User(msg.user.id, msg.user.displayName, [], msg.user.isBot ?? false);
    const interaction = new Interaction(commandName, user, msg.roomId, args);
    this.handleInteraction(interaction);
  }

  handleInteraction(interaction: Interaction) {
    const context: CommandContext = {
      interaction,
      facade: this,
      reply: (text) => this.client.sendChat(interaction.roomId, text),
    };

    // Chain of Responsibility gate: author -> validity -> cooldown -> permission.
    if (!this.validationPipeline.handle(context)) return;

    try {
      this.commandEngine.getCommand(interaction.commandName)!.execute(context);
    } catch (err) {
      console.error(`[facade] /${interaction.commandName} failed`, err);
      context.reply(`Something went wrong running /${interaction.commandName}.`);
    }
  }

  // ---- playback operations (delegated to the per-room MusicPlayer) ---------

  /** /play: URL -> videoId (+ best-effort oEmbed title) -> enqueue/start. */
  async play(context: CommandContext): Promise<void> {
    const { interaction } = context;
    const url = interaction.arguments[0];
    if (!url) {
      context.reply("Usage: /play <youtube-url>");
      return;
    }
    const videoId = extractVideoId(url);
    if (!videoId) {
      context.reply("invalid YouTube URL");
      return;
    }

    const title = await fetchTitle(videoId); // falls back to the id
    const track: Track = {
      id: randomUUID(),
      videoId,
      title,
      url: canonicalUrl(videoId),
      requestedBy: interaction.user,
    };

    const player = this.getPlayer(interaction.roomId);
    const { position, startedNow } = player.enqueue(track);
    if (!startedNow) {
      context.reply(`Queued **${track.title}** at position ${position}.`);
    }
    // If it started now, the "trackStarted" observer already announced it.
  }

  pause(roomId: string): boolean {
    return this.getPlayer(roomId).pause();
  }

  resume(roomId: string): boolean {
    return this.getPlayer(roomId).resume();
  }

  skip(roomId: string): Track | null {
    return this.getPlayer(roomId).skip();
  }

  stop(roomId: string): void {
    this.getPlayer(roomId).stop();
  }
}
