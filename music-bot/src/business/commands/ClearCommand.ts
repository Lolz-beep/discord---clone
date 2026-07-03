import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class ClearCommand implements BotCommand {
  readonly description = "Empty the queue (current track keeps playing)";
  readonly usage = "/clear";

  execute(context: CommandContext): void {
    const player = context.facade.getPlayer(context.interaction.roomId);
    const removed = player.queue.clearUpcoming();
    context.reply(removed > 0 ? `Cleared ${removed} upcoming track(s).` : "Nothing to clear.");
  }
}
