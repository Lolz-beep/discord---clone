import { existsSync, readFileSync } from "fs";
import { resolve } from "path";

/** Tiny .env loader (no dependency): KEY=VALUE lines, # comments ignored.
 *  Real environment variables win over .env values. */
export function loadEnv(file = ".env") {
  const path = resolve(process.cwd(), file);
  if (!existsSync(path)) return;
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    const value = trimmed.slice(eq + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

export function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing required env var ${name} — copy .env.example to .env and fill it in.`);
    process.exit(1);
  }
  return value;
}
