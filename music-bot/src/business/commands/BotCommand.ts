import type { CommandContext } from "../CommandContext";

/** COMMAND PATTERN — every slash command is one class implementing this. */
export interface BotCommand {
  /** e.g. "Add a YouTube video to the queue" — used by /help. */
  readonly description: string;
  /** e.g. "/play <youtube-url>" — used by /help. */
  readonly usage: string;
  execute(context: CommandContext): void;
}
