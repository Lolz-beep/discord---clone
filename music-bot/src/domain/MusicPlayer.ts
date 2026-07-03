import { EventEmitter } from "events";
import { Queue } from "./Queue";
import type { Track } from "./Track";
import type { MusicMessage } from "../protocol";

/**
 * One player per room: owns the Queue, the playback state machine, and the
 * position/timestamp anchor used for client sync.
 *
 * STATE MACHINE
 *   Idle -> Playing -> Paused -> Playing -> ... -> (queue exhausted) -> Idle
 *   stop() from any state -> Stopped -> Idle (queue cleared)
 *
 * Every state change broadcasts the matching `music { action, ... }` message;
 * the bot never plays audio itself — human clients obey these messages.
 *
 * OBSERVER: this class is an EventEmitter. When a human client reports the
 * current video ended (reportEnded), the player emits "trackEnded"; the
 * MusicFacade observes that event and auto-advances the queue. It also emits
 * "trackStarted" so the facade can announce the new track in chat.
 */
export type PlayerState = "Idle" | "Playing" | "Paused" | "Stopped";

export class MusicPlayer extends EventEmitter {
  public readonly queue = new Queue();
  public state: PlayerState = "Idle";

  /** Position within the current track when `anchorTimestamp` was taken. */
  private positionMs = 0;
  /** Wall-clock anchor; while Playing, real position = positionMs + elapsed. */
  private anchorTimestamp = 0;
  /** Guards against N humans all reporting "ended" for the same track. */
  private lastAdvanceAt = 0;

  constructor(
    public readonly roomId: string,
    private readonly broadcast: (msg: MusicMessage) => void
  ) {
    super();
  }

  /** Current playback position, extrapolated from the anchor while playing. */
  getPositionMs(): number {
    if (this.state === "Playing") {
      return this.positionMs + (Date.now() - this.anchorTimestamp);
    }
    return this.positionMs;
  }

  private send(action: MusicMessage["action"], track: Track | null) {
    if (!track) return;
    this.broadcast({
      type: "music",
      roomId: this.roomId,
      action,
      videoId: track.videoId,
      title: track.title,
      positionMs: this.getPositionMs(),
      serverTimestamp: Date.now(),
    });
  }

  /** Add a track; if the player is idle, start playing it immediately. */
  enqueue(track: Track): { position: number; startedNow: boolean } {
    const position = this.queue.enqueue(track);
    if (this.state === "Idle" || this.state === "Stopped") {
      this.queue.currentIndex = this.queue.items.length - 1;
      this.startCurrent();
      return { position, startedNow: true };
    }
    return { position, startedNow: false };
  }

  /** (Re)start the track under the queue cursor from position 0. */
  private startCurrent() {
    const track = this.queue.current;
    if (!track) {
      this.toIdle();
      return;
    }
    this.state = "Playing";
    this.positionMs = 0;
    this.anchorTimestamp = Date.now();
    this.lastAdvanceAt = Date.now();
    this.send("play", track);
    this.emit("trackStarted", track); // observed by MusicFacade (announce)
  }

  play() {
    if (this.state === "Paused") return this.resume();
    if (this.state !== "Playing") this.startCurrent();
  }

  pause(): boolean {
    if (this.state !== "Playing") return false;
    this.positionMs = this.getPositionMs(); // freeze position
    this.state = "Paused";
    this.send("pause", this.queue.current);
    return true;
  }

  resume(): boolean {
    if (this.state !== "Paused") return false;
    this.anchorTimestamp = Date.now(); // re-anchor from frozen position
    this.state = "Playing";
    this.send("resume", this.queue.current);
    return true;
  }

  /** Manual skip: always moves forward (loop "one" doesn't pin it). */
  skip(): Track | null {
    const next = this.queue.advance(false);
    if (next) {
      this.startCurrent();
      return next;
    }
    this.stopPlayback();
    return null;
  }

  seek(ms: number): boolean {
    if (this.state !== "Playing" && this.state !== "Paused") return false;
    this.positionMs = Math.max(0, ms);
    this.anchorTimestamp = Date.now();
    this.send("seek", this.queue.current);
    return true;
  }

  /** /stop — halt playback and clear the whole queue: any state -> Stopped -> Idle. */
  stop() {
    this.send("stop", this.queue.current ?? this.queue.items[0] ?? null);
    this.queue.clear();
    this.state = "Stopped";
    this.toIdle();
  }

  /** Playback ran out (queue exhausted) — tell clients and go Idle. */
  private stopPlayback() {
    this.send("stop", this.queue.current);
    this.toIdle();
  }

  private toIdle() {
    this.state = "Idle";
    this.positionMs = 0;
  }

  /**
   * A human client reported the current video ended. Every human in the room
   * sends one of these, so dedupe: only the first report for the current
   * video (and not within 2s of the last advance) triggers "trackEnded".
   */
  reportEnded(videoId: string) {
    if (this.state !== "Playing") return;
    if (this.queue.current?.videoId !== videoId) return;
    if (Date.now() - this.lastAdvanceAt < 2000) return;
    this.lastAdvanceAt = Date.now();
    this.emit("trackEnded", videoId); // observed by MusicFacade
  }

  /** Natural end-of-track: advance respecting loopMode ("one" replays). */
  autoAdvance() {
    const next = this.queue.advance(true);
    if (next) this.startCurrent();
    else this.stopPlayback();
  }
}
