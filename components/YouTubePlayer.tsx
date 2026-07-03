"use client";

/**
 * Bot-driven YouTube playback (browser-only). The music bot broadcasts
 * `music { action, videoId, positionMs, serverTimestamp }` events; this
 * component obeys them with the YouTube IFrame Player API and reports
 * `ended` back up so the bot can auto-advance its queue. The bot is the
 * source of truth — there is no local queue or command parsing here.
 */

import { useEffect, useRef, useState } from "react";

export interface MusicCommand {
  seq: number; // monotonically increasing so repeated actions re-trigger
  action: string;
  videoId: string;
  positionMs: number;
  serverTimestamp: number;
}

/* Minimal typings for the bits of the IFrame API we use. */
interface YTPlayer {
  loadVideoById: (videoId: string, startSeconds?: number) => void;
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (seconds: number, allowSeekAhead: boolean) => void;
  getPlayerState: () => number;
  destroy: () => void;
}
interface YTNamespace {
  Player: new (el: HTMLElement, opts: unknown) => YTPlayer;
  PlayerState: { ENDED: number; PLAYING: number; BUFFERING: number };
}
declare global {
  interface Window {
    YT?: YTNamespace;
    onYouTubeIframeAPIReady?: () => void;
  }
}

/* The IFrame API script is loaded once per page, on first use. */
let apiPromise: Promise<YTNamespace> | null = null;
function loadYouTubeApi(): Promise<YTNamespace> {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise((resolve) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      resolve(window.YT!);
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    document.head.appendChild(tag);
  });
  return apiPromise;
}

export default function YouTubePlayer({
  command,
  visible,
  onEnded,
}: {
  /** Latest music command from the bot (null before any arrives). */
  command: MusicCommand | null;
  /** Panel shown only while something is (or was) playing. */
  visible: boolean;
  /** The current video finished — report so the bot advances its queue. */
  onEnded: (videoId: string) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const playerPromiseRef = useRef<Promise<YTPlayer> | null>(null);
  const currentVideoRef = useRef<string | null>(null);
  const [needsClick, setNeedsClick] = useState(false); // autoplay was blocked
  const onEndedRef = useRef(onEnded);
  onEndedRef.current = onEnded;

  // Create the player once. YT.Player replaces the inner div with an iframe,
  // so that div must not be managed by React reconciliation beyond mounting.
  useEffect(() => {
    let destroyed = false;
    let instance: YTPlayer | null = null;
    playerPromiseRef.current = loadYouTubeApi().then(
      (YT) =>
        new Promise<YTPlayer>((resolve) => {
          if (destroyed || !hostRef.current) return;
          const player: YTPlayer = new YT.Player(hostRef.current, {
            width: "100%",
            height: "100%",
            playerVars: { playsinline: 1, controls: 1, rel: 0, origin: location.origin },
            events: {
              onReady: () => resolve(player),
              onStateChange: (e: { data: number }) => {
                if (e.data === YT.PlayerState.PLAYING) setNeedsClick(false);
                if (e.data === YT.PlayerState.ENDED && currentVideoRef.current) {
                  onEndedRef.current(currentVideoRef.current);
                }
              },
            },
          });
          instance = player;
        })
    );
    return () => {
      destroyed = true;
      instance?.destroy();
    };
  }, []);

  // Obey each incoming command (seq changes even if the action repeats).
  useEffect(() => {
    if (!command) return;
    let stale = false;
    playerPromiseRef.current?.then((player) => {
      if (stale) return;
      // Rough sync: where the bot said the track was, plus transit time.
      const pos = Math.max(0, (command.positionMs + (Date.now() - command.serverTimestamp)) / 1000);
      switch (command.action) {
        case "play":
          currentVideoRef.current = command.videoId;
          player.loadVideoById(command.videoId, pos);
          armAutoplayCheck(player);
          break;
        case "resume":
          player.seekTo(pos, true);
          player.playVideo();
          armAutoplayCheck(player);
          break;
        case "pause":
          player.pauseVideo();
          break;
        case "seek":
          player.seekTo(pos, true);
          break;
        case "stop":
          currentVideoRef.current = null;
          player.stopVideo();
          break;
        default:
          break; // unknown actions are the bot's business, not ours
      }
    });
    return () => {
      stale = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [command?.seq]);

  // If the browser blocked unmuted autoplay, surface a click-to-start overlay.
  const armAutoplayCheck = (player: YTPlayer) => {
    setTimeout(() => {
      const YT = window.YT;
      if (!YT) return;
      const s = player.getPlayerState();
      if (s !== YT.PlayerState.PLAYING && s !== YT.PlayerState.BUFFERING && currentVideoRef.current) {
        setNeedsClick(true);
      }
    }, 2000);
  };

  return (
    <div
      className={`fixed bottom-20 right-4 z-40 w-80 overflow-hidden rounded-lg border border-[#26272b] bg-[#1e1f22] shadow-2xl ${
        visible ? "" : "hidden"
      }`}
    >
      <div className="relative aspect-video">
        <div ref={hostRef} className="h-full w-full" />
        {needsClick && (
          <button
            onClick={() => {
              playerPromiseRef.current?.then((p) => p.playVideo());
              setNeedsClick(false);
            }}
            className="absolute inset-0 flex items-center justify-center bg-black/70 text-sm font-medium text-white"
          >
            ▶ Click to start playback
          </button>
        )}
      </div>
    </div>
  );
}
