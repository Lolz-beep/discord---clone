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
  track: { url: string; title?: string; [key: string]: unknown };
  positionMs: number;
  serverTimestamp: number; // bot's clock at send time, used for rough client sync
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
  | MusicEvent;

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
  | { type: "error"; message: string };
