import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

/** /play <youtube-url> — parse, enqueue, start if idle (async work in facade). */
export class PlayCommand implements BotCommand {
  readonly description = "Add a YouTube video to the queue (starts if idle)";
  readonly usage = "/play <youtube-url>";

  execute(context: CommandContext): void {
    void context.facade.play(context);
  }
}
