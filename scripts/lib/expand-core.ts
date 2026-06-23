/**
 * Shared core for the per-dataset `expand-<dataset>.ts` scripts.
 *
 *
 * `DATASET_META` is the single source of truth for each dataset's columns,
 * identity (dedup) keys, primary date column, and required fields — shared by
 * the expand scripts and by the generic merge.
 */
import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

export type Row = Record<string, string>;

export const DATASETS_DIR = path.resolve(__dirname, "..", "..", "datasets");
export const TMP_DIR = path.resolve(__dirname, "..", "..", "tmp");

export interface DatasetMeta {
  slug: string;
  file: string;
  columns: string[];
  titleField: string;
  dedupKeys: string[]; // identity columns checked against existing rows for deduplication (e.g. Wikidata QID, IMDB ID)
  dateColumn: string;
  required: string[];
}

const META = (
  slug: string,
  file: string,
  columns: string[],
  titleField: string,
  dedupKeys: string[],
  dateColumn: string,
  required: string[],
): DatasetMeta => ({
  slug,
  file,
  columns,
  titleField,
  dedupKeys,
  dateColumn,
  required,
});

export const DATASET_META: Record<string, DatasetMeta> = {
  movies: META(
    "movies",
    "movies.csv",
    [
      "id",
      "title",
      "release_date",
      "director",
      "reference_url",
      "runtime_minutes",
      "genre",
      "studio",
      "country",
      "language",
      "imdb_rating",
      "imdb_votes",
      "poster",
      "imdb_id",
      "wikidata_id",
    ],
    "title",
    ["imdb_id", "wikidata_id"],
    "release_date",
    ["title", "release_date", "poster"],
  ),
  tv: META(
    "tv",
    "tv.csv",
    [
      "id",
      "title",
      "first_aired",
      "last_aired",
      "seasons",
      "episodes",
      "reference_url",
      "genre",
      "network",
      "creator",
      "country",
      "poster",
      "wikidata_id",
      "tmdb_id",
    ],
    "title",
    ["tmdb_id", "wikidata_id"],
    "first_aired",
    ["title", "first_aired", "poster"],
  ),
  anime: META(
    "anime",
    "anime.csv",
    [
      "id",
      "title",
      "release_date",
      "genre",
      "poster",
      "reference_url",
      "rating",
      "format",
      "studio",
      "mangaka",
      "episodes",
      "duration_minutes",
      "popularity",
      "favourites",
      "source",
      "season",
      "anilist_id",
    ],
    "title",
    ["anilist_id"],
    "release_date",
    ["title", "release_date", "poster"],
  ),
  games: META(
    "games",
    "games.csv",
    [
      "id",
      "title",
      "release_date",
      "reference_url",
      "genre",
      "poster",
      "developer",
      "publisher",
      "series",
      "wikidata_id",
    ],
    "title",
    ["wikidata_id"],
    "release_date",
    ["title", "release_date", "poster"],
  ),
  music: META(
    "music",
    "music.csv",
    [
      "id",
      "title",
      "release_date",
      "artist",
      "reference_url",
      "genre",
      "label",
      "tracks",
      "duration_seconds",
      "cover",
      "wikidata_id",
      "musicbrainz_id",
      "spotify_id",
      "spotify_popularity",
      "lastfm_listeners",
      "lastfm_playcount",
      "riaa_certification",
    ],
    "title",
    ["wikidata_id"],
    "release_date",
    ["title", "release_date", "cover"],
  ),
  "fine-art": META(
    "fine-art",
    "fine-art.csv",
    [
      "id",
      "title",
      "creation_date",
      "reference_url",
      "origin_country",
      "current_country",
      "museum",
      "artist",
      "type",
      "medium",
      "movement",
      "genre",
      "image",
      "wikidata_id",
    ],
    "title",
    ["wikidata_id"],
    "creation_date",
    ["title", "creation_date", "image"],
  ),
  landmarks: META(
    "landmarks",
    "landmarks.csv",
    [
      "id",
      "title",
      "date",
      "country",
      "reference_url",
      "location",
      "type",
      "architect",
      "image",
      "wikidata_id",
    ],
    "title",
    ["wikidata_id"],
    "date",
    ["title", "date", "image"],
  ),
  literature: META(
    "literature",
    "literature.csv",
    [
      "id",
      "title",
      "publish_date",
      "author",
      "reference_url",
      "country",
      "type",
      "genre",
      "language",
      "series",
      "cover",
      "wikidata_id",
    ],
    "title",
    ["wikidata_id"],
    "publish_date",
    ["title", "publish_date", "cover"],
  ),
  events: META(
    "events",
    "events.csv",
    [
      "id",
      "title",
      "start_date",
      "end_date",
      "type",
      "country",
      "location",
      "image",
      "reference_url",
      "wikidata_id",
      "era",
    ],
    "title",
    ["wikidata_id"],
    "start_date",
    ["title", "start_date", "image"],
  ),
  inventions: META(
    "inventions",
    "inventions.csv",
    [
      "id",
      "name",
      "date",
      "reference_url",
      "country",
      "inventor",
      "type",
      "category",
      "image",
      "wikidata_id",
    ],
    "name",
    ["wikidata_id"],
    "date",
    ["name", "date", "image"],
  ),
  companies: META(
    "companies",
    "companies.csv",
    [
      "id",
      "name",
      "foundation_date",
      "country",
      "industry",
      "reference_url",
      "type",
      "headquarters",
      "founder",
      "parent",
      "logo",
      "wikidata_id",
    ],
    "name",
    ["wikidata_id"],
    "foundation_date",
    ["name", "foundation_date", "logo"],
  ),
  people: META(
    "people",
    "people.csv",
    [
      "id",
      "name",
      "date_of_birth",
      "nationality",
      "occupation",
      "image",
      "reference_url",
      "wikidata_id",
    ],
    "name",
    ["wikidata_id"],
    "date_of_birth",
    ["name", "date_of_birth", "image"],
  ),
  "basketball-clubs": META(
    "basketball-clubs",
    "basketball-clubs.csv",
    [
      "id",
      "name",
      "foundation_date",
      "country",
      "city",
      "reference_url",
      "logo",
      "wikidata_id",
    ],
    "name",
    ["wikidata_id"],
    "foundation_date",
    ["name", "foundation_date", "logo"],
  ),
  "football-clubs": META(
    "football-clubs",
    "football-clubs.csv",
    [
      "id",
      "name",
      "foundation_date",
      "country",
      "city",
      "reference_url",
      "crest",
      "wikidata_id",
    ],
    "name",
    ["wikidata_id"],
    "foundation_date",
    ["name", "foundation_date", "crest"],
  ),
};

