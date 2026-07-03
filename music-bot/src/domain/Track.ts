import type { User } from "./User";

/** One queued YouTube video. Duration is deliberately unknown — the bot never
 *  times tracks itself; clients report "ended" (see MusicPlayer). */
export interface Track {
  id: string;
  videoId: string;
  title: string;
  url: string;
  requestedBy: User;
}
