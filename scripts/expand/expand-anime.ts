/**
 * Grow anime.csv via AniList (GraphQL).
 *
 * Field mapping (AniList Media → anime columns):
 *   title          ← title.english || romaji || native
 *   release_date   ← startDate {year,month,day} via formatSignedDate
 *   genre          ← genres[] joined with "; "
 *   poster         ← coverImage.extraLarge || large
 *   reference_url  ← siteUrl
 *   rating         ← averageScore
 *   format         ← format (TV, MOVIE, OVA, …)
 *   studio         ← main studio name(s), else first studios, joined "; "
 *   mangaka        ← "Original Creator/Story" staff on the anime, else on the
 *                    adapted MANGA's staff
 *   anilist_id     ← Media.id
 *
 *   npm run expand:anime -- --keywords "..." --limit N
 *
 *   --keywords  when present, each keyword runs a separate AniList `search`
 *               query (popularity-sorted); without it, a plain popularity sweep.
 *   --limit     total candidate cap (default 50). AniList pages are 50 wide.
 */

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
import { userAgent } from "../lib/user-agent";

const meta = getMeta("anime");

const UA = userAgent();
const ANILIST = "https://graphql.anilist.co";

let lastCall = 0;
const MIN_GAP_MS = 750;

async function throttle() {
  const now = Date.now();
  const wait = lastCall + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

async function gqlPost<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T | null> {
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await throttle();
    try {
      const res = await fetch(ANILIST, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Accept: "application/json",
          "User-Agent": UA,
        },
        body: JSON.stringify({ query, variables }),
      });
      if (res.status === 429) {
        const retryAfter = parseInt(res.headers.get("retry-after") ?? "5", 10);
        await new Promise((r) => setTimeout(r, (retryAfter + 1) * 1000));
        continue;
      }
      if (res.status === 404) return null;
      if (!res.ok) {
        await new Promise((r) => setTimeout(r, (attempt + 1) * 2500));
        continue;
      }
      const json = (await res.json()) as { data?: T };
      return json.data ?? null;
    } catch {
      await new Promise((r) => setTimeout(r, (attempt + 1) * 2500));
    }
  }
  return null;
}

const PAGE_QUERY = `
query ($page: Int, $perPage: Int, $search: String) {
  Page(page: $page, perPage: $perPage) {
    pageInfo { hasNextPage }
    media(type: ANIME, sort: POPULARITY_DESC, search: $search, isAdult: false) {
      id
      title { english romaji native }
      startDate { year month day }
      genres
      coverImage { extraLarge large }
      siteUrl
      averageScore
      popularity
      favourites
      episodes
      duration
      source
      season
      seasonYear
      format
      studios { edges { isMain node { name } } }
      staff(perPage: 25) {
        edges { role node { name { full } } }
      }
      relations {
        edges {
          relationType
          node { id type }
        }
      }
    }
  }
}`;

const MANGA_STAFF_QUERY = `
query ($id: Int) {
  Media(id: $id, type: MANGA) {
    staff(perPage: 8) {
      edges { role node { name { full } } }
    }
  }
}`;

interface Media {
  id: number;
  title?: {
    english?: string | null;
    romaji?: string | null;
    native?: string | null;
  };
  startDate?: {
    year?: number | null;
    month?: number | null;
    day?: number | null;
  };
  genres?: string[];
  coverImage?: { extraLarge?: string | null; large?: string | null };
  siteUrl?: string | null;
  averageScore?: number | null;
  popularity?: number | null;
  favourites?: number | null;
  episodes?: number | null;
  duration?: number | null;
  source?: string | null;
  season?: string | null;
  seasonYear?: number | null;
  format?: string | null;
  studios?: { edges?: { isMain: boolean; node: { name: string } }[] };
  staff?: {
    edges?: {
      role?: string | null;
      node: { name?: { full?: string | null } };
    }[];
  };
  relations?: {
    edges?: { relationType: string; node: { id: number; type?: string } }[];
  };
}

interface PageData {
  Page?: {
    pageInfo?: { hasNextPage?: boolean };
    media?: Media[];
  };
}

function pickTitle(t: Media["title"]): string {
  return (t?.english || t?.romaji || t?.native || "").trim();
}

function pickStudio(s: Media["studios"]): string {
  const edges = s?.edges ?? [];
  const main = edges
    .filter((e) => e.isMain)
    .map((e) => e.node?.name)
    .filter(Boolean);
  if (main.length) return main.join("; ");
  const any = edges.map((e) => e.node?.name).filter(Boolean);
  return any.slice(0, 2).join("; ");
}

