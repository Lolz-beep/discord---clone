import type { CommandContext } from "../CommandContext";

/**
 * CHAIN OF RESPONSIBILITY — abstract base for the validation pipeline that
 * runs before ANY command executes.
 *
 * Wiring (see index.ts):
 *   author.setNext(validity).setNext(cooldown).setNext(permission)
 *
 * Each concrete guard implements handle(): it performs its own check and, on
 * success, delegates to the next handler via next(). Returning false anywhere
 * stops the chain (the guard replies with the reason itself, unless the
 * rejection should be silent, e.g. bot-authored messages).
 */
export abstract class BaseHandler {
  #nextHandler: BaseHandler | null = null;

  /** Returns the passed handler so chains read fluently. */
  setNext(handler: BaseHandler): BaseHandler {
    this.#nextHandler = handler;
    return handler;
  }

  /** true = command may proceed; false = rejected somewhere in the chain. */
  abstract handle(context: CommandContext): boolean;

  /** Hand off to the next guard (or approve if we're the last one). */
  protected next(context: CommandContext): boolean {
    return this.#nextHandler ? this.#nextHandler.handle(context) : true;
  }
}
