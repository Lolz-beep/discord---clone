"use client";

import { useEffect, useRef } from "react";

export interface TileData {
  id: string;
  label: string;
  initials: string;
  /** Live stream to render, or null to show the avatar placeholder. */
  stream: MediaStream | null;
  /** Video elements are always muted — voice plays via dedicated <audio> sinks. */
  muteVideo: boolean;
  micOn: boolean;
  isScreen: boolean;
}

/** Grid of participant tiles (camera or screen share) above the chat. */
export default function VideoGrid({ tiles }: { tiles: TileData[] }) {
  return (
    <div className="shrink-0 border-b border-[#26272b] bg-[#2b2d31] p-3">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {tiles.map((tile) => (
          <Tile key={tile.id} tile={tile} />
        ))}
      </div>
    </div>
  );
}

function Tile({ tile }: { tile: TileData }) {
  const videoRef = useRef<HTMLVideoElement | null>(null);

  useEffect(() => {
    if (videoRef.current && tile.stream) videoRef.current.srcObject = tile.stream;
  }, [tile.stream]);

  return (
    <div className="relative aspect-video overflow-hidden rounded-lg bg-[#1e1f22]">
      {tile.stream ? (
        <video
          ref={videoRef}
          autoPlay
          playsInline
          muted={tile.muteVideo}
          className={`h-full w-full ${tile.isScreen ? "object-contain" : "object-cover"}`}
        />
      ) : (
        <div className="flex h-full w-full items-center justify-center">
          <div className="flex h-16 w-16 items-center justify-center rounded-full bg-indigo-500 text-xl font-bold text-white">
            {tile.initials}
          </div>
        </div>
      )}

      <div className="absolute bottom-1.5 left-1.5 flex max-w-[90%] items-center gap-1.5 rounded bg-black/60 px-2 py-0.5 text-xs text-white">
        {!tile.isScreen && (
          <span title={tile.micOn ? "Mic on" : "Muted"}>{tile.micOn ? "🎙" : "🔇"}</span>
        )}
        {tile.isScreen && <span>🖥</span>}
        <span className="truncate">{tile.label}</span>
      </div>
    </div>
  );
}
