import { BaseHandler } from "./BaseHandler";
import type { CommandContext } from "../CommandContext";

/** Guard 1: ignore bot-authored messages so bots can't trigger each other
 *  (or us) into command loops. Rejects silently — no reply. */
export class AuthorCheckHandler extends BaseHandler {
  handle(context: CommandContext): boolean {
    if (context.interaction.user.isBot) return false;
    return this.next(context);
  }
}
