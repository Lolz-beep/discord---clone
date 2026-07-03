import { BaseHandler } from "./BaseHandler";
import type { CommandContext } from "../CommandContext";

/** Guard 4: gate destructive commands behind a role, if one is configured.
 *  With no DJ_ROLE configured (the clone assigns no roles), everything is
 *  allowed and this guard just passes through. */
export class PermissionCheckHandler extends BaseHandler {
  private static readonly GATED = new Set(["stop", "clear"]);

  constructor(private readonly requiredRole: string | undefined) {
    super();
  }

  handle(context: CommandContext): boolean {
    const { commandName, user } = context.interaction;
    if (
      this.requiredRole &&
      PermissionCheckHandler.GATED.has(commandName) &&
      !user.hasPermission(this.requiredRole)
    ) {
      context.reply(`You need the "${this.requiredRole}" role to use /${commandName}.`);
      return false;
    }
    return this.next(context);
  }
}
