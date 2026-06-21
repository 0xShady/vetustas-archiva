/**
 * Grow inventions.csv via Wikidata.
 *
 *   npm run expand:inventions -- --keywords "engine,telescope" --limit 200 --filter "?item wdt:P495 wd:Q148 ."
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

interface InventionProps {
  qid: string;
  invented?: string;
  inception?: string;
  image?: string;
  wiki?: string;
  instanceLabels?: string[];
  inventorLabel?: string;
  countryLabel?: string;
  manufacturerLabel?: string;
}

async function fetchInventionProps(
  qids: string[],
): Promise<Map<string, InventionProps>> {
  const out = new Map<string, InventionProps>();
  if (qids.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?invented ?inception ?image ?article
       ?instance ?instanceLabel
       ?inventor ?inventorLabel
       ?country ?countryLabel
       ?manufacturer ?manufacturerLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P575 ?invented. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P61 ?inventor. }
  OPTIONAL { ?item wdt:P495 ?country. }
  OPTIONAL { ?item wdt:P176 ?manufacturer. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchInventionProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const instSets = new Map<string, Set<string>>();
    const inventedDates = new Map<string, Set<string>>();
    const inceptionDates = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.image = prev.image ?? b.image?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      out.set(qid, prev);
      if (b.invented?.value) {
        if (!inventedDates.has(qid)) inventedDates.set(qid, new Set());
        inventedDates.get(qid)!.add(b.invented.value);
      }
      if (b.inception?.value) {
        if (!inceptionDates.has(qid)) inceptionDates.set(qid, new Set());
        inceptionDates.get(qid)!.add(b.inception.value);
      }
      const inst = b.instanceLabel?.value?.trim();
      if (inst && !/^Q\d+$/.test(inst)) {
        if (!instSets.has(qid)) instSets.set(qid, new Set());
        instSets.get(qid)!.add(inst);
      }
      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of ["inventor", "country", "manufacturer"]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("inventor"))
        p.inventorLabel = Array.from(per.get("inventor")!).join(" · ");
      if (per.has("country"))
        p.countryLabel = Array.from(per.get("country")!).join(" · ");
      if (per.has("manufacturer"))
        p.manufacturerLabel = Array.from(per.get("manufacturer")!).join(" · ");
    }
    for (const [qid, set] of inventedDates) {
      out.get(qid)!.invented = Array.from(set).sort()[0];
    }
    for (const [qid, set] of inceptionDates) {
      out.get(qid)!.inception = Array.from(set).sort()[0];
    }
    for (const [qid, set] of instSets) {
      out.get(qid)!.instanceLabels = Array.from(set);
    }
  }
  return out;
}

const meta = getMeta("inventions");

const INVENTION_CLASSES = [
  "Q12772819", // invention
  "Q11019", // machine
  "Q2424752", // product
  "Q11023", // engine
  "Q39546", // tool
  "Q1183543", // device
  "Q15401930", // technology
  "Q2425052", // technique / method
  "Q11028", // information
  "Q205663", // process
  "Q12136", // disease
  "Q3563237", // chemical process
  "Q188460", // weapon
  "Q3966", // computer hardware
  "Q22811462", // scientific theory
  "Q17737", // theory
  "Q1347367", // capability / discovery-shaped
];

const REJECT_TYPE =
  /\b(disease|disorder|syndrome|species|taxon|chemical compound|chemical element|mineral|food|dish|drink|cocktail|sport|game variant|chess opening|supernova|galaxy|star|constellation|fictional|brand|trademark|company|organization|trade name|profession|occupation|currency|unit of measurement)\b/i;

function isRejected(type: string): boolean {
  return REJECT_TYPE.test(type);
}

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 20 : 40;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const values = INVENTION_CLASSES.map((q) => `wd:${q}`).join(" ");
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
  { ?item wdt:P571 [] } UNION { ?item wdt:P575 [] }
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${minSitelinks(args.limit)})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-inventions");
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

function pickType(instances: string[] | undefined): string {
  if (!instances || instances.length === 0) return "";
  const generic = /^(invention|technology|product|device|entity|object)$/i;
  const specific = instances.find((i) => !generic.test(i) && !/^Q\d+$/.test(i));
  const v = specific ?? instances[0];
  if (!v || /^Q\d+$/.test(v)) return "";
  return v.charAt(0).toUpperCase() + v.slice(1);
}

async function pickImage(p: InventionProps): Promise<string> {
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 500);
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
  p: InventionProps,
  label: string,
): Promise<Row | null> {
  const name = label.trim();
  if (!name || /^Q\d+$/.test(name)) return null;
  const type = pickType(p.instanceLabels);
  if (isRejected(type)) return null;
  const date =
    formatSignedDate(parseWikidataDate(p.inception)) ||
    formatSignedDate(parseWikidataDate(p.invented));
  if (!date) return null;
  const image = await pickImage(p);
  if (!image) return null;
  return {
    name,
    date,
    reference_url: p.wiki ?? "",
    country: firstNonGeneric(p.countryLabel),
    inventor: joinTop(p.inventorLabel, 2),
    type,
    category: "",
    image,
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchInventionProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
