"use client";

import { useEffect, useRef, useState } from "react";
import type { ChatMessage } from "@/lib/protocol";

/** Scrollable message list + input box. */
export default function ChatPanel({
  messages,
  meId,
  onSend,
  roomId,
}: {
  messages: ChatMessage[];
  meId: string;
  onSend: (text: string) => void;
  roomId: string;
}) {
  const [draft, setDraft] = useState("");
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // Keep the newest message in view.
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  const submit = () => {
    if (draft.trim()) {
      onSend(draft);
      setDraft("");
    }
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex-1 overflow-y-auto px-4 py-3">
        {messages.length === 0 && (
          <p className="py-8 text-center text-sm text-gray-500">
            This is the beginning of <span className="font-semibold">#{roomId}</span>. Say hi!
          </p>
        )}
        {messages.map((m, i) => (
          <div key={`${m.timestamp}-${m.user.id}-${i}`} className="group flex gap-3 rounded px-2 py-1.5 hover:bg-[#2e3035]">
            <div
              className={`mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-xs font-bold text-white ${
                m.user.isBot ? "bg-emerald-600" : m.user.id === meId ? "bg-indigo-500" : "bg-[#5865f2]"
              }`}
            >
              {m.user.displayName.slice(0, 2).toUpperCase()}
            </div>
            <div className="min-w-0">
              <div className="flex items-baseline gap-2">
                <span className="text-sm font-semibold text-white">{m.user.displayName}</span>
                {m.user.isBot && (
                  <span className="rounded bg-indigo-500 px-1 text-[10px] font-bold uppercase text-white">
                    Bot
                  </span>
                )}
                <span className="text-xs text-gray-500">
                  {new Date(m.timestamp).toLocaleTimeString([], {
                    hour: "2-digit",
                    minute: "2-digit",
                  })}
                </span>
              </div>
              <p className="break-words text-sm text-gray-200">{m.text}</p>
            </div>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>

      <div className="px-4 pb-4">
        <div className="flex items-center rounded-lg bg-[#383a40] px-4">
          <input
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && submit()}
            placeholder={`Message #${roomId}`}
            className="min-w-0 flex-1 bg-transparent py-2.5 text-sm text-gray-100 outline-none placeholder:text-gray-500"
          />
          <button
            onClick={submit}
            disabled={!draft.trim()}
            className="text-sm font-medium text-indigo-400 transition hover:text-indigo-300 disabled:opacity-40"
          >
            Send
          </button>
        </div>
      </div>
    </div>
  );
}
