import type { BotCommand } from "./BotCommand";
import type { CommandContext } from "../CommandContext";

export class StopCommand implements BotCommand {
  readonly description = "Stop playback and clear the queue";
  readonly usage = "/stop";

  execute(context: CommandContext): void {
    context.facade.stop(context.interaction.roomId);
    context.reply("Stopped and cleared the queue ⏹");
  }
}
