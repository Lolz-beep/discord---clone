import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class RemoveCommand implements BotCommand {
  readonly description = "Remove queue item n (see /queue for numbers)";
  readonly usage = "/remove <n>";

  execute(context: CommandContext): void {
    const n = parseInt(context.interaction.arguments[0] ?? "", 10);
    if (Number.isNaN(n)) {
      context.reply("Usage: /remove <n>");
      return;
    }
    const player = context.facade.getPlayer(context.interaction.roomId);
    const removed = player.queue.remove(n);
    if (removed === "is-current") context.reply("That track is playing — use /skip instead.");
    else if (removed) context.reply(`Removed **${removed.title}** from the queue.`);
    else context.reply(`No queue item ${n}.`);
  }
}
