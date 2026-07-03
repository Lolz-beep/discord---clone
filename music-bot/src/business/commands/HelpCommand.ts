import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";
import type { CommandEngine } from "../CommandEngine";

export class HelpCommand implements BotCommand {
  readonly description = "List commands";
  readonly usage = "/help";

  constructor(private readonly engine: CommandEngine) {}

  execute(context: CommandContext): void {
    const lines = this.engine
      .entries()
      .map(([, cmd]) => `${cmd.usage} — ${cmd.description}`);
    context.reply(`Commands:\n${lines.join("\n")}`);
  }
}
