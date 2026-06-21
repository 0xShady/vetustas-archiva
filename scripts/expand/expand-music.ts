/**
 * Grow music.csv via Wikidata.
 *
 *   npm run expand:music -- --keywords "jazz,blue note" --limit 200 --filter "?item wdt:P175 wd:Q23215 ."
 *
 *   --keywords  narrows discovery: each keyword adds a
 *               FILTER(CONTAINS(LCASE(?itemLabel), "<kw>")) (OR-combined).
 *   --limit     SPARQL result cap (default 50). Also lowers the sitelink floor
 *               for small runs so a tiny limit still finds candidates.
 *   --filter    raw extra SPARQL line(s) appended verbatim into the WHERE block
 *               (e.g. an extra wdt:Pxx constraint). Repeatable.
 */

import {
  getMeta,
  parseArgs,
  expandWikidata,
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

interface MusicProps {
  qid: string;
  publication?: string;
  image?: string;
  images?: string[];
  wiki?: string;
  performerLabel?: string;
  genreLabel?: string;
  labelLabel?: string;
  producerLabel?: string;
  tracks?: string;
  durationSeconds?: string;
  musicbrainzId?: string;
  spotifyId?: string;
}

function cleanTracks(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n <= 0 || n > 500) return undefined;
  return String(n);
}

function cleanDuration(raw: string | undefined): string | undefined {
  if (!raw) return undefined;
  const n = Math.round(Number(raw));
  if (!Number.isFinite(n) || n < 30 || n > 86400) return undefined;
  return String(n);
}

async function fetchMusicProps(
  qids: string[],
): Promise<Map<string, MusicProps>> {
  const out = new Map<string, MusicProps>();
  if (qids.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?publication ?image ?article ?tracks ?duration ?mbid ?spotify
       ?performer ?performerLabel
       ?genre ?genreLabel
       ?label ?labelLabel
       ?producer ?producerLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P577 ?publication. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P2635 ?tracks. }
  OPTIONAL { ?item wdt:P2047 ?duration. }
  OPTIONAL { ?item wdt:P436 ?mbid. }
  OPTIONAL { ?item wdt:P2205 ?spotify. }
  OPTIONAL { ?item wdt:P175 ?performer. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  OPTIONAL { ?item wdt:P264 ?label. }
  OPTIONAL { ?item wdt:P162 ?producer. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchMusicProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const pubDates = new Map<string, Set<string>>();
    const imgSets = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.tracks = prev.tracks ?? cleanTracks(b.tracks?.value);
      prev.durationSeconds =
        prev.durationSeconds ?? cleanDuration(b.duration?.value);
      prev.musicbrainzId = prev.musicbrainzId ?? b.mbid?.value?.trim();
      prev.spotifyId = prev.spotifyId ?? b.spotify?.value?.trim();
      out.set(qid, prev);
      const img = b.image?.value;
      if (img) {
        if (!imgSets.has(qid)) imgSets.set(qid, new Set());
        imgSets.get(qid)!.add(img);
      }
      const pub = b.publication?.value;
      if (pub) {
        if (!pubDates.has(qid)) pubDates.set(qid, new Set());
        pubDates.get(qid)!.add(pub);
      }
      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of ["performer", "genre", "label", "producer"]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("performer"))
        p.performerLabel = Array.from(per.get("performer")!).join(" · ");
      if (per.has("genre"))
        p.genreLabel = Array.from(per.get("genre")!).join(" · ");
      if (per.has("label"))
        p.labelLabel = Array.from(per.get("label")!).join(" · ");
      if (per.has("producer"))
        p.producerLabel = Array.from(per.get("producer")!).join(" · ");
    }
    for (const [qid, set] of imgSets) {
      const p = out.get(qid)!;
      p.images = Array.from(set);
      p.image = p.images[0];
    }
    for (const [qid, set] of pubDates) {
      const p = out.get(qid)!;
      p.publication = Array.from(set).sort()[0];
    }
  }
  return out;
}

const meta = getMeta("music");

const MUSIC_CLASSES = [
  "Q482994", // album
  "Q208569", // studio album
  "Q222910", // live album
  "Q209939", // compilation album
  "Q169930", // extended play (EP)
  "Q4132319", // soundtrack album
  "Q134556", // single
  "Q2188189", // musical work/composition
];

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 12 : 25;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const values = MUSIC_CLASSES.map((q) => `wd:${q}`).join(" ");
  const kwFilter = args.keywords.length
    ? `  FILTER(${args.keywords
        .map((k) => `CONTAINS(LCASE(?itemLabel), "${escapeKw(k)}")`)
        .join(" || ")})`
    : "";
  const extra = args.filters.filter(Boolean).join("\n");
  const query = `
SELECT ?item ?itemLabel (COUNT(DISTINCT ?sl) AS ?n) WHERE {
  VALUES ?cls { ${values} }
  ?item wdt:P31 ?cls ;
        wdt:P577 [] .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${minSitelinks(args.limit)})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-music");
  return rows
    .map((b) => ({
      qid: (b.item?.value ?? "").replace("http://www.wikidata.org/entity/", ""),
      label: b.itemLabel?.value ?? "",
    }))
    .filter((r) => /^Q\d+$/.test(r.qid) && r.label);
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

async function pickCover(p: MusicProps): Promise<string> {
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

async function mapRow(
  qid: string,
  p: MusicProps,
  label: string,
): Promise<Row | null> {
  const title = label.trim();
  if (!title || /^Q\d+$/.test(title)) return null;
  const release_date = formatSignedDate(parseWikidataDate(p.publication));
  if (!release_date) return null;
  const cover = await pickCover(p);
  if (!cover) return null;
  return {
    title,
    release_date,
    artist: firstNonGeneric(p.performerLabel),
    reference_url: p.wiki ?? "",
    genre: joinTop(p.genreLabel, 2),
    label: joinTop(p.labelLabel, 1),
    tracks: p.tracks ?? "",
    duration_seconds: p.durationSeconds ?? "",
    cover,
    wikidata_id: qid,
    musicbrainz_id: p.musicbrainzId ?? "",
    spotify_id: p.spotifyId ?? "",
    spotify_popularity: "",
    lastfm_listeners: "",
    lastfm_playcount: "",
    riaa_certification: "",
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchMusicProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
