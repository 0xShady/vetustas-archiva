/**
 * Shared Wikipedia helpers used across the expand scripts.
 * - `pageImage`: lead image for a page (poster/cover fallback when P18 is missing)
 * - `urlToTitle`: Wikipedia URL → page title
 */

import { userAgent } from "./user-agent";

const UA = userAgent();

const REST = "https://en.wikipedia.org/api/rest_v1";

let lastCall = 0;
const MIN_GAP_MS = 200;

async function throttle() {
  const now = Date.now();
  const wait = lastCall + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function pageImage(title: string): Promise<string | null> {
  const url = `${REST}/page/summary/${encodeURIComponent(title.replace(/ /g, "_"))}`;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { "User-Agent": UA } });
      if (res.status === 404) return null;
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 1200));
        continue;
      }
      const json = (await res.json()) as {
        originalimage?: { source?: string };
        thumbnail?: { source?: string };
      };
      return json.originalimage?.source ?? json.thumbnail?.source ?? null;
    } catch {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 1200));
    }
  }
  return null;
}

export function urlToTitle(url: string): string {
  const m = url.match(/wikipedia\.org\/wiki\/(.+)$/);
  if (!m) return "";
  return decodeURIComponent(m[1]).replace(/_/g, " ");
}
