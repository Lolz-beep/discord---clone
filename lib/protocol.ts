/**
 * Typed WebSocket message protocol shared by the server (server.ts) and the
 * browser client. One socket carries chat, WebRTC signaling, presence, and
 * bot "music" events. Every frame is a single JSON object with a `type` field.
 */

export interface User {
  id: string;
  displayName: string;
  isBot?: boolean;
}

export interface ChatMessage {
  roomId: string;
  user: User;
  text: string;
  timestamp: number; // ms since epoch
}

export type SignalKind = "offer" | "answer" | "ice";

export interface MusicEvent {
  type: "music";
  roomId: string;
  action: string; // "play" | "pause" | "resume" | "stop" | "seek" — relayed, not interpreted
  videoId: string; // YouTube video id; human clients play it via the IFrame Player API
  title?: string; // optional extra from the bot, used for the Now Playing chip
  positionMs: number;
  serverTimestamp: number; // bot's clock at send time, used for rough client sync
}

/**
 * Human client -> server -> bots: the room's current video finished playing.
 * The bot uses this (not its own timers) to auto-advance its queue.
 */
export interface MusicClientEvent {
  type: "musicEvent";
  roomId: string;
  event: "ended";
  videoId: string;
}

/** Per-user media flags so other clients can render mute icons / avatar tiles. */
export interface MediaState {
  micOn: boolean;
  camOn: boolean;
  screenOn: boolean;
}

/** Messages a client (human or bot) may send to the server. */
export type ClientMessage =
  | { type: "join"; roomId: string; user: User; token?: string }
  | { type: "leave"; roomId: string; userId: string }
  | { type: "chat"; roomId: string; user: User; text: string; timestamp: number }
  | {
      type: "signal";
      roomId: string;
      from: string;
      to: string;
      kind: SignalKind;
      payload: unknown;
    }
  | ({ type: "media"; roomId: string; userId: string } & MediaState)
  | MusicEvent
  | MusicClientEvent;

/** Messages the server sends to clients. */
export type ServerMessage =
  | { type: "peers"; roomId: string; users: User[] } // sent to a joiner: who's already here
  | {
      type: "presence";
      roomId: string;
      userId: string;
      user?: User; // included on "joined" so clients can render the newcomer
      event: "joined" | "left";
    }
  | ({ type: "chat" } & ChatMessage)
  | { type: "history"; roomId: string; messages: ChatMessage[] }
  | {
      type: "signal";
      roomId: string;
      from: string;
      to: string;
      kind: SignalKind;
      payload: unknown;
    }
  | ({ type: "media"; roomId: string; userId: string } & MediaState)
  | { type: "rooms"; rooms: { name: string; count: number }[] }
  | MusicEvent
  | MusicClientEvent // delivered to bots only
  | { type: "error"; message: string };
