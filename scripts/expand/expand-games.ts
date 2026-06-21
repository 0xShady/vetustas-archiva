/**
 * Grow games.csv via Wikidata.
 *
 *   npm run expand:games -- --keywords "zelda,mario" --limit 200 --filter "?item wdt:P400 wd:Q186437 ."
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

interface GameProps {
  qid: string;
  publication?: string;
  image?: string;
  images?: string[];
  wiki?: string;
  seriesQid?: string;
  seriesLabel?: string;
  genreLabel?: string;
  developerLabel?: string;
  publisherLabel?: string;
  platformLabel?: string;
}

async function fetchGameProps(qids: string[]): Promise<Map<string, GameProps>> {
  const out = new Map<string, GameProps>();
  if (qids.length === 0) return out;

  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?publication ?image ?article
       ?series ?seriesLabel
       ?genre ?genreLabel
       ?developer ?developerLabel
       ?publisher ?publisherLabel
       ?platform ?platformLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P577 ?publication. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P179 ?series. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  OPTIONAL { ?item wdt:P178 ?developer. }
  OPTIONAL { ?item wdt:P123 ?publisher. }
  OPTIONAL { ?item wdt:P400 ?platform. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchGameProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const imgSets = new Map<string, Set<string>>();
    const pubDates = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.wiki = prev.wiki ?? b.article?.value;
      const seriesUri = b.series?.value;
      if (seriesUri && !prev.seriesQid) {
        prev.seriesQid = seriesUri.replace(
          "http://www.wikidata.org/entity/",
          "",
        );
      }
      if (b.seriesLabel?.value && !prev.seriesLabel)
        prev.seriesLabel = b.seriesLabel.value;
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
      for (const alias of ["genre", "developer", "publisher", "platform"]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("genre"))
        p.genreLabel = Array.from(per.get("genre")!).join(" · ");
      if (per.has("developer"))
        p.developerLabel = Array.from(per.get("developer")!).join(" · ");
      if (per.has("publisher"))
        p.publisherLabel = Array.from(per.get("publisher")!).join(" · ");
      if (per.has("platform"))
        p.platformLabel = Array.from(per.get("platform")!).join(" · ");
    }
    for (const [qid, set] of imgSets) {
      const p = out.get(qid)!;
      p.images = Array.from(set);
      p.image = p.images[0];
    }
    for (const [qid, set] of pubDates) {
      const p = out.get(qid)!;
      const sorted = Array.from(set).sort();
      p.publication = sorted[0];
    }
  }
  return out;
}

const meta = getMeta("games");

const GAME_CLASSES = [
  "Q7889", // video game
  "Q865493", // massively multiplayer online game
  "Q4393107", // video game franchise
  "Q61475894", // video game project
];

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 15 : 30;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const values = GAME_CLASSES.map((q) => `wd:${q}`).join(" ");
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
  const rows = await runSparql(query, "discover-games");
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

async function pickPoster(p: GameProps): Promise<string> {
  if (p.wiki) {
    const t = urlToTitle(p.wiki);
    if (t) {
      const img = await pageImage(t);
      if (img) return img;
    }
  }
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 600);
    if (thumb) return thumb;
  }
  return "";
}

async function mapRow(
  qid: string,
  p: GameProps,
  label: string,
): Promise<Row | null> {
  const title = label.trim();
  if (!title || /^Q\d+$/.test(title)) return null;
  const release_date = formatSignedDate(parseWikidataDate(p.publication));
  if (!release_date) return null;
  const poster = await pickPoster(p);
  if (!poster) return null;
  return {
    title,
    release_date,
    reference_url: p.wiki ?? "",
    genre: joinTop(p.genreLabel, 2),
    poster,
    developer: joinTop(p.developerLabel, 2),
    publisher: joinTop(p.publisherLabel, 2),
    series: firstNonGeneric(p.seriesLabel),
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchGameProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
