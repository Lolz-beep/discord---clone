import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class ResumeCommand implements BotCommand {
  readonly description = "Resume playback";
  readonly usage = "/resume";

  execute(context: CommandContext): void {
    const ok = context.facade.resume(context.interaction.roomId);
    context.reply(ok ? "Resumed ▶" : "Nothing is paused.");
  }
}
