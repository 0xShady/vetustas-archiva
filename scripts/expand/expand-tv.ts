/**
 * Grow tv.csv via TMDB (The Movie Database).
 *
 * REQUIRES an API key: set `TMDB_API_KEY` in the environment (a v3 API key).
 *
 * Field mapping (TMDB /tv/{id} → tv columns):
 *   title         ← name
 *   first_aired   ← first_air_date  (via formatSignedDate)
 *   last_aired    ← last_air_date   (via formatSignedDate)
 *   seasons       ← number_of_seasons
 *   episodes      ← number_of_episodes
 *   reference_url ← homepage, else the TMDB page URL
 *   genre         ← genres[].name joined "; " (top 2)
 *   network       ← networks[0].name
 *   creator       ← created_by[].name (top 2, joined "; ")
 *   country       ← origin_country[0]
 *   poster        ← poster_path → https://image.tmdb.org/t/p/original<path>
 *   wikidata_id   ← left blank (dedup still works on tmdb_id)
 *   tmdb_id       ← id
 *
 *   --keywords  each keyword runs a `/search/tv` query.
 *   --limit     total candidate cap (default 50). TMDB pages are 20 wide.
 */

import "../lib/load-env";
import {
  getMeta,
  parseArgs,
  readDataset,
  filterNew,
  writeTmp,
  formatSignedDate,
  type Row,
  type ExpandArgs,
} from "../lib/expand-core";

const meta = getMeta("tv");

const TMDB_API_KEY = process.env.TMDB_APP_KEY ?? process.env.TMDB_API_KEY;
if (!TMDB_API_KEY) {
  console.error(
    "TMDB_APP_KEY is required. Put it in archiva/.env (same as game/.env), e.g.\n" +
      "  TMDB_APP_KEY=xxxx\n" +
      "or inline: TMDB_APP_KEY=xxxx npm run expand:tv -- --limit 50\n" +
      "Get a free v3 API key at https://www.themoviedb.org/settings/api .",
  );
  process.exit(1);
}

const TMDB = "https://api.themoviedb.org/3";
const IMG_BASE = "https://image.tmdb.org/t/p/original";

let lastCall = 0;
const MIN_GAP_MS = 250;

async function throttle() {
  const now = Date.now();
  const wait = lastCall + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function tmdbGet<T>(
  pathname: string,
  params: Record<string, string> = {},
): Promise<T | null> {
  const qs = new URLSearchParams({
    api_key: TMDB_API_KEY as string,
    ...params,
  });
  const url = `${TMDB}${pathname}?${qs.toString()}`;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await throttle();
    try {
      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
        continue;
      }
      return (await res.json()) as T;
    } catch {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2000));
    }
  }
  return null;
}

interface TvListItem {
  id: number;
}

interface TvListResponse {
  page?: number;
  total_pages?: number;
  results?: TvListItem[];
}

interface TvDetails {
  id: number;
  name?: string | null;
  first_air_date?: string | null;
  last_air_date?: string | null;
  number_of_seasons?: number | null;
  number_of_episodes?: number | null;
  homepage?: string | null;
  genres?: { id: number; name: string }[];
  networks?: { id: number; name: string }[];
  created_by?: { id: number; name: string }[];
  origin_country?: string[];
  poster_path?: string | null;
}

function pickDate(raw: string | null | undefined): string {
  if (!raw) return "";
  const m = /^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?/.exec(raw.trim());
  if (!m) return "";
  const year = parseInt(m[1], 10);
  if (!Number.isFinite(year)) return "";
  const month = m[2] ? parseInt(m[2], 10) : null;
  const day = m[3] ? parseInt(m[3], 10) : null;
  return formatSignedDate({ year, month, day });
}

function pickPoster(posterPath: string | null | undefined): string {
  const p = (posterPath ?? "").trim();
  if (!p) return "";
  if (/^https?:\/\//.test(p)) {
    return /image\.tmdb\.org/.test(p)
      ? p
      : `${IMG_BASE}${p.replace(/^.*\/t\/p\/[^/]+/, "")}`;
  }
  return `${IMG_BASE}${p.startsWith("/") ? p : `/${p}`}`;
}

function joinTop(items: { name: string }[] | undefined, max = 2): string {
  return (items ?? [])
    .map((x) => x.name?.trim())
    .filter((x): x is string => !!x)
    .slice(0, max)
    .join("; ");
}

function toRow(d: TvDetails): Row {
  return {
    id: "",
    title: (d.name ?? "").trim(),
    first_aired: pickDate(d.first_air_date),
    last_aired: pickDate(d.last_air_date),
    seasons: d.number_of_seasons != null ? String(d.number_of_seasons) : "",
    episodes: d.number_of_episodes != null ? String(d.number_of_episodes) : "",
    reference_url:
      (d.homepage ?? "").trim() || `https://www.themoviedb.org/tv/${d.id}`,
    genre: joinTop(d.genres, 2),
    network: (d.networks ?? [])[0]?.name?.trim() ?? "",
    creator: joinTop(d.created_by, 2),
    country: (d.origin_country ?? [])[0]?.trim() ?? "",
    poster: pickPoster(d.poster_path),
    wikidata_id: "",
    tmdb_id: String(d.id),
  };
}

async function collectIds(args: ExpandArgs): Promise<number[]> {
  const ids: number[] = [];
  const seen = new Set<number>();
  const queries: (string | null)[] = args.keywords.length
    ? args.keywords
    : [null];

  for (const kw of queries) {
    let page = 1;
    while (ids.length < args.limit) {
      const data = kw
        ? await tmdbGet<TvListResponse>("/search/tv", {
            query: kw,
            page: String(page),
          })
        : await tmdbGet<TvListResponse>("/discover/tv", {
            sort_by: "popularity.desc",
            page: String(page),
          });
      const results = data?.results ?? [];
      if (results.length === 0) break;
      for (const r of results) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        ids.push(r.id);
        if (ids.length >= args.limit) break;
      }
      const totalPages = data?.total_pages ?? page;
      if (page >= totalPages) break;
      page += 1;
    }
    if (ids.length >= args.limit) break;
  }
  return ids.slice(0, args.limit);
}

async function discover(args: ExpandArgs): Promise<Row[]> {
  const ids = await collectIds(args);
  console.log(`Discovered ${ids.length} candidate TV ids from TMDB`);
  const rows: Row[] = [];
  let i = 0;
  for (const id of ids) {
    i += 1;
    const details = await tmdbGet<TvDetails>(`/tv/${id}`);
    if (!details) continue;
    rows.push(toRow(details));
    if (i % 20 === 0) console.log(`  detail-fetch ${i}/${ids.length}`);
  }
  return rows;
}

async function main() {
  const args = parseArgs(process.argv.slice(2), { limit: 50 });
  const candidates = await discover(args);
  const { rows: existing } = readDataset(meta.file);
  const { fresh, droppedKnown, droppedRequired } = filterNew(
    meta,
    existing,
    candidates,
    { alsoName: true },
  );
  const dest = writeTmp(meta, fresh, args.out);
  console.log(
    `Wrote ${fresh.length} → ${dest} (dropped ${droppedKnown} known, ${droppedRequired} incomplete). Then: npm run merge -- ${meta.slug}`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
