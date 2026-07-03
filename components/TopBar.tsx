"use client";

import type { NowPlayingInfo } from "./AppShell";

/** Header: current room, socket connection status, and the Now Playing chip. */
export default function TopBar({
  roomId,
  connected,
  nowPlaying,
  musicBlocked,
  onEnableMusic,
}: {
  roomId: string | null;
  connected: boolean;
  nowPlaying: NowPlayingInfo | null;
  musicBlocked: boolean;
  onEnableMusic: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#26272b] bg-[#313338] px-4 shadow-sm">
      <span className="text-lg text-gray-500">#</span>
      <h1 className="truncate font-semibold text-white">{roomId ?? "no room"}</h1>

      <div className="ml-auto flex items-center gap-3">
        {nowPlaying && (
          <button
            onClick={musicBlocked ? onEnableMusic : undefined}
            className={`flex max-w-64 items-center gap-2 rounded-full bg-[#1e1f22] px-3 py-1 text-xs ${
              musicBlocked ? "cursor-pointer ring-1 ring-amber-500" : "cursor-default"
            }`}
            title={musicBlocked ? "Click to allow audio playback" : "Now playing"}
          >
            <span className={nowPlaying.playing ? "animate-pulse" : ""}>🎵</span>
            <span className="truncate text-gray-300">
              {musicBlocked ? "Click to play: " : ""}
              {nowPlaying.title}
            </span>
            {!nowPlaying.playing && <span className="text-gray-500">(paused)</span>}
          </button>
        )}

        <div className="flex items-center gap-1.5 text-xs text-gray-400">
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-emerald-500" : "bg-red-500"}`}
          />
          {connected ? "connected" : "disconnected"}
        </div>
      </div>
    </header>
  );
}
