/**
 * Grow movies.csv from IMDB (the dataset's original source).
 *
 * Movies are DISCOVERED from IMDB's
 * official public datasets and only ENRICHED via Wikidata/Wikipedia:
 *
 * Fetch them once from IMDB's public mirror, e.g.:
 *   curl -o /tmp/imdb-data/title.ratings.tsv.gz https://datasets.imdbws.com/title.ratings.tsv.gz
 *   curl -o /tmp/imdb-data/title.basics.tsv.gz  https://datasets.imdbws.com/title.basics.tsv.gz
 */

import * as fs from "fs";
import * as path from "path";
import * as zlib from "zlib";
import * as readline from "readline";
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
import {
  runSparql,
  valuesClause,
  commonsImageThumb,
  parseWikidataDate,
} from "../lib/wikidata";
import { pageImage, urlToTitle } from "../lib/wikipedia";

interface MovieProps {
  qid: string;
  publication?: string;
  image?: string;
  wiki?: string;
  directorLabel?: string;
  genreLabel?: string;
  countryLabel?: string;
  languageLabel?: string;
  composerLabel?: string;
  studioLabel?: string;
  durationValue?: string;
}

async function lookupQidsByImdbId(
  imdbIds: string[],
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (imdbIds.length === 0) return out;
  const CHUNK = 80;
  for (let i = 0; i < imdbIds.length; i += CHUNK) {
    const slice = imdbIds.slice(i, i + CHUNK);
    const values = slice.map((id) => `"${id}"`).join(" ");
    const query = `
SELECT ?item ?imdb WHERE {
  VALUES ?imdb { ${values} }
  ?item wdt:P345 ?imdb.
}`;
    const rows = await runSparql(query, "lookupQidsByImdbId");
    for (const b of rows) {
      const imdb = b.imdb?.value;
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (imdb && qid && !out.has(imdb)) out.set(imdb, qid);
    }
  }
  return out;
}

async function fetchMovieProps(
  qids: string[],
): Promise<Map<string, MovieProps>> {
  const out = new Map<string, MovieProps>();
  if (qids.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?publication ?image ?article ?duration
       ?director ?directorLabel
       ?genre ?genreLabel
       ?country ?countryLabel
       ?language ?languageLabel
       ?composer ?composerLabel
       ?studio ?studioLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P577 ?publication. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P2047 ?duration. }
  OPTIONAL { ?item wdt:P57 ?director. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  OPTIONAL { ?item wdt:P495 ?country. }
  OPTIONAL { ?item wdt:P364 ?language. }
  OPTIONAL { ?item wdt:P86 ?composer. }
  OPTIONAL { ?item wdt:P272 ?studio. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchMovieProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const pubDates = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.image = prev.image ?? b.image?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.durationValue = prev.durationValue ?? b.duration?.value;
      out.set(qid, prev);
      const pub = b.publication?.value;
      if (pub) {
        if (!pubDates.has(qid)) pubDates.set(qid, new Set());
        pubDates.get(qid)!.add(pub);
      }
      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of [
        "director",
        "genre",
        "country",
        "language",
        "composer",
        "studio",
      ]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("director"))
        p.directorLabel = Array.from(per.get("director")!).join(" · ");
      if (per.has("genre"))
        p.genreLabel = Array.from(per.get("genre")!).join(" · ");
      if (per.has("country"))
        p.countryLabel = Array.from(per.get("country")!).join(" · ");
      if (per.has("language"))
        p.languageLabel = Array.from(per.get("language")!).join(" · ");
      if (per.has("composer"))
        p.composerLabel = Array.from(per.get("composer")!).join(" · ");
      if (per.has("studio"))
        p.studioLabel = Array.from(per.get("studio")!).join(" · ");
    }
    for (const [qid, set] of pubDates) {
      const p = out.get(qid)!;
      p.publication = Array.from(set).sort()[0];
    }
  }
  return out;
}

const meta = getMeta("movies");

