/**
 * Grow events.csv via Wikidata.
 *
 *   npm run expand:events -- --keywords "siege,napoleon" --limit 200 --filter "?item wdt:P17 wd:Q142 ."
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

interface EventProps {
  qid: string;
  date?: string;
  startDate?: string;
  endDate?: string;
  inception?: string;
  image?: string;
  wiki?: string;
  instanceLabel?: string;
  instanceQid?: string;
  countryLabel?: string;
  locationLabel?: string;
}

async function fetchEventProps(
  qids: string[],
): Promise<Map<string, EventProps>> {
  const out = new Map<string, EventProps>();
  if (qids.length === 0) return out;

  const CHUNK = 40;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?date ?startDate ?endDate ?inception ?image ?article
       ?instance ?instanceLabel ?country ?countryLabel ?location ?locationLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P585 ?date. }
  OPTIONAL { ?item wdt:P580 ?startDate. }
  OPTIONAL { ?item wdt:P582 ?endDate. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P276 ?location. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchEventProps");
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.date = prev.date ?? b.date?.value;
      prev.startDate = prev.startDate ?? b.startDate?.value;
      prev.endDate = prev.endDate ?? b.endDate?.value;
      prev.inception = prev.inception ?? b.inception?.value;
      prev.image = prev.image ?? b.image?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.instanceQid =
        prev.instanceQid ??
        b.instance?.value?.replace("http://www.wikidata.org/entity/", "");
      prev.instanceLabel = prev.instanceLabel ?? b.instanceLabel?.value;
      prev.countryLabel = prev.countryLabel ?? b.countryLabel?.value;
      prev.locationLabel = prev.locationLabel ?? b.locationLabel?.value;
      out.set(qid, prev);
    }
  }
  return out;
}

const meta = getMeta("events");

const EVENT_CLASSES = [
  "Q178561", // battle
  "Q198", // war
  "Q188055", // siege
  "Q10931", // revolution
  "Q3001412", // armed conflict
  "Q180684", // conflict
  "Q1656682", // event
  "Q1190554", // occurrence
  "Q625298", // peace treaty
  "Q131569", // treaty
  "Q45382", // expulsion
  "Q3199915", // massacre
  "Q124734", // riot
  "Q175331", // demonstration
  "Q49776", // coup d'état
  "Q7283", // terrorism / terrorist attack
  "Q8065", // natural disaster
  "Q3839081", // disaster
  "Q7944", // human-made disaster
  "Q3826001", // assassination
  "Q124757", // rebellion
  "Q10210674", // social movement / movement
  "Q189760", // voyage / expedition
  "Q40231", // election
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
  const values = EVENT_CLASSES.map((q) => `wd:${q}`).join(" ");
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
        wdt:P18 [] .
  { ?item wdt:P585 [] } UNION { ?item wdt:P580 [] } UNION { ?item wdt:P571 [] }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${minSitelinks(args.limit)})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-events");
  return rows
    .map((b) => ({
      qid: (b.item?.value ?? "").replace("http://www.wikidata.org/entity/", ""),
      label: b.itemLabel?.value ?? "",
    }))
    .filter((r) => /^Q\d+$/.test(r.qid) && r.label);
}

const MONTH =
  "(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)";

function cleanTitle(raw: string): string {
  let t = raw.trim();
  t = t.replace(new RegExp(`^\\d{1,2}\\s+${MONTH}\\s+\\d{4}\\s+`, "i"), "");
  t = t.replace(new RegExp(`^${MONTH}\\s+\\d{4}\\s+`, "i"), "");
  t = t.replace(/^\d{4}(?:[–-]\d{2,4})?\s+/, "");
  t = t.replace(/^(?:Early|Mid|Late)\s+\d{4}s\s+/i, "");
  t = t.replace(/^\d{4}s\s+/, "");
  t = t.replace(/\s*\(\d{4}(?:[–-]\d{2,4})?\)\s*$/, "");
  return t.trim();
}

function eraForYear(year: number): string {
  if (year < 500) return "antiquity";
  if (year < 1500) return "medieval";
  if (year < 1900) return "modern";
  return "contemporary";
}

function yearOf(signed: string): number {
  const m = signed.match(/^(-?)(\d+)/);
  if (!m) return 0;
  return (m[1] === "-" ? -1 : 1) * parseInt(m[2], 10);
}

function pickType(p: EventProps): string {
  const generic =
    /^(human|person|individual|historical event|event|occurrence|aspect of history|recurrent event)$/i;
  const inst = p.instanceLabel?.trim() ?? "";
  if (!inst || generic.test(inst) || /^Q\d+$/.test(inst)) return "";
  return inst.charAt(0).toUpperCase() + inst.slice(1);
}

function cleanLabel(v: string | undefined): string {
  const s = (v ?? "").trim();
  if (!s || /^Q\d+$/.test(s)) return "";
  return s;
}

async function pickImage(p: EventProps): Promise<string> {
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 600);
    if (thumb) return thumb;
  }
  if (p.wiki) {
    const t = urlToTitle(p.wiki);
    if (t) {
      const img = await pageImage(t);
      if (img) return img;
    }
  }
  return "";
}

async function mapRow(
  qid: string,
  p: EventProps,
  label: string,
): Promise<Row | null> {
  const title = cleanTitle(label.trim());
  if (!title || /^Q\d+$/.test(title)) return null;
  const date =
    formatSignedDate(parseWikidataDate(p.date)) ||
    formatSignedDate(parseWikidataDate(p.startDate)) ||
    formatSignedDate(parseWikidataDate(p.inception));
  if (!date) return null;
  const image = await pickImage(p);
  if (!image) return null;
  const endDate = formatSignedDate(parseWikidataDate(p.endDate));
  const country = cleanLabel(p.countryLabel);
  let location = cleanLabel(p.locationLabel);
  if (location && location === country) location = "";
  return {
    title,
    start_date: date,
    end_date: endDate,
    type: pickType(p),
    country,
    location,
    image,
    reference_url: p.wiki ?? "",
    wikidata_id: qid,
    era: eraForYear(yearOf(date)),
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchEventProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
