/**
 * Grow companies.csv via Wikidata.
 *
 *   npm run expand:companies -- --keywords "airline" --limit 200
 *   npm run expand:companies -- --filter "?item wdt:P452 wd:Q11661 ."  # IT industry
 *
 *   --keywords  narrows discovery: each keyword adds a
 *               FILTER(CONTAINS(LCASE(?itemLabel), "<kw>")) (OR-combined).
 *   --limit     SPARQL result cap (default 50). Also lowers the sitelink floor
 *               for small runs so a tiny limit still finds candidates.
 *   --filter    raw extra SPARQL line(s) appended verbatim into the WHERE block
 *               (e.g. an extra wdt:Pxx industry constraint). Repeatable.
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

interface CompanyProps {
  qid: string;
  inception?: string;
  image?: string;
  logo?: string;
  wiki?: string;
  instanceLabels?: string[];
  founderLabel?: string;
  industryLabel?: string;
  countryLabel?: string;
  hqLabel?: string;
  parentLabel?: string;
  ceoLabel?: string;
}

async function fetchCompanyProps(
  qids: string[],
): Promise<Map<string, CompanyProps>> {
  const out = new Map<string, CompanyProps>();
  if (qids.length === 0) return out;
  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?inception ?image ?logo ?article
       ?instance ?instanceLabel
       ?founder ?founderLabel
       ?industry ?industryLabel
       ?country ?countryLabel
       ?hq ?hqLabel
       ?parent ?parentLabel
       ?ceo ?ceoLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P154 ?logo. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P112 ?founder. }
  OPTIONAL { ?item wdt:P452 ?industry. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P159 ?hq. }
  OPTIONAL { ?item wdt:P749 ?parent. }
  OPTIONAL { ?item wdt:P169 ?ceo. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchCompanyProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const instSets = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.inception = prev.inception ?? b.inception?.value;
      prev.image = prev.image ?? b.image?.value;
      prev.logo = prev.logo ?? b.logo?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      out.set(qid, prev);
      const inst = b.instanceLabel?.value?.trim();
      if (inst && !/^Q\d+$/.test(inst)) {
        if (!instSets.has(qid)) instSets.set(qid, new Set());
        instSets.get(qid)!.add(inst);
      }
      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of [
        "founder",
        "industry",
        "country",
        "hq",
        "parent",
        "ceo",
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
      if (per.has("founder"))
        p.founderLabel = Array.from(per.get("founder")!).join(" · ");
      if (per.has("industry"))
        p.industryLabel = Array.from(per.get("industry")!).join(" · ");
      if (per.has("country"))
        p.countryLabel = Array.from(per.get("country")!).join(" · ");
      if (per.has("hq")) p.hqLabel = Array.from(per.get("hq")!).join(" · ");
      if (per.has("parent"))
        p.parentLabel = Array.from(per.get("parent")!).join(" · ");
      if (per.has("ceo")) p.ceoLabel = Array.from(per.get("ceo")!).join(" · ");
    }
    for (const [qid, set] of instSets) {
      out.get(qid)!.instanceLabels = Array.from(set);
    }
  }
  return out;
}

const meta = getMeta("companies");

const COMPANY_CLASSES = [
  "Q4830453", // business
  "Q783794", // company
  "Q6881511", // enterprise
  "Q891723", // public company
  "Q210167", // technology company
  "Q22687", // bank
  "Q43229", // organization
  "Q1762059", // film production company
  "Q18127", // record label
  "Q1331793", // media company
  "Q4438121", // sports organization
  "Q11410", // game (kept out — see below)
  "Q1107679", // animation studio
  "Q210980", // automobile manufacturer
  "Q936518", // aerospace manufacturer
  "Q507619", // retail chain
  "Q4830453", // business
];

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 10 : 20;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const values = COMPANY_CLASSES.map((q) => `wd:${q}`).join(" ");
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
        wdt:P571 [] .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${minSitelinks(args.limit)})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-companies");
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

function pickType(p: CompanyProps): string {
  const labels = p.instanceLabels ?? [];
  if (labels.length === 0) return "";
  const generic = /^(business|company|organization|legal person|enterprise)$/i;
  const specific = labels.find((l) => !generic.test(l));
  const chosen = specific ?? labels[0];
  return chosen.charAt(0).toUpperCase() + chosen.slice(1);
}

async function pickLogo(p: CompanyProps): Promise<string> {
  if (p.logo) {
    const thumb = commonsImageThumb(p.logo, 400);
    if (thumb) return thumb;
  }
  if (p.wiki) {
    const t = urlToTitle(p.wiki);
    if (t) {
      const img = await pageImage(t);
      if (img) return img;
    }
  }
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 400);
    if (thumb) return thumb;
  }
  return "";
}

async function mapRow(
  qid: string,
  p: CompanyProps,
  label: string,
): Promise<Row | null> {
  const name = label.trim();
  if (!name || /^Q\d+$/.test(name)) return null;
  const foundation_date = formatSignedDate(parseWikidataDate(p.inception));
  if (!foundation_date) return null;
  const logo = await pickLogo(p);
  if (!logo) return null;
  return {
    name,
    foundation_date,
    country: firstNonGeneric(p.countryLabel),
    industry: joinTop(p.industryLabel, 2),
    reference_url: p.wiki ?? "",
    type: pickType(p),
    headquarters: firstNonGeneric(p.hqLabel),
    founder: joinTop(p.founderLabel, 2),
    parent: firstNonGeneric(p.parentLabel),
    logo,
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchCompanyProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
