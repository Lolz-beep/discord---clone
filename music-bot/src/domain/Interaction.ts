import { randomUUID } from "crypto";
import type { User } from "./User";

/** A parsed slash command: "/play <url>" -> commandName "play", arguments ["<url>"]. */
export class Interaction {
  public readonly interactionId: string = randomUUID();
  public readonly arguments: string[];

  constructor(
    public readonly commandName: string,
    public readonly user: User,
    public readonly roomId: string,
    args: string[]
  ) {
    this.arguments = args;
  }
}
