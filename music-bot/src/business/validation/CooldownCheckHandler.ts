import { BaseHandler } from "./BaseHandler";
import type { CommandContext } from "../CommandContext";

/** Guard 3: per-user spam cooldown between commands. */
export class CooldownCheckHandler extends BaseHandler {
  private readonly lastCommandAt = new Map<string, number>();

  constructor(private readonly cooldownMs: number) {
    super();
  }

  handle(context: CommandContext): boolean {
    const userId = context.interaction.user.id;
    const now = Date.now();
    const last = this.lastCommandAt.get(userId) ?? 0;
    if (now - last < this.cooldownMs) {
      const wait = Math.ceil((this.cooldownMs - (now - last)) / 1000);
      context.reply(`Slow down — try again in ${wait}s.`);
      return false;
    }
    this.lastCommandAt.set(userId, now);
    return this.next(context);
  }
}
