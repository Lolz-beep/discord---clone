import type { BotCommand } from "./commands/BotCommand";

/** COMMAND PATTERN — registry mapping command names to command objects. */
export class CommandEngine {
  private readonly commands = new Map<string, BotCommand>();

  registerCommand(name: string, command: BotCommand) {
    this.commands.set(name, command);
  }

  getCommand(name: string): BotCommand | undefined {
    return this.commands.get(name);
  }

  /** Used by /help to list everything that's registered. */
  entries(): [string, BotCommand][] {
    return [...this.commands.entries()];
  }
}
