"use client";

/**
 * "Integrate Bot" setup modal — a pairing flow, not a launcher. The bot runs
 * as a SEPARATE process; we issue credentials (step 1→2), the user pastes
 * them into their bot and starts it, and we poll the status endpoint until
 * the bot's WebSocket handshake lands (step 3).
 */

import { useCallback, useEffect, useState } from "react";

export interface BotRegistration {
  botId: string;
  botName: string;
  token: string;
  wsUrl: string;
  roomId: string;
}

export default function BotModal({
  currentRoom,
  registration,
  onRegistered,
  onCancelled,
  onClose,
}: {
  currentRoom: string;
  /** Existing pending registration (modal was closed and reopened). */
  registration: BotRegistration | null;
  onRegistered: (reg: BotRegistration) => void;
  /** Registration was revoked (DELETE) — parent should forget it. */
  onCancelled: () => void;
  onClose: () => void;
}) {
  const [step, setStep] = useState(registration ? 2 : 1);
  const [botName, setBotName] = useState(registration?.botName ?? "MusicBot");
  const [roomChoice, setRoomChoice] = useState(registration?.roomId ?? currentRoom);
  const [roomOptions, setRoomOptions] = useState<string[]>([currentRoom]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [connected, setConnected] = useState(false);

  // Room dropdown options (GET /api/rooms), always including the current room.
  useEffect(() => {
    fetch("/api/rooms")
      .then((r) => r.json())
      .then((data: { rooms: { name: string }[] }) => {
        const names = new Set<string>([currentRoom, ...data.rooms.map((r) => r.name)]);
        setRoomOptions([...names]);
      })
      .catch(() => {});
  }, [currentRoom]);

  // Poll the pairing status every 2s while we have credentials outstanding.
  useEffect(() => {
    if (!registration || connected) return;
    const timer = setInterval(async () => {
      try {
        const res = await fetch(`/api/bots/${registration.botId}/status`);
        if (res.status === 404) {
          // Revoked elsewhere — start over.
          onCancelled();
          setStep(1);
          return;
        }
        const data: { connected: boolean } = await res.json();
        if (data.connected) setConnected(true);
      } catch {
        /* transient network error — keep polling */
      }
    }, 2000);
    return () => clearInterval(timer);
  }, [registration, connected, onCancelled]);

  const generate = useCallback(async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/bots/register", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roomId: roomChoice, botName }),
      });
      if (!res.ok) throw new Error((await res.json()).error ?? "registration failed");
      const data = await res.json();
      onRegistered({ ...data, botName });
      setStep(2);
    } catch (err) {
      setError(err instanceof Error ? err.message : "registration failed");
    } finally {
      setBusy(false);
    }
  }, [botName, roomChoice, onRegistered]);

  const cancel = useCallback(async () => {
    if (registration) {
      await fetch(`/api/bots/${registration.botId}`, { method: "DELETE" }).catch(() => {});
    }
    onCancelled();
    onClose();
  }, [registration, onCancelled, onClose]);

  const envSnippet = registration
    ? `WS_URL=${registration.wsUrl}\nBOT_TOKEN=${registration.token}\nROOM_ID=${registration.roomId}`
    : "";

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-lg rounded-lg bg-[#313338] shadow-2xl">
        {/* header */}
        <div className="flex items-center justify-between border-b border-[#26272b] px-5 py-4">
          <div>
            <h2 className="font-bold text-white">Integrate a bot</h2>
            <p className="text-xs text-gray-400">
              Step {step} of 3 — the bot runs as its own process; this just pairs it.
            </p>
          </div>
          <button
            onClick={onClose}
            className="rounded p-1 text-gray-400 transition hover:bg-[#3a3c42] hover:text-white"
            title="Close (keeps the pending connection)"
          >
            ✕
          </button>
        </div>

        <div className="max-h-[70vh] overflow-y-auto px-5 py-4">
          {/* STEP 1 — name + room, generate credentials */}
          {step === 1 && (
            <div className="space-y-4">
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Bot name
                </label>
                <input
                  value={botName}
                  onChange={(e) => setBotName(e.target.value)}
                  maxLength={32}
                  className="mt-1.5 w-full rounded bg-[#1e1f22] px-3 py-2 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
                />
              </div>
              <div>
                <label className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                  Room
                </label>
                <select
                  value={roomChoice}
                  onChange={(e) => setRoomChoice(e.target.value)}
                  className="mt-1.5 w-full rounded bg-[#1e1f22] px-3 py-2 text-sm text-gray-100 outline-none focus:ring-1 focus:ring-indigo-500"
                >
                  {roomOptions.map((name) => (
                    <option key={name} value={name}>
                      #{name}
                    </option>
                  ))}
                </select>
              </div>
              {error && <p className="text-sm text-red-400">{error}</p>}
              <button
                onClick={generate}
                disabled={busy || !botName.trim()}
                className="w-full rounded bg-indigo-500 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
              >
                {busy ? "Generating…" : "Generate connection"}
              </button>
            </div>
          )}

          {/* STEP 2 — credentials to paste into the bot */}
          {step === 2 && registration && (
            <div className="space-y-3">
              <CopyField label="WS_URL" value={registration.wsUrl} />
              <CopyField label="TOKEN" value={registration.token} />
              <CopyField label="ROOM_ID" value={registration.roomId} />

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    .env snippet
                  </span>
                  <CopyButton text={envSnippet} />
                </div>
                <pre className="overflow-x-auto rounded bg-[#1e1f22] px-3 py-2 text-xs leading-relaxed text-emerald-300">
                  {envSnippet}
                </pre>
              </div>

              <div>
                <div className="mb-1 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
                    Run your bot
                  </span>
                  <CopyButton text="npm start" />
                </div>
                <pre className="rounded bg-[#1e1f22] px-3 py-2 text-xs text-gray-200">npm start</pre>
              </div>

              <p className="text-sm text-gray-300">
                Paste these into your bot and start it.
              </p>

              <div className="flex gap-2 pt-1">
                <button
                  onClick={cancel}
                  className="flex-1 rounded bg-[#3a3c42] py-2 text-sm font-medium text-gray-200 transition hover:bg-[#45474e]"
                >
                  Cancel
                </button>
                <button
                  onClick={() => setStep(3)}
                  className="flex-1 rounded bg-indigo-500 py-2 text-sm font-medium text-white transition hover:bg-indigo-600"
                >
                  I&apos;ve started my bot →
                </button>
              </div>
            </div>
          )}

          {/* STEP 3 — live pairing status */}
          {step === 3 && registration && (
            <div className="flex flex-col items-center gap-4 py-6">
              {connected ? (
                <>
                  <div className="flex h-14 w-14 items-center justify-center rounded-full bg-emerald-600 text-2xl">
                    ✓
                  </div>
                  <p className="font-semibold text-emerald-400">
                    Connected — {registration.botName} is in #{registration.roomId}
                  </p>
                </>
              ) : (
                <>
                  <div className="h-10 w-10 animate-spin rounded-full border-4 border-[#3a3c42] border-t-indigo-500" />
                  <p className="text-sm text-gray-300">Waiting for bot to connect…</p>
                  <button
                    onClick={() => setStep(2)}
                    className="text-xs text-indigo-400 hover:underline"
                  >
                    ← Back to credentials
                  </button>
                </>
              )}

              <div className="flex w-full gap-2 pt-2">
                {!connected && (
                  <button
                    onClick={cancel}
                    className="flex-1 rounded bg-[#3a3c42] py-2 text-sm font-medium text-gray-200 transition hover:bg-[#45474e]"
                  >
                    Cancel
                  </button>
                )}
                <button
                  onClick={onClose}
                  disabled={!connected}
                  className="flex-1 rounded bg-indigo-500 py-2 text-sm font-medium text-white transition hover:bg-indigo-600 disabled:opacity-50"
                >
                  Done
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="rounded bg-[#3a3c42] px-2 py-0.5 text-xs text-gray-200 transition hover:bg-[#45474e]"
    >
      {copied ? "Copied ✓" : "Copy"}
    </button>
  );
}

function CopyField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-xs font-semibold uppercase tracking-wide text-gray-400">
          {label}
        </span>
        <CopyButton text={value} />
      </div>
      <code className="block truncate rounded bg-[#1e1f22] px-3 py-2 text-xs text-gray-200">
        {value}
      </code>
    </div>
  );
}