export function getMeta(slug: string): DatasetMeta {
  const m = DATASET_META[slug];
  if (!m) {
    throw new Error(
      `Unknown dataset "${slug}". Known: ${Object.keys(DATASET_META).join(", ")}`,
    );
  }
  return m;
}

export interface ExpandArgs {
  keywords: string[]; // --keywords "a,b" (repeatable, comma-split)
  filters: string[]; // --filter "..." (repeatable; adapter-specific raw constraints)
  limit: number; // --limit N
  out?: string;
}

export function parseArgs(
  argv: string[],
  defaults: { limit?: number } = {},
): ExpandArgs {
  const a: ExpandArgs = {
    keywords: [],
    filters: [],
    limit: defaults.limit ?? 50,
  };
  for (let i = 0; i < argv.length; i++) {
    const t = argv[i];
    if (t === "--keywords" || t === "-k") a.keywords.push(...split(argv[++i]));
    else if (t === "--filter" || t === "-f") a.filters.push(argv[++i] ?? "");
    else if (t === "--limit" || t === "-n")
      a.limit = Number(argv[++i]) || a.limit;
    else if (t === "--out" || t === "-o") a.out = argv[++i];
  }
  return a;
}

function split(s: string | undefined): string[] {
  return (s ?? "")
    .split(",")
    .map((x) => x.trim())
    .filter(Boolean);
}

export function readDataset(file: string): { fields: string[]; rows: Row[] } {
  const text = fs.readFileSync(path.join(DATASETS_DIR, file), "utf8");
  const res = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  return { fields: res.meta.fields ?? [], rows: res.data };
}

function cell(v: string | undefined): string {
  return (v ?? "").replace(/[\r\n]+/g, " ").trim();
}

export function writeCsv(
  fullPath: string,
  columns: string[],
  rows: Row[],
): void {
  const out = Papa.unparse(
    { fields: columns, data: rows.map((r) => columns.map((c) => cell(r[c]))) },
    { newline: "\r\n" },
  );
  fs.mkdirSync(path.dirname(fullPath), { recursive: true });
  fs.writeFileSync(fullPath, out + "\r\n", "utf8");
}

export function writeTmp(
  meta: DatasetMeta,
  newRows: Row[],
  outOverride?: string,
): string {
  const dest = outOverride ?? path.join(TMP_DIR, `${meta.slug}.new.csv`);
  const stamped = newRows.map((r) => ({ ...r, id: "" }));
  writeCsv(dest, meta.columns, stamped);
  return dest;
}