const MANGAKA_ROLE =
  /\b(original creator|original story|story|creator|story & art|story and art|original work|original concept|manga author|author)\b/i;

function pickFromStaffEdges(
  edges: { role?: string | null; node: { name?: { full?: string | null } } }[],
): string {
  const creators = edges
    .filter((e) => MANGAKA_ROLE.test(e.role ?? ""))
    .map((e) => e.node?.name?.full ?? "")
    .filter(Boolean);
  if (creators.length === 0) return "";
  const seen = new Set<string>();
  const uniq: string[] = [];
  for (const c of creators) {
    const k = c.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    uniq.push(c);
    if (uniq.length === 2) break;
  }
  return uniq.join("; ");
}

async function pickMangaka(m: Media): Promise<string> {
  const animeStaff = m.staff?.edges ?? [];
  const fromAnime = pickFromStaffEdges(animeStaff);
  if (fromAnime) return fromAnime;
  const mangaEdge = (m.relations?.edges ?? []).find(
    (e) =>
      e.node?.type === "MANGA" &&
      (e.relationType === "ADAPTATION" ||
        e.relationType === "SOURCE" ||
        e.relationType === "PARENT"),
  );
  if (!mangaEdge) return "";
  const data = await gqlPost<{
    Media?: {
      staff?: {
        edges?: {
          role?: string | null;
          node: { name?: { full?: string | null } };
        }[];
      };
    };
  }>(MANGA_STAFF_QUERY, { id: mangaEdge.node.id });
  const mangaStaff = data?.Media?.staff?.edges ?? [];
  return pickFromStaffEdges(mangaStaff);
}

function prettyEnum(v: string | null | undefined): string {
  if (!v) return "";
  return v
    .toLowerCase()
    .split("_")
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
}

function pickSeason(m: Media): string {
  const s = prettyEnum(m.season);
  const y = m.seasonYear != null ? String(m.seasonYear) : "";
  return [s, y].filter(Boolean).join(" ");
}

function numStr(n: number | null | undefined): string {
  return n != null ? String(n) : "";
}

function toRow(m: Media): Row | null {
  const title = pickTitle(m.title);
  if (!title) return null;
  return {
    id: "",
    title,
    release_date: formatSignedDate(
      m.startDate && m.startDate.year != null
        ? {
            year: m.startDate.year,
            month: m.startDate.month ?? null,
            day: m.startDate.day ?? null,
          }
        : null,
    ),
    genre: (m.genres ?? []).join("; "),
    poster: m.coverImage?.extraLarge ?? m.coverImage?.large ?? "",
    reference_url: m.siteUrl ?? "",
    rating: m.averageScore != null ? String(m.averageScore) : "",
    format: m.format ?? "",
    studio: pickStudio(m.studios),
    mangaka: "", // filled in below (async)
    episodes: numStr(m.episodes),
    duration_minutes: numStr(m.duration),
    popularity: numStr(m.popularity),
    favourites: numStr(m.favourites),
    source: prettyEnum(m.source),
    season: pickSeason(m),
    anilist_id: String(m.id),
  };
}

async function fetchMediaList(args: ExpandArgs): Promise<Media[]> {
  const perPage = 50;
  const searches: (string | null)[] = args.keywords.length
    ? args.keywords
    : [null];
  const collected: Media[] = [];
  const seenIds = new Set<number>();

  for (const search of searches) {
    let page = 1;
    while (collected.length < args.limit) {
      const data = await gqlPost<PageData>(PAGE_QUERY, {
        page,
        perPage,
        search,
      });
      const media = data?.Page?.media ?? [];
      if (media.length === 0) break;
      for (const m of media) {
        if (seenIds.has(m.id)) continue;
        seenIds.add(m.id);
        collected.push(m);
        if (collected.length >= args.limit) break;
      }
      if (!data?.Page?.pageInfo?.hasNextPage) break;
      page += 1;
    }
    if (collected.length >= args.limit) break;
  }
  return collected.slice(0, args.limit);
}

async function discover(args: ExpandArgs): Promise<Row[]> {
  const media = await fetchMediaList(args);
  console.log(`Fetched ${media.length} candidate anime from AniList`);
  const rows: Row[] = [];
  let i = 0;
  for (const m of media) {
    i += 1;
    const row = toRow(m);
    if (!row) continue;
    row.mangaka = await pickMangaka(m);
    rows.push(row);
    if (i % 20 === 0) console.log(`  mapped ${i}/${media.length}`);
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
