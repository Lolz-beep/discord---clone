/**
 * Wire protocol with the Discord clone's WebSocket gateway.
 * These shapes must match the clone's lib/protocol.ts exactly.
 */

export interface WireUser {
  id: string;
  displayName: string;
  isBot?: boolean;
}

/** Outgoing: handshake. `token` comes from the clone's Integrate Bot modal. */
export interface JoinMessage {
  type: "join";
  roomId: string;
  user: WireUser;
  token: string;
}

/** Incoming: a chat message in our room (we act only on "/..." texts). */
export interface ChatMessage {
  type: "chat";
  roomId: string;
  user: WireUser;
  text: string;
  timestamp: number;
}

/** Outgoing: playback control, relayed by the server to all human clients. */
export interface MusicMessage {
  type: "music";
  roomId: string;
  action: "play" | "pause" | "resume" | "stop" | "seek";
  videoId: string;
  /** Optional extra so clients can show a real title without an API call. */
  title?: string;
  positionMs: number;
  serverTimestamp: number;
}

/** Incoming: a human client reports the current video finished. */
export interface MusicEndedEvent {
  type: "musicEvent";
  roomId: string;
  event: "ended";
  videoId: string;
}

export interface ErrorMessage {
  type: "error";
  message: string;
}

/** Everything the gateway may push at us (we ignore what we don't handle). */
export type GatewayMessage =
  | ChatMessage
  | MusicEndedEvent
  | ErrorMessage
  | { type: string; [key: string]: unknown };
