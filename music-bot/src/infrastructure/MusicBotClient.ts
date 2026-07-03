import { EventEmitter } from "events";
import WebSocket from "ws";
import type { ChatMessage, GatewayMessage, JoinMessage, WireUser } from "../protocol";

export interface ClientConfig {
  wsUrl: string;
  token: string;
  roomId: string;
  botName: string;
}

/**
 * SINGLETON — the one and only connection to the clone's WS gateway.
 *
 * The private constructor + static getInstance() guarantee a single
 * gatewaySocket for the whole process, no matter how many modules import
 * this class. Everything that happens on the wire flows through here.
 *
 * OBSERVER — this class is also the event source for the rest of the bot:
 * incoming frames are re-emitted via emitEvent() as typed events ("chat",
 * "musicEvent", ...). The MusicFacade subscribes and reacts; nothing polls.
 */
export class MusicBotClient extends EventEmitter {
  private static instance: MusicBotClient | null = null;

  private gatewaySocket: WebSocket | null = null;
  private readonly token: string;
  public isConnected = false;

  public readonly botUser: WireUser;
  public readonly roomId: string;
  private readonly wsUrl: string;
  private reconnectTimer: NodeJS.Timeout | null = null;
  private stopped = false;

  /** Private: use MusicBotClient.getInstance(config). */
  private constructor(config: ClientConfig) {
    super();
    this.wsUrl = config.wsUrl;
    this.token = config.token;
    this.roomId = config.roomId;
    this.botUser = { id: `bot-${Date.now()}`, displayName: config.botName, isBot: true };
  }

  /** First call must pass the config; later calls return the same instance. */
  static getInstance(config?: ClientConfig): MusicBotClient {
    if (!MusicBotClient.instance) {
      if (!config) throw new Error("MusicBotClient.getInstance needs a config on first call");
      MusicBotClient.instance = new MusicBotClient(config);
    }
    return MusicBotClient.instance;
  }

  /** Open the socket and perform the isBot join handshake. */
  connect() {
    this.stopped = false;
    console.log(`[client] connecting to ${this.wsUrl} ...`);
    const socket = new WebSocket(this.wsUrl);
    this.gatewaySocket = socket;

    socket.on("open", () => {
      this.isConnected = true;
      console.log(`[client] connected — joining room "${this.roomId}" as ${this.botUser.displayName}`);
      const join: JoinMessage = {
        type: "join",
        roomId: this.roomId,
        user: this.botUser,
        token: this.token,
      };
      socket.send(JSON.stringify(join));
      this.emitEvent({ type: "connected" });
    });

    socket.on("message", (data) => {
      let msg: GatewayMessage;
      try {
        msg = JSON.parse(data.toString());
      } catch {
        return;
      }
      this.emitEvent(msg);
    });

    socket.on("close", (code, reason) => {
      this.isConnected = false;
      console.log(`[client] disconnected (code ${code}${reason ? `, ${reason}` : ""})`);
      // 4001/4002/4003 mean our token is bad/revoked — retrying is pointless.
      if (code === 4001 || code === 4002 || code === 4003) {
        console.error("[client] token rejected by gateway — check BOT_TOKEN / ROOM_ID");
        process.exit(1);
      }
      if (!this.stopped) {
        console.log("[client] retrying in 5s ...");
        this.reconnectTimer = setTimeout(() => this.connect(), 5000);
      }
    });

    socket.on("error", (err) => {
      console.error(`[client] socket error: ${err.message}`);
    });
  }

  disconnect() {
    this.stopped = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.gatewaySocket?.close();
    this.isConnected = false;
  }

  /** Re-emit a gateway frame as a typed event (Observer hookup point). */
  emitEvent(event: GatewayMessage | { type: string }) {
    this.emit(event.type, event);
  }

  send(msg: object) {
    if (this.gatewaySocket && this.gatewaySocket.readyState === WebSocket.OPEN) {
      this.gatewaySocket.send(JSON.stringify(msg));
    }
  }

  /** Replies (queue lists, errors, now-playing) go out as normal chat. */
  sendChat(roomId: string, text: string) {
    const msg: ChatMessage = {
      type: "chat",
      roomId,
      user: this.botUser,
      text,
      timestamp: Date.now(),
    };
    this.send(msg);
  }
}
