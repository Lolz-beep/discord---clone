"use client";

import type { NowPlayingInfo } from "./AppShell";

/** Header: current room, socket connection status, and the Now Playing chip. */
export default function TopBar({
  roomId,
  connected,
  nowPlaying,
  onIntegrateBot,
}: {
  roomId: string | null;
  connected: boolean;
  nowPlaying: NowPlayingInfo | null;
  onIntegrateBot: () => void;
}) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-3 border-b border-[#26272b] bg-[#313338] px-4 shadow-sm">
      <span className="text-lg text-gray-500">#</span>
      <h1 className="truncate font-semibold text-white">{roomId ?? "no room"}</h1>

      <div className="ml-auto flex items-center gap-3">
        {roomId && (
          <button
            onClick={onIntegrateBot}
            className="rounded bg-[#3a3c42] px-3 py-1 text-xs font-medium text-gray-200 transition hover:bg-[#45474e]"
            title="Pair an external bot with this room"
          >
            🤖 Integrate Bot
          </button>
        )}
        {nowPlaying && (
          <div
            className="flex max-w-64 items-center gap-2 rounded-full bg-[#1e1f22] px-3 py-1 text-xs"
            title="Now playing"
          >
            <span className={nowPlaying.playing ? "animate-pulse" : ""}>🎵</span>
            <span className="truncate text-gray-300">{nowPlaying.title}</span>
            {!nowPlaying.playing && <span className="text-gray-500">(paused)</span>}
          </div>
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