export function normName(s: string | undefined): string {
  return (s ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "")
    .trim();
}

export function existingKeySets(
  rows: Row[],
  dedupKeys: string[],
): Record<string, Set<string>> {
  const sets: Record<string, Set<string>> = {};
  for (const k of dedupKeys) {
    sets[k] = new Set(rows.map((r) => (r[k] ?? "").trim()).filter(Boolean));
  }
  return sets;
}

export function isKnown(
  row: Row,
  sets: Record<string, Set<string>>,
  dedupKeys: string[],
): boolean {
  return dedupKeys.some((k) => {
    const v = (row[k] ?? "").trim();
    return v !== "" && sets[k].has(v);
  });
}

export function passesRequired(meta: DatasetMeta, row: Row): boolean {
  return meta.required.every((c) => (row[c] ?? "").trim() !== "");
}

export function filterNew(
  meta: DatasetMeta,
  existing: Row[],
  candidates: Row[],
  opts: { alsoName?: boolean } = {},
): { fresh: Row[]; droppedKnown: number; droppedRequired: number } {
  const sets = existingKeySets(existing, meta.dedupKeys);
  const seenNames = opts.alsoName
    ? new Set(existing.map((r) => normName(r[meta.titleField])))
    : null;
  const fresh: Row[] = [];
  let droppedKnown = 0;
  let droppedRequired = 0;
  for (const c of candidates) {
    if (isKnown(c, sets, meta.dedupKeys)) {
      droppedKnown++;
      continue;
    }
    if (seenNames) {
      const nk = normName(c[meta.titleField]);
      if (nk && seenNames.has(nk)) {
        droppedKnown++;
        continue;
      }
    }
    if (!passesRequired(meta, c)) {
      droppedRequired++;
      continue;
    }
    if (seenNames) seenNames.add(normName(c[meta.titleField]));
    fresh.push(c);
  }
  return { fresh, droppedKnown, droppedRequired };
}

export function formatSignedDate(
  p:
    | { year: number; month?: number | null; day?: number | null }
    | null
    | undefined,
): string {
  if (!p || !Number.isFinite(p.year)) return "";
  const sign = p.year < 0 ? "-" : "";
  const y = sign + String(Math.abs(p.year)).padStart(4, "0");
  if (p.month == null) return y;
  const m = String(p.month).padStart(2, "0");
  if (p.day == null) return `${y}-${m}`;
  return `${y}-${m}-${String(p.day).padStart(2, "0")}`;
}

export interface WikidataExpandOpts<P> {
  meta: DatasetMeta;
  args: ExpandArgs;
  discover: (args: ExpandArgs) => Promise<{ qid: string; label: string }[]>;
  fetchProps: (qids: string[]) => Promise<Map<string, P>>;
  mapRow: (
    qid: string,
    props: P,
    label: string,
  ) => Promise<Row | null> | Row | null;
}

export async function expandWikidata<P>(
  opts: WikidataExpandOpts<P>,
): Promise<string> {
  const { meta, args } = opts;
  const { rows: existing } = readDataset(meta.file);
  console.log(`Loaded ${existing.length} existing ${meta.slug} rows`);

  const seenQids = new Set(
    existing.map((r) => (r.wikidata_id ?? "").trim()).filter(Boolean),
  );

  const found = await opts.discover(args);
  const labelByQid = new Map(found.map((f) => [f.qid, f.label]));
  const freshQids = found.map((f) => f.qid).filter((q) => !seenQids.has(q));
  console.log(`Discovered ${found.length}; ${freshQids.length} new QIDs`);

  const props = await opts.fetchProps(freshQids);

  const mapped: Row[] = [];
  let i = 0;
  for (const qid of freshQids) {
    i++;
    const p = props.get(qid);
    if (!p) continue;
    const row = await opts.mapRow(qid, p, labelByQid.get(qid) ?? "");
    if (row) mapped.push(row);
    if (i % 50 === 0)
      console.log(
        `  processed ${i}/${freshQids.length} (kept ${mapped.length})`,
      );
  }

  const { fresh, droppedKnown, droppedRequired } = filterNew(
    meta,
    existing,
    mapped,
    {
      alsoName: true,
    },
  );
  console.log(
    `Mapped ${mapped.length}; kept ${fresh.length} (dropped ${droppedKnown} known, ${droppedRequired} incomplete)`,
  );

  const dest = writeTmp(meta, fresh, args.out);
  console.log(`\nWrote ${fresh.length} new rows → ${dest}`);
  console.log(`Review it, then: npm run merge -- ${meta.slug}`);
  return dest;
}
