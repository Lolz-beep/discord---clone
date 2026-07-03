import { MusicPlayer } from "../domain/MusicPlayer";
import type { MusicMessage } from "../protocol";

/**
 * DATA ACCESS layer: the repository holding per-room playback state
 * (MusicPlayer = queue + state machine). Storage is in-memory for the
 * prototype; swapping in persistence would only touch this class.
 */
export class PlayerRegistry {
  private readonly players = new Map<string, MusicPlayer>();

  constructor(
    private readonly broadcast: (msg: MusicMessage) => void,
    /** Called once per newly created player so observers can be wired up. */
    private readonly onCreate: (player: MusicPlayer) => void
  ) {}

  getOrCreate(roomId: string): MusicPlayer {
    let player = this.players.get(roomId);
    if (!player) {
      player = new MusicPlayer(roomId, this.broadcast);
      this.players.set(roomId, player);
      this.onCreate(player);
    }
    return player;
  }

  get(roomId: string): MusicPlayer | undefined {
    return this.players.get(roomId);
  }
}
