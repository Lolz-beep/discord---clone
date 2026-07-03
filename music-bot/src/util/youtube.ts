/** YouTube URL parsing + optional title lookup (no API key needed). */

// Matches watch?v=ID, youtu.be/ID and embed/ID forms (11-char video ids).
const VIDEO_ID_RE =
  /(?:youtube\.com\/(?:watch\?v=|embed\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/;

export function extractVideoId(url: string): string | null {
  const match = url.match(VIDEO_ID_RE);
  return match ? match[1] : null;
}

export function canonicalUrl(videoId: string): string {
  return `https://www.youtube.com/watch?v=${videoId}`;
}

/** Best-effort title via YouTube oEmbed; falls back to the video id. */
export async function fetchTitle(videoId: string): Promise<string> {
  try {
    const oembed = `https://www.youtube.com/oembed?url=${encodeURIComponent(
      canonicalUrl(videoId)
    )}&format=json`;
    const res = await fetch(oembed, { signal: AbortSignal.timeout(4000) });
    if (!res.ok) return videoId;
    const data = (await res.json()) as { title?: string };
    return data.title || videoId;
  } catch {
    return videoId;
  }
}