const DEFAULT_VOTE_THRESHOLD = 25000;
const IMDB_DUMP_DIR = process.env.IMDB_DUMP_DIR || "/tmp/imdb-data";

function resolveDump(baseName: string): string {
  const gz = path.join(IMDB_DUMP_DIR, `${baseName}.gz`);
  const plain = path.join(IMDB_DUMP_DIR, baseName);
  if (fs.existsSync(gz)) return gz;
  if (fs.existsSync(plain)) return plain;
  throw new Error(
    `IMDB dump not found: expected ${gz} or ${plain}. ` +
      `Download it from https://datasets.imdbws.com/${baseName}.gz ` +
      `(set IMDB_DUMP_DIR to override the directory).`,
  );
}

function lineReader(file: string): readline.Interface {
  const raw = fs.createReadStream(file);
  const input = file.endsWith(".gz") ? raw.pipe(zlib.createGunzip()) : raw;
  return readline.createInterface({ input });
}

interface Rating {
  rating: number;
  votes: number;
}

async function loadRatings(minVotes: number): Promise<Map<string, Rating>> {
  const out = new Map<string, Rating>();
  const rl = lineReader(resolveDump("title.ratings.tsv"));
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const [tconst, rating, votes] = line.split("\t");
    const v = parseInt(votes, 10);
    if (!Number.isFinite(v) || v < minVotes) continue;
    out.set(tconst, { rating: parseFloat(rating), votes: v });
  }
  return out;
}

interface Basic {
  tconst: string;
  title: string;
  year: number;
  runtime: number;
  genres: string;
}

async function loadBasicsFor(ids: Set<string>): Promise<Map<string, Basic>> {
  const out = new Map<string, Basic>();
  const rl = lineReader(resolveDump("title.basics.tsv"));
  let first = true;
  for await (const line of rl) {
    if (first) {
      first = false;
      continue;
    }
    const parts = line.split("\t");
    const tconst = parts[0];
    if (!ids.has(tconst)) continue;
    if (parts[1] !== "movie") continue; // feature movies only
    const title = parts[2];
    const year = parseInt(parts[5], 10);
    const runtime = parseInt(parts[7], 10);
    const genres = parts[8] === "\\N" ? "" : parts[8].replace(/,/g, "; ");
    if (!Number.isFinite(year)) continue;
    out.set(tconst, {
      tconst,
      title,
      year,
      runtime: Number.isFinite(runtime) ? runtime : 0,
      genres,
    });
  }
  return out;
}

interface RawFilters {
  minVotes: number;
  minYear?: number;
  maxYear?: number;
}

function parseRawFilters(filters: string[]): RawFilters {
  const out: RawFilters = { minVotes: DEFAULT_VOTE_THRESHOLD };
  for (const f of filters) {
    const [rawKey, rawVal] = f.split("=");
    const key = (rawKey ?? "").trim();
    const num = Number((rawVal ?? "").trim());
    if (!Number.isFinite(num)) continue;
    if (key === "minVotes") out.minVotes = num;
    else if (key === "minYear") out.minYear = num;
    else if (key === "maxYear") out.maxYear = num;
  }
  return out;
}

function matchesKeywords(b: Basic, keywords: string[]): boolean {
  if (keywords.length === 0) return true;
  const hay = `${b.title} ${b.genres}`.toLowerCase();
  return keywords.some((k) => hay.includes(k.toLowerCase()));
}

function firstNonGeneric(multi: string | undefined): string {
  if (!multi) return "";
  return (
    multi
      .split(" · ")
      .map((s) => s.trim())
      .filter(Boolean)[0] ?? ""
  );
}

function joinTop(multi: string | undefined, max = 2): string {
  if (!multi) return "";
  return multi
    .split(" · ")
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max)
    .join("; ");
}

