/**
 * Grow football-clubs.csv via Wikidata.
 *
 *   npm run expand:football-clubs -- --keywords "united" --limit 200
 *   npm run expand:football-clubs -- --filter "?item wdt:P118 wd:Q9448 ."  # Premier League
 *
 *   --keywords  narrows discovery: each keyword adds a
 *               FILTER(CONTAINS(LCASE(?itemLabel), "<kw>")) (OR-combined).
 *   --limit     SPARQL result cap (default 50). Also lowers the sitelink floor
 *               for small runs so a tiny limit still finds candidates.
 *   --filter    raw extra SPARQL line(s) appended verbatim into the WHERE block
 *               (e.g. an extra wdt:Pxx league constraint). Repeatable.
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
  fetchClubProps,
  commonsImageThumb,
  parseWikidataDate,
  type ClubProps,
} from "../lib/wikidata";
import { pageImage, urlToTitle } from "../lib/wikipedia";

const meta = getMeta("football-clubs");

const FOOTBALL_CLASSES = [
  "Q476028", // association football club
  "Q15944511", // sports team
  "Q12973014", // sports team
];

function escapeKw(s: string): string {
  return s.toLowerCase().replace(/["\\]/g, "\\$&");
}

function minSitelinks(limit: number): number {
  return limit <= 100 ? 8 : 15;
}

async function discover(
  args: ExpandArgs,
): Promise<{ qid: string; label: string }[]> {
  const values = FOOTBALL_CLASSES.map((q) => `wd:${q}`).join(" ");
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
        wdt:P641 wd:Q2736 ;
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
  const rows = await runSparql(query, "discover-football-clubs");
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

async function pickCrest(p: ClubProps): Promise<string> {
  if (p.wiki) {
    const t = urlToTitle(p.wiki);
    if (t) {
      const img = await pageImage(t);
      if (img) return img;
    }
  }
  if (p.images?.length) {
    const crest = p.images.find((u) => /crest|logo|badge|wordmark/i.test(u));
    const thumb = commonsImageThumb(crest ?? p.images[0], 500);
    if (thumb) return thumb;
  }
  if (p.image) {
    const thumb = commonsImageThumb(p.image, 500);
    if (thumb) return thumb;
  }
  return "";
}

async function mapRow(
  qid: string,
  p: ClubProps,
  label: string,
): Promise<Row | null> {
  const name = label.trim();
  if (!name || /^Q\d+$/.test(name)) return null;
  const foundation_date = formatSignedDate(parseWikidataDate(p.inception));
  if (!foundation_date) return null;
  const crest = await pickCrest(p);
  if (!crest) return null;
  return {
    name,
    foundation_date,
    country: firstNonGeneric(p.countryLabel),
    city: firstNonGeneric(p.hqLabel),
    reference_url: p.wiki ?? "",
    crest,
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchClubProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
