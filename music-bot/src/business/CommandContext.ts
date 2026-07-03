import type { Interaction } from "../domain/Interaction";
import type { MusicFacade } from "./MusicFacade";

/** Everything a guard or command needs to do its job. */
export interface CommandContext {
  interaction: Interaction;
  facade: MusicFacade;
  /** Send a chat reply into the interaction's room. */
  reply: (text: string) => void;
}
