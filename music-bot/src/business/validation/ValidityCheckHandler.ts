import { BaseHandler } from "./BaseHandler";
import type { CommandContext } from "../CommandContext";
import type { CommandEngine } from "../CommandEngine";

/** Guard 2: is this a command we actually registered? */
export class ValidityCheckHandler extends BaseHandler {
  constructor(private readonly engine: CommandEngine) {
    super();
  }

  handle(context: CommandContext): boolean {
    const name = context.interaction.commandName;
    if (!this.engine.getCommand(name)) {
      context.reply(`Unknown command /${name} — try /help`);
      return false;
    }
    return this.next(context);
  }
}
