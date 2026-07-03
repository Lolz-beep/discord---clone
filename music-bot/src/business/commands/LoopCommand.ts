import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class LoopCommand implements BotCommand {
  readonly description = "Cycle loop mode: off → one → all";
  readonly usage = "/loop";

  execute(context: CommandContext): void {
    const player = context.facade.getPlayer(context.interaction.roomId);
    const mode = player.queue.cycleLoopMode();
    const label = { off: "Loop off", one: "Looping current track 🔂", all: "Looping whole queue 🔁" }[mode];
    context.reply(label);
  }
}
