import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class NowPlayingCommand implements BotCommand {
  readonly description = "Show the current track";
  readonly usage = "/nowplaying";

  execute(context: CommandContext): void {
    const player = context.facade.getPlayer(context.interaction.roomId);
    const track = player.queue.current;
    if (!track || player.state === "Idle") {
      context.reply("Nothing is playing.");
      return;
    }
    const seconds = Math.floor(player.getPositionMs() / 1000);
    const mm = Math.floor(seconds / 60);
    const ss = String(seconds % 60).padStart(2, "0");
    context.reply(
      `Now ${player.state === "Paused" ? "paused" : "playing"}: **${track.title}** at ${mm}:${ss} (${track.url})`
    );
  }
}