async function pickPoster(p: MovieProps): Promise<string> {
  if (p.wiki) {
    const t = urlToTitle(p.wiki);
    if (t) {
      const img = await pageImage(t);
      if (img) return img;
    }
  }
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 500);
    if (thumb) return thumb;
  }
  return "";
}

function pickReleaseDate(
  pub: string | undefined,
  fallbackYear: number,
): string {
  const wd = formatSignedDate(parseWikidataDate(pub));
  if (wd) return wd;
  return formatSignedDate({ year: fallbackYear });
}

async function discover(args: ExpandArgs): Promise<Row[]> {
  const raw = parseRawFilters(args.filters);

  console.log(
    `Loading IMDB ratings (>= ${raw.minVotes} votes) from ${IMDB_DUMP_DIR}…`,
  );
  const ratings = await loadRatings(raw.minVotes);
  console.log(`  ${ratings.size} titles qualify by vote count`);

  console.log("Loading IMDB basics for those titles (movies only)…");
  let basics = Array.from(
    (await loadBasicsFor(new Set(ratings.keys()))).values(),
  );
  console.log(`  ${basics.length} feature movies in candidate set`);

  basics = basics.filter((b) => {
    if (raw.minYear != null && b.year < raw.minYear) return false;
    if (raw.maxYear != null && b.year > raw.maxYear) return false;
    return matchesKeywords(b, args.keywords);
  });
  console.log(`  ${basics.length} after year/keyword filters`);
  if (basics.length === 0) return [];

  let totalRating = 0;
  for (const b of basics) totalRating += ratings.get(b.tconst)!.rating;
  const C = totalRating / basics.length;
  const m = raw.minVotes;

  const scored = basics
    .map((b) => {
      const r = ratings.get(b.tconst)!;
      const bayes =
        (r.votes / (r.votes + m)) * r.rating + (m / (r.votes + m)) * C;
      return { ...b, rating: r.rating, votes: r.votes, bayes };
    })
    .sort((a, b) => b.bayes - a.bayes);

  const top = scored.slice(0, args.limit);
  console.log(`Top ${top.length} candidates by Bayesian rank`);

  console.log("Resolving Wikidata QIDs by IMDB id…");
  const qidMap = await lookupQidsByImdbId(top.map((b) => b.tconst));
  console.log(`  resolved ${qidMap.size}/${top.length} QIDs`);

  const qids = Array.from(new Set(qidMap.values()));
  console.log(`Fetching Wikidata props for ${qids.length} movies…`);
  const propsMap = await fetchMovieProps(qids);
  console.log(`  got props for ${propsMap.size}`);

  const rows: Row[] = [];
  let idx = 0;
  for (const b of top) {
    idx += 1;
    const qid = qidMap.get(b.tconst) ?? "";
    const p = qid ? propsMap.get(qid) : undefined;
    const poster = p ? await pickPoster(p) : "";
    rows.push({
      title: b.title,
      release_date: pickReleaseDate(p?.publication, b.year),
      director: joinTop(p?.directorLabel, 2),
      reference_url: p?.wiki ?? `https://www.imdb.com/title/${b.tconst}/`,
      runtime_minutes: b.runtime ? String(b.runtime) : (p?.durationValue ?? ""),
      genre: joinTop(p?.genreLabel || b.genres, 3),
      studio: joinTop(p?.studioLabel, 2),
      country: firstNonGeneric(p?.countryLabel),
      language: firstNonGeneric(p?.languageLabel),
      imdb_rating: b.rating.toFixed(1),
      imdb_votes: String(b.votes),
      poster,
      imdb_id: b.tconst,
      wikidata_id: qid,
    });
    if (idx % 25 === 0) console.log(`  enriched ${idx}/${top.length}`);
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
    {
      alsoName: true,
    },
  );
  const dest = writeTmp(meta, fresh, args.out);
  console.log(
    `Wrote ${fresh.length} new rows → ${dest} ` +
      `(dropped ${droppedKnown} known, ${droppedRequired} incomplete). ` +
      `Then: npm run merge -- movies`,
  );
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
