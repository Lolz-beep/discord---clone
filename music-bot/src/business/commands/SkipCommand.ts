import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class SkipCommand implements BotCommand {
  readonly description = "Skip to the next track";
  readonly usage = "/skip";

  execute(context: CommandContext): void {
    const next = context.facade.skip(context.interaction.roomId);
    context.reply(next ? `Skipped — now playing **${next.title}**` : "Queue is empty — stopped.");
  }
}
