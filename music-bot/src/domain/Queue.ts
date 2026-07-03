import type { Track } from "./Track";

export type LoopMode = "off" | "one" | "all";

/** Per-room track queue with a cursor and loop mode. Pure data structure —
 *  broadcasting/state transitions live in MusicPlayer. */
export class Queue {
  public items: Track[] = [];
  public currentIndex = -1;
  public loopMode: LoopMode = "off";

  get current(): Track | null {
    return this.items[this.currentIndex] ?? null;
  }

  /** Append a track; returns its 1-based position in the queue. */
  enqueue(track: Track): number {
    this.items.push(track);
    return this.items.length;
  }

  /**
   * Move the cursor to the next track and return it (null = nothing left).
   * `auto` distinguishes a natural end-of-track (respects loopMode "one")
   * from a manual /skip (which always moves forward).
   */
  advance(auto: boolean): Track | null {
    if (auto && this.loopMode === "one") return this.current; // replay same track
    if (this.currentIndex + 1 < this.items.length) {
      this.currentIndex++;
      return this.current;
    }
    if (this.loopMode === "all" && this.items.length > 0) {
      this.currentIndex = 0; // wrap around
      return this.current;
    }
    return null;
  }

  /** Remove the 1-based n-th item. Returns it, or null if out of range.
   *  Removing the currently playing item is refused (use /skip). */
  remove(position: number): Track | null | "is-current" {
    const index = position - 1;
    if (index < 0 || index >= this.items.length) return null;
    if (index === this.currentIndex) return "is-current";
    const [removed] = this.items.splice(index, 1);
    if (index < this.currentIndex) this.currentIndex--;
    return removed;
  }

  /** Drop everything that hasn't played yet (keeps the current track). */
  clearUpcoming(): number {
    const removed = this.items.length - (this.currentIndex + 1);
    this.items.length = this.currentIndex + 1;
    return Math.max(0, removed);
  }

  /** Full reset (used by /stop). */
  clear() {
    this.items = [];
    this.currentIndex = -1;
  }

  cycleLoopMode(): LoopMode {
    this.loopMode = this.loopMode === "off" ? "one" : this.loopMode === "one" ? "all" : "off";
    return this.loopMode;
  }
}
