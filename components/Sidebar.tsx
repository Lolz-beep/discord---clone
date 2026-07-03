"use client";

import { useState } from "react";
import type { User } from "@/lib/protocol";

/** Left rail: room list + create/join by name, plus the local user badge. */
export default function Sidebar({
  rooms,
  currentRoom,
  onJoin,
  me,
}: {
  rooms: { name: string; count: number }[];
  currentRoom: string | null;
  onJoin: (name: string) => void;
  me: User;
}) {
  const [newRoom, setNewRoom] = useState("");

  const create = () => {
    const trimmed = newRoom.trim();
    if (trimmed) {
      onJoin(trimmed);
      setNewRoom("");
    }
  };

  return (
    <aside className="flex w-60 shrink-0 flex-col bg-[#2b2d31]">
      <div className="border-b border-[#1e1f22] px-4 py-3">
        <h2 className="truncate font-bold text-white">Discord Clone</h2>
      </div>

      <div className="flex-1 overflow-y-auto px-2 py-3">
        <p className="px-2 pb-1 text-xs font-semibold uppercase tracking-wide text-gray-400">
          Rooms
        </p>
        {rooms.length === 0 && (
          <p className="px-2 py-1 text-sm text-gray-500">No rooms yet — create one below.</p>
        )}
        {rooms.map((room) => (
          <button
            key={room.name}
            onClick={() => onJoin(room.name)}
            className={`group flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm transition ${
              room.name === currentRoom
                ? "bg-[#404249] text-white"
                : "text-gray-400 hover:bg-[#35373c] hover:text-gray-200"
            }`}
          >
            <span className="text-lg leading-none text-gray-500">#</span>
            <span className="min-w-0 flex-1 truncate">{room.name}</span>
            <span className="rounded bg-[#1e1f22] px-1.5 text-xs text-gray-400">
              {room.count}
            </span>
          </button>
        ))}
      </div>

      <div className="border-t border-[#1e1f22] p-2">
        <div className="flex gap-1">
          <input
            value={newRoom}
            onChange={(e) => setNewRoom(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && create()}
            placeholder="room name"
            maxLength={32}
            className="min-w-0 flex-1 rounded bg-[#1e1f22] px-2 py-1.5 text-sm text-gray-100 outline-none placeholder:text-gray-500 focus:ring-1 focus:ring-indigo-500"
          />
          <button
            onClick={create}
            disabled={!newRoom.trim()}
            className="rounded bg-indigo-500 px-2.5 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
            title="Create or join room"
          >
            +
          </button>
        </div>
      </div>

      <div className="flex items-center gap-2 border-t border-[#1e1f22] bg-[#232428] px-3 py-2.5">
        <div className="flex h-8 w-8 items-center justify-center rounded-full bg-indigo-500 text-xs font-bold text-white">
          {me.displayName.slice(0, 2).toUpperCase()}
        </div>
        <span className="truncate text-sm font-medium text-gray-200">{me.displayName}</span>
      </div>
    </aside>
  );
}
