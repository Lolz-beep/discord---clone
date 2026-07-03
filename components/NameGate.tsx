"use client";

import { useState } from "react";

/** Full-screen prompt for a display name before connecting to the server. */
export default function NameGate({ onSubmit }: { onSubmit: (name: string) => void }) {
  const [name, setName] = useState("");

  const submit = () => {
    const trimmed = name.trim();
    if (trimmed) onSubmit(trimmed);
  };

  return (
    <div className="flex h-full items-center justify-center bg-[#1e1f22]">
      <div className="w-full max-w-sm rounded-lg bg-[#313338] p-8 shadow-xl">
        <h1 className="text-center text-2xl font-bold text-white">Welcome!</h1>
        <p className="mt-2 text-center text-sm text-gray-400">
          Pick a display name to start chatting and calling.
        </p>
        <label className="mt-6 block text-xs font-semibold uppercase tracking-wide text-gray-400">
          Display name
        </label>
        <input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === "Enter" && submit()}
          placeholder="e.g. Ada"
          maxLength={32}
          className="mt-2 w-full rounded bg-[#1e1f22] px-3 py-2 text-gray-100 outline-none ring-1 ring-transparent placeholder:text-gray-500 focus:ring-indigo-500"
        />
        <button
          onClick={submit}
          disabled={!name.trim()}
          className="mt-4 w-full rounded bg-indigo-500 py-2 font-medium text-white transition hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Continue
        </button>
      </div>
    </div>
  );
}
