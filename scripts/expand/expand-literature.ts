/**
 * Grow literature.csv via Wikidata.
 *
 *   npm run expand:literature -- --keywords "dickens" --limit 200 --filter "?item wdt:P50 wd:Q5686 ."
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

interface LiteratureProps {
  qid: string;
  publication?: string;
  inception?: string;
  image?: string;
  wiki?: string;
  instanceLabels?: string[];
  authorLabel?: string;
  genreLabel?: string;
  languageLabel?: string;
  countryLabel?: string;
  characterLabel?: string;
  seriesLabel?: string;
  seriesQid?: string;
}

async function fetchLiteratureProps(
  qids: string[],
): Promise<Map<string, LiteratureProps>> {
  const out = new Map<string, LiteratureProps>();
  if (qids.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?publication ?inception ?image ?article
       ?instance ?instanceLabel
       ?author ?authorLabel
       ?genre ?genreLabel
       ?language ?languageLabel
       ?country ?countryLabel
       ?series ?seriesLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P577 ?publication. }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P50 ?author. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  OPTIONAL { ?item wdt:P407 ?language. }
  OPTIONAL { ?item wdt:P495 ?country. }
  OPTIONAL { ?item wdt:P179 ?series. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchLiteratureProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const instSets = new Map<string, Set<string>>();
    const pubDates = new Map<string, Set<string>>();
    const incDates = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.image = prev.image ?? b.image?.value;
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
      const pub = b.publication?.value;
      if (pub) {
        if (!pubDates.has(qid)) pubDates.set(qid, new Set());
        pubDates.get(qid)!.add(pub);
      }
      const inc = b.inception?.value;
      if (inc) {
        if (!incDates.has(qid)) incDates.set(qid, new Set());
        incDates.get(qid)!.add(inc);
      }
      const inst = b.instanceLabel?.value?.trim();
      if (inst && !/^Q\d+$/.test(inst)) {
        if (!instSets.has(qid)) instSets.set(qid, new Set());
        instSets.get(qid)!.add(inst);
      }
      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of ["author", "genre", "language", "country"]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("author"))
        p.authorLabel = Array.from(per.get("author")!).join(" · ");
      if (per.has("genre"))
        p.genreLabel = Array.from(per.get("genre")!).join(" · ");
      if (per.has("language"))
        p.languageLabel = Array.from(per.get("language")!).join(" · ");
      if (per.has("country"))
        p.countryLabel = Array.from(per.get("country")!).join(" · ");
    }
    for (const [qid, set] of pubDates) {
      out.get(qid)!.publication = Array.from(set).sort()[0];
    }
    for (const [qid, set] of incDates) {
      out.get(qid)!.inception = Array.from(set).sort()[0];
    }
    for (const [qid, set] of instSets) {
      out.get(qid)!.instanceLabels = Array.from(set);
    }
  }
  return out;
}

const meta = getMeta("literature");

const WORK_CLASSES = [
  "Q7725634", // literary work
  "Q8261", // novel
  "Q5185279", // poem
  "Q35760", // epic poem
  "Q25379", // play
  "Q49084", // short story
  "Q149537", // novella
  "Q47461344", // written work
  "Q1279564", // short story collection
  "Q12106333", // play (theatre)
];

const REJECT_TYPE =
  /\b(scientific article|scholarly article|journal article|academic journal|review article|thesis|dissertation|encycloped(ia|aedia)|dictionary|textbook|user manual|catalogue|database|periodical|magazine|newspaper)\b/i;

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 15 : 30;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const kwFilter = args.keywords.length
    ? `  FILTER(${args.keywords
        .map((k) => `CONTAINS(LCASE(?itemLabel), "${escapeKw(k)}")`)
        .join(" || ")})`
    : "";
  const extra = args.filters.filter(Boolean).join("\n");
  const min = minSitelinks(args.limit);
  const out = new Map<string, { qid: string; label: string; n: number }>();
  for (const cls of WORK_CLASSES) {
    const query = `
SELECT ?item ?itemLabel (COUNT(DISTINCT ?sl) AS ?n) WHERE {
  ?item wdt:P31 wd:${cls} ;
        wdt:P50 [] .
  ?enwiki schema:about ?item ; schema:isPartOf <https://en.wikipedia.org/> .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${min})
ORDER BY DESC(?n)
LIMIT ${Math.min(600, args.limit)}`;
    try {
      const rows = await runSparql(query, `discover-literature-${cls}`);
      let added = 0;
      for (const b of rows) {
        const qid = (b.item?.value ?? "").replace(
          "http://www.wikidata.org/entity/",
          "",
        );
        const label = b.itemLabel?.value ?? "";
        const n = Number(b.n?.value ?? 0);
        if (!/^Q\d+$/.test(qid) || !label) continue;
        const prev = out.get(qid);
        if (!prev || n > prev.n) out.set(qid, { qid, label, n });
        added += 1;
      }
      console.log(`  class ${cls}: +${added} (pool ${out.size})`);
    } catch (e) {
      console.warn(`  class ${cls}: skipped (${(e as Error).message})`);
    }
  }
  return Array.from(out.values())
    .sort((a, b) => b.n - a.n)
    .slice(0, args.limit)
    .map(({ qid, label }) => ({ qid, label }));
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

function authorsOf(multi: string | undefined, max = 2): string {
  if (!multi) return "";
  return multi
    .split(" · ")
    .map((s) => s.trim())
    .filter(
      (s) => s && !/^https?:\/\//i.test(s) && !/\.well-known\/genid\//i.test(s),
    )
    .slice(0, max)
    .join("; ");
}

function pickType(instances: string[] | undefined): string {
  if (!instances || instances.length === 0) return "Literary work";
  const generic = /^(literary work|written work|work|creative work|text)$/i;
  const specific = instances.find((i) => !generic.test(i));
  const v = specific ?? instances[0];
  return v.charAt(0).toUpperCase() + v.slice(1);
}

async function pickCover(p: LiteratureProps): Promise<string> {
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
  p: LiteratureProps,
  label: string,
): Promise<Row | null> {
  const title = label.trim();
  if (!title || /^Q\d+$/.test(title)) return null;
  const type = pickType(p.instanceLabels);
  if (REJECT_TYPE.test(type)) return null;
  const release_date = formatSignedDate(
    parseWikidataDate(p.publication ?? p.inception),
  );
  if (!release_date) return null;
  const cover = await pickCover(p);
  if (!cover) return null;
  return {
    title,
    publish_date: release_date,
    author: authorsOf(p.authorLabel, 2),
    reference_url: p.wiki ?? "",
    country: firstNonGeneric(p.countryLabel),
    type,
    genre: firstNonGeneric(p.genreLabel),
    language: firstNonGeneric(p.languageLabel),
    series: firstNonGeneric(p.seriesLabel),
    cover,
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchLiteratureProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
