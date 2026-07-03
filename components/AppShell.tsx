"use client";

/**
 * Top-level Client Component: owns the WebSocket connection, room/chat state,
 * local media (getUserMedia / getDisplayMedia), the WebRTC mesh, and the
 * bot-driven music player. All browser-only media logic lives here (client
 * side only — this file is never executed on the server beyond SSR of markup).
 */

import { useCallback, useEffect, useRef, useState } from "react";
import { Mesh, type RemoteMedia } from "@/lib/mesh";
import type {
  ChatMessage,
  ClientMessage,
  MediaState,
  MusicEvent,
  ServerMessage,
  User,
} from "@/lib/protocol";
import Sidebar from "./Sidebar";
import TopBar from "./TopBar";
import ChatPanel from "./ChatPanel";
import VideoGrid, { type TileData } from "./VideoGrid";
import ControlBar from "./ControlBar";
import NameGate from "./NameGate";

export interface PeerInfo {
  user: User;
  media: RemoteMedia;
  mediaState: MediaState;
}

export interface NowPlayingInfo {
  title: string;
  playing: boolean;
}

const OFF_MEDIA: MediaState = { micOn: false, camOn: false, screenOn: false };

export default function AppShell() {
  // ---- identity / connection -----------------------------------------------
  const [me, setMe] = useState<User | null>(null);
  const [connected, setConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const meshRef = useRef<Mesh | null>(null);

  // ---- room / chat state ----------------------------------------------------
  const [rooms, setRooms] = useState<{ name: string; count: number }[]>([]);
  const [roomId, setRoomId] = useState<string | null>(null);
  const roomIdRef = useRef<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [peers, setPeers] = useState<Record<string, PeerInfo>>({});

  // ---- local media ----------------------------------------------------------
  const [local, setLocal] = useState<MediaState>(OFF_MEDIA);
  const localRef = useRef<MediaState>(OFF_MEDIA);
  const [localCamStream, setLocalCamStream] = useState<MediaStream | null>(null);
  const [localScreenStream, setLocalScreenStream] = useState<MediaStream | null>(null);
  const micStreamRef = useRef<MediaStream | null>(null);
  const camStreamRef = useRef<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);

  // ---- bot music player -----------------------------------------------------
  const musicAudioRef = useRef<HTMLAudioElement | null>(null);
  const [nowPlaying, setNowPlaying] = useState<NowPlayingInfo | null>(null);
  const [musicBlocked, setMusicBlocked] = useState(false); // autoplay was denied

  const meRef = useRef<User | null>(null);
  meRef.current = me;
  localRef.current = local;
  roomIdRef.current = roomId;

  const sendMsg = useCallback((msg: ClientMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(msg));
  }, []);

  const broadcastMediaState = useCallback(
    (state: MediaState) => {
      const user = meRef.current;
      const room = roomIdRef.current;
      if (user && room) sendMsg({ type: "media", roomId: room, userId: user.id, ...state });
    },
    [sendMsg]
  );

  // ---- bot music: obey incoming events, HTML5 Audio does the playback -------
  const applyMusic = useCallback((msg: MusicEvent) => {
    const audio = musicAudioRef.current;
    if (!audio) return;
    // Rough cross-client sync: the bot tells us where the track was
    // (positionMs) at serverTimestamp; add elapsed transit time.
    const targetSec = () =>
      Math.max(0, (msg.positionMs + (Date.now() - msg.serverTimestamp)) / 1000);
    const title = msg.track?.title ?? msg.track?.url ?? "unknown track";

    const tryPlay = () =>
      audio
        .play()
        .then(() => setMusicBlocked(false))
        .catch(() => setMusicBlocked(true)); // autoplay policy — needs a click

    switch (msg.action) {
      case "play":
        audio.src = msg.track.url;
        audio.addEventListener("loadedmetadata", () => (audio.currentTime = targetSec()), {
          once: true,
        });
        tryPlay();
        setNowPlaying({ title, playing: true });
        break;
      case "resume":
        audio.currentTime = targetSec();
        tryPlay();
        setNowPlaying({ title, playing: true });
        break;
      case "pause":
        audio.pause();
        setNowPlaying((np) => (np ? { ...np, playing: false } : { title, playing: false }));
        break;
      case "seek":
        audio.currentTime = targetSec();
        break;
      case "stop":
        audio.pause();
        audio.removeAttribute("src");
        setNowPlaying(null);
        break;
      default:
        // Unknown actions are ignored — the clone does not interpret bot logic.
        break;
    }
  }, []);

  // ---- WebSocket lifecycle (created once the user picks a name) -------------
  const connect = useCallback(
    (user: User) => {
      const proto = location.protocol === "https:" ? "wss" : "ws";
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      wsRef.current = ws;

      const mesh = new Mesh(
        // Signaling out: ride the shared socket.
        (to, kind, payload) => {
          const room = roomIdRef.current;
          if (room)
            sendMsg({ type: "signal", roomId: room, from: user.id, to, kind, payload });
        },
        // Remote media in: update that peer's tile streams.
        (peerId, media) => {
          setPeers((prev) =>
            prev[peerId] ? { ...prev, [peerId]: { ...prev[peerId], media } } : prev
          );
        }
      );
      meshRef.current = mesh;

      ws.onopen = () => setConnected(true);
      ws.onclose = () => {
        setConnected(false);
        mesh.closeAll();
        setPeers({});
      };

      ws.onmessage = (event) => {
        let msg: ServerMessage;
        try {
          msg = JSON.parse(event.data);
        } catch {
          return;
        }

        switch (msg.type) {
          case "rooms":
            setRooms(msg.rooms);
            break;

          case "peers":
            // We just joined: connect (as initiator) to every human already here.
            for (const peer of msg.users) {
              if (peer.isBot) continue; // bots don't do WebRTC or tiles
              setPeers((prev) => ({
                ...prev,
                [peer.id]: { user: peer, media: { mic: null, cam: null, screen: null }, mediaState: OFF_MEDIA },
              }));
              mesh.connectTo(peer.id);
            }
            break;

          case "history":
            setMessages(msg.messages);
            break;

          case "chat":
            setMessages((prev) => [...prev, msg]);
            break;

          case "presence":
            if (msg.event === "joined" && msg.user && !msg.user.isBot) {
              // Newcomer will send US the offer; just render a placeholder tile
              // and re-announce our media state so they can draw our icons.
              const newcomer = msg.user;
              setPeers((prev) => ({
                ...prev,
                [newcomer.id]: {
                  user: newcomer,
                  media: { mic: null, cam: null, screen: null },
                  mediaState: OFF_MEDIA,
                },
              }));
              broadcastMediaState(localRef.current);
            } else if (msg.event === "left") {
              mesh.close(msg.userId);
              setPeers((prev) => {
                const next = { ...prev };
                delete next[msg.userId];
                return next;
              });
            }
            break;

          case "signal":
            if (msg.to === user.id) mesh.handleSignal(msg.from, msg.kind, msg.payload);
            break;

          case "media":
            setPeers((prev) =>
              prev[msg.userId]
                ? {
                    ...prev,
                    [msg.userId]: {
                      ...prev[msg.userId],
                      mediaState: {
                        micOn: msg.micOn,
                        camOn: msg.camOn,
                        screenOn: msg.screenOn,
                      },
                    },
                  }
                : prev
            );
            break;

          case "music":
            applyMusic(msg);
            break;

          case "error":
            console.warn("server error:", msg.message);
            break;
        }
      };
    },
    [applyMusic, broadcastMediaState, sendMsg]
  );

  // Tear down the socket and media when the component unmounts.
  useEffect(() => {
    return () => {
      wsRef.current?.close();
      for (const ref of [micStreamRef, camStreamRef, screenStreamRef]) {
        ref.current?.getTracks().forEach((t) => t.stop());
      }
    };
  }, []);

  // ---- name gate -------------------------------------------------------------
  const handleNameSubmit = (displayName: string) => {
    const user: User = { id: crypto.randomUUID(), displayName };
    setMe(user);
    connect(user);
  };

  // ---- room join/leave --------------------------------------------------------
  const ensureMic = useCallback(async (): Promise<MediaState> => {
    if (micStreamRef.current) return localRef.current;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      micStreamRef.current = stream;
      await meshRef.current?.setLocalTrack("mic", stream.getAudioTracks()[0]);
      const next = { ...localRef.current, micOn: true };
      setLocal(next);
      localRef.current = next;
      return next;
    } catch {
      // No mic / permission denied — join listen-only.
      const next = { ...localRef.current, micOn: false };
      setLocal(next);
      localRef.current = next;
      return next;
    }
  }, []);

  const stopCam = useCallback(async () => {
    camStreamRef.current?.getTracks().forEach((t) => t.stop());
    camStreamRef.current = null;
    setLocalCamStream(null);
    await meshRef.current?.setLocalTrack("cam", null);
  }, []);

  const stopScreen = useCallback(async () => {
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setLocalScreenStream(null);
    await meshRef.current?.setLocalTrack("screen", null);
  }, []);

  const joinRoom = useCallback(
    async (name: string) => {
      const user = meRef.current;
      const trimmed = name.trim();
      if (!user || !trimmed || trimmed === roomIdRef.current) return;

      // Leaving the previous room tears down every peer connection; the other
      // side gets a presence:left and drops our tiles.
      meshRef.current?.closeAll();
      setPeers({});
      setMessages([]);

      setRoomId(trimmed);
      roomIdRef.current = trimmed;
      sendMsg({ type: "join", roomId: trimmed, user });

      // Voice is the default call mode: grab the mic on join (mesh picks the
      // track up for both existing and future peer connections).
      const state = await ensureMic();
      broadcastMediaState(state);
    },
    [broadcastMediaState, ensureMic, sendMsg]
  );

  const leaveRoom = useCallback(async () => {
    const user = meRef.current;
    const room = roomIdRef.current;
    if (!user || !room) return;
    sendMsg({ type: "leave", roomId: room, userId: user.id });
    meshRef.current?.closeAll();
    await stopCam();
    await stopScreen();
    micStreamRef.current?.getTracks().forEach((t) => t.stop());
    micStreamRef.current = null;
    await meshRef.current?.setLocalTrack("mic", null);
    setPeers({});
    setMessages([]);
    setRoomId(null);
    roomIdRef.current = null;
    setLocal(OFF_MEDIA);
  }, [sendMsg, stopCam, stopScreen]);

  // ---- media toggles -----------------------------------------------------------
  const toggleMic = useCallback(async () => {
    if (!micStreamRef.current) {
      const state = await ensureMic();
      broadcastMediaState(state);
      return;
    }
    const track = micStreamRef.current.getAudioTracks()[0];
    const next = { ...localRef.current, micOn: !localRef.current.micOn };
    // Muting = disabling the outgoing track (keeps the connection warm).
    if (track) track.enabled = next.micOn;
    setLocal(next);
    localRef.current = next;
    broadcastMediaState(next);
  }, [broadcastMediaState, ensureMic]);

  const toggleCam = useCallback(async () => {
    if (localRef.current.camOn) {
      await stopCam();
      const next = { ...localRef.current, camOn: false };
      setLocal(next);
      localRef.current = next;
      broadcastMediaState(next);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { width: { ideal: 1280 }, height: { ideal: 720 } },
      });
      camStreamRef.current = stream;
      setLocalCamStream(stream);
      await meshRef.current?.setLocalTrack("cam", stream.getVideoTracks()[0]);
      const next = { ...localRef.current, camOn: true };
      setLocal(next);
      localRef.current = next;
      broadcastMediaState(next);
    } catch {
      /* camera denied/unavailable — stay off */
    }
  }, [broadcastMediaState, stopCam]);

  const toggleScreen = useCallback(async () => {
    if (localRef.current.screenOn) {
      await stopScreen();
      const next = { ...localRef.current, screenOn: false };
      setLocal(next);
      localRef.current = next;
      broadcastMediaState(next);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setLocalScreenStream(stream);
      const track = stream.getVideoTracks()[0];
      await meshRef.current?.setLocalTrack("screen", track);
      // The browser's own "stop sharing" button ends the track directly.
      track.onended = async () => {
        await stopScreen();
        const next = { ...localRef.current, screenOn: false };
        setLocal(next);
        localRef.current = next;
        broadcastMediaState(next);
      };
      const next = { ...localRef.current, screenOn: true };
      setLocal(next);
      localRef.current = next;
      broadcastMediaState(next);
    } catch {
      /* user cancelled the share picker */
    }
  }, [broadcastMediaState, stopScreen]);

  const sendChat = useCallback(
    (text: string) => {
      const user = meRef.current;
      const room = roomIdRef.current;
      if (!user || !room || !text.trim()) return;
      sendMsg({ type: "chat", roomId: room, user, text: text.trim(), timestamp: Date.now() });
    },
    [sendMsg]
  );

  // ---- build participant tiles ---------------------------------------------------
  const tiles: TileData[] = [];
  if (me && roomId) {
    tiles.push({
      id: "self",
      label: `${me.displayName} (you)`,
      initials: initialsOf(me.displayName),
      stream: local.camOn ? localCamStream : null,
      muteVideo: true, // never play your own audio back
      micOn: local.micOn,
      isScreen: false,
    });
    if (local.screenOn && localScreenStream) {
      tiles.push({
        id: "self-screen",
        label: "Your screen",
        initials: "🖥",
        stream: localScreenStream,
        muteVideo: true,
        micOn: true,
        isScreen: true,
      });
    }
    for (const peer of Object.values(peers)) {
      tiles.push({
        id: peer.user.id,
        label: peer.user.displayName,
        initials: initialsOf(peer.user.displayName),
        stream: peer.mediaState.camOn ? peer.media.cam : null,
        muteVideo: true, // voice arrives via the dedicated <audio> elements below
        micOn: peer.mediaState.micOn,
        isScreen: false,
      });
      if (peer.mediaState.screenOn && peer.media.screen) {
        tiles.push({
          id: `${peer.user.id}-screen`,
          label: `${peer.user.displayName}'s screen`,
          initials: "🖥",
          stream: peer.media.screen,
          muteVideo: true,
          micOn: true,
          isScreen: true,
        });
      }
    }
  }

  if (!me) return <NameGate onSubmit={handleNameSubmit} />;

  return (
    <div className="flex h-full">
      <Sidebar rooms={rooms} currentRoom={roomId} onJoin={joinRoom} me={me} />

      <div className="flex min-w-0 flex-1 flex-col">
        <TopBar
          roomId={roomId}
          connected={connected}
          nowPlaying={nowPlaying}
          musicBlocked={musicBlocked}
          onEnableMusic={() => {
            musicAudioRef.current
              ?.play()
              .then(() => setMusicBlocked(false))
              .catch(() => {});
          }}
        />

        {roomId ? (
          <div className="flex min-h-0 flex-1 flex-col">
            {tiles.length > 0 && <VideoGrid tiles={tiles} />}
            <ChatPanel messages={messages} meId={me.id} onSend={sendChat} roomId={roomId} />
            <ControlBar
              media={local}
              onToggleMic={toggleMic}
              onToggleCam={toggleCam}
              onToggleScreen={toggleScreen}
              onLeave={leaveRoom}
            />
          </div>
        ) : (
          <div className="flex flex-1 items-center justify-center text-gray-400">
            <div className="text-center">
              <p className="text-2xl font-semibold text-gray-200">No room joined</p>
              <p className="mt-2 text-sm">
                Pick a room in the sidebar, or create one by name to start talking.
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Hidden sinks: one <audio> per remote peer's mic, plus the bot-driven
          music player. Kept outside the tile tree so audio survives re-layout. */}
      {Object.values(peers).map(
        (peer) =>
          peer.media.mic && (
            <PeerAudio key={peer.user.id} stream={peer.media.mic} />
          )
      )}
      <audio ref={musicAudioRef} className="hidden" />
    </div>
  );
}

/** Hidden autoplaying audio element carrying one remote participant's voice. */
function PeerAudio({ stream }: { stream: MediaStream }) {
  const ref = useRef<HTMLAudioElement | null>(null);
  useEffect(() => {
    if (ref.current) ref.current.srcObject = stream;
  }, [stream]);
  return <audio ref={ref} autoPlay className="hidden" />;
}

function initialsOf(name: string): string {
  return (
    name
      .split(/\s+/)
      .filter(Boolean)
      .slice(0, 2)
      .map((part) => part[0]!.toUpperCase())
      .join("") || "?"
  );
}
