"use client";

import type { MediaState } from "@/lib/protocol";

/** Bottom call controls: mic / camera / screen share / leave. */
export default function ControlBar({
  media,
  onToggleMic,
  onToggleCam,
  onToggleScreen,
  onLeave,
}: {
  media: MediaState;
  onToggleMic: () => void;
  onToggleCam: () => void;
  onToggleScreen: () => void;
  onLeave: () => void;
}) {
  const buttonBase =
    "flex h-11 min-w-11 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition";

  return (
    <div className="flex shrink-0 items-center justify-center gap-3 border-t border-[#26272b] bg-[#232428] px-4 py-3">
      <button
        onClick={onToggleMic}
        className={`${buttonBase} ${
          media.micOn ? "bg-[#3a3c42] text-white hover:bg-[#45474e]" : "bg-red-500 text-white hover:bg-red-600"
        }`}
        title={media.micOn ? "Mute microphone" : "Unmute microphone"}
      >
        {media.micOn ? "🎙 Mute" : "🔇 Unmute"}
      </button>

      <button
        onClick={onToggleCam}
        className={`${buttonBase} ${
          media.camOn ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-[#3a3c42] text-white hover:bg-[#45474e]"
        }`}
        title={media.camOn ? "Turn camera off" : "Turn camera on"}
      >
        📷 {media.camOn ? "Camera off" : "Camera on"}
      </button>

      <button
        onClick={onToggleScreen}
        className={`${buttonBase} ${
          media.screenOn ? "bg-emerald-600 text-white hover:bg-emerald-700" : "bg-[#3a3c42] text-white hover:bg-[#45474e]"
        }`}
        title={media.screenOn ? "Stop sharing screen" : "Share screen"}
      >
        🖥 {media.screenOn ? "Stop sharing" : "Share screen"}
      </button>

      <button
        onClick={onLeave}
        className={`${buttonBase} bg-red-500 text-white hover:bg-red-600`}
        title="Leave room"
      >
        📞 Leave
      </button>
    </div>
  );
}
