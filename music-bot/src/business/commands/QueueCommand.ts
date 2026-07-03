import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class QueueCommand implements BotCommand {
  readonly description = "Show the queue";
  readonly usage = "/queue";

  execute(context: CommandContext): void {
    const player = context.facade.getPlayer(context.interaction.roomId);
    const { items, currentIndex, loopMode } = player.queue;
    if (items.length === 0) {
      context.reply("Queue is empty — add something with /play <youtube-url>");
      return;
    }
    const lines = items.map((track, i) => {
      const marker = i === currentIndex ? "▶" : `${i + 1}.`;
      return `${marker} ${track.title} (requested by ${track.requestedBy.username})`;
    });
    context.reply(`Queue (loop: ${loopMode}):\n${lines.join("\n")}`);
  }
}
