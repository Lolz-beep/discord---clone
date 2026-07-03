import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class PauseCommand implements BotCommand {
  readonly description = "Pause playback";
  readonly usage = "/pause";

  execute(context: CommandContext): void {
    const ok = context.facade.pause(context.interaction.roomId);
    context.reply(ok ? "Paused ⏸" : "Nothing is playing.");
  }
}
