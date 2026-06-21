/**
 * Grow landmarks.csv via Wikidata discovery, built on the shared expand-core.
 *
 *   npm run expand:landmarks -- --keywords "..." --limit N
 *
 *   --keywords "a,b"  Narrows discovery to items whose English label CONTAINS
 *                     any of the comma-separated terms (case-insensitive).
 *                     Repeatable; comma-split.
 *   --filter "..."    Raw extra SPARQL WHERE line injected into the discover
 *                     query (e.g. a P17 country constraint). Repeatable.
 *   --limit N         Max candidates to discover (default 50).
 */

import {
  getMeta,
  parseArgs,
  expandWikidata,
  formatSignedDate,
  type Row,
} from "../lib/expand-core";
import {
  runSparql,
  fetchArtLandmarkProps,
  commonsImageThumb,
  parseWikidataDate,
  type ArtOrLandmarkProps,
} from "../lib/wikidata";
import { pageImage, urlToTitle } from "../lib/wikipedia";

const meta = getMeta("landmarks");

const MIN_SITELINKS = 30;

const LANDMARK_CLASSES = [
  "Q23413", // castle
  "Q16560", // palace
  "Q57821", // fortress
  "Q2977", // cathedral
  "Q16970", // church building
  "Q32815", // mosque
  "Q44539", // temple
  "Q842402", // Hindu temple
  "Q44613", // monastery
  "Q12518", // tower
  "Q11303", // skyscraper
  "Q173387", // amphitheatre
  "Q12280", // bridge
  "Q39715", // lighthouse
  "Q4989906", // monument
  "Q5003624", // memorial
  "Q190099", // triumphal arch
  "Q1779653", // victory column
  "Q179700", // statue
  "Q483453", // fountain
  "Q12516", // pyramid
  "Q82117", // city gate
  "Q839954", // archaeological site
  "Q165436", // mausoleum
  "Q483110", // stadium
  "Q153562", // opera house
  "Q33506", // museum
  "Q12323", // dam
  "Q207694", // art museum
];

const REJECT_TYPE =
  /\b(big city|port city|holy city|metropolis|municipality|prefecture|county)\b|\b(ecoregion|historical region|geographic region|geodiversity|decipoint|biblical concept|publishing house|nonprofit organization|non-departmental public body|financial center|educational institution|headquarters|business enterprise|company|organization|government agency)\b/i;

const NATURAL_REJECT =
  /\b(mountain|mount|peak|volcano|volcanic|stratovolcano|caldera|summit|massif|range|hill|butte|mesa|plateau|waterfall|falls|cascade|cataract|lake|loch|lagoon|reservoir|river|stream|creek|bay|gulf|cove|fjord|island|archipelago|islet|cliff|escarpment|gorge|canyon|ravine|valley|reef|atoll|geyser|spring|desert|dune|glacier|plain|forest|woodland|jungle|beach|rock formation|monolith|crater|basin|cape|peninsula|headland|isthmus|strait|sea|ocean|wetland|marsh|swamp|oasis|natural monument|natural heritage|columnar basalt|geological|biosphere|national park|nature reserve|protected area)\b|\b(cave|cavern|grotto)\b/i;

const BUILT_EXEMPT =
  /\b(abbey|monastery|convent|priory|church|cathedral|basilica|chapel|mosque|temple|shrine|synagogue|pagoda|stupa|palace|castle|fort|fortress|citadel|tower|bridge|aqueduct|viaduct|monument|memorial|mausoleum|tomb|pyramid|ziggurat|fountain|lighthouse|amphitheatre|amphitheater|theatre|theater|stadium|arena|museum|library|gallery|building|gate|arch|column|obelisk|dam|canal|wall)\b/i;

function isRejected(type: string): boolean {
  if (BUILT_EXEMPT.test(type)) return false;
  if (/\bartificial\b/i.test(type)) return false;
  return REJECT_TYPE.test(type) || NATURAL_REJECT.test(type);
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

const LANDMARK_HINT =
  /\b(building|tower|skyscraper|bridge|aqueduct|viaduct|cathedral|basilica|church|chapel|abbey|monastery|convent|priory|mosque|temple|shrine|synagogue|pagoda|stupa|palace|castle|fortress|fort|citadel|wall|gate|arch|column|obelisk|monument|memorial|mausoleum|tomb|pyramid|ziggurat|fountain|lighthouse|amphitheatre|amphitheater|colosseum|arena|stadium|theatre|theater|opera house|museum|library|gallery|square|plaza|park|garden|station|archaeological|ancient city|ruins?|heritage|colony|residence|dam|canal)\b/i;

function pickType(instances: string[] | undefined): string {
  if (!instances || instances.length === 0) return "";
  const generic =
    /^(landmark|tourist attraction|tourist destination|building|architectural structure|man-made structure|architectural landmark)$/i;
  const hint = instances.find((i) => LANDMARK_HINT.test(i) && !generic.test(i));
  const specific = instances.find((i) => !generic.test(i));
  const v = hint ?? specific ?? instances[0];
  return v.charAt(0).toUpperCase() + v.slice(1);
}

async function pickImage(p: ArtOrLandmarkProps): Promise<string> {
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

async function discover(
  args: ReturnType<typeof parseArgs>,
): Promise<{ qid: string; label: string }[]> {
  const values = LANDMARK_CLASSES.map((q) => `wd:${q}`).join(" ");
  const keywordFilter = args.keywords.length
    ? `  FILTER(${args.keywords
        .map(
          (k) =>
            `CONTAINS(LCASE(?itemLabel), "${k.toLowerCase().replace(/"/g, '\\"')}")`,
        )
        .join(" || ")})`
    : "";
  const extraFilters = args.filters.map((f) => `  ${f}`).join("\n");
  const query = `
SELECT ?item ?itemLabel (COUNT(DISTINCT ?sl) AS ?n) WHERE {
  VALUES ?cls { ${values} }
  ?item wdt:P31 ?cls ;
        wdt:P18 [] ;
        wdt:P17 [] .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${keywordFilter}
${extraFilters}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${MIN_SITELINKS})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-landmarks");
  return rows
    .map((b) => ({
      qid: (b.item?.value ?? "").replace("http://www.wikidata.org/entity/", ""),
      label: b.itemLabel?.value ?? "",
    }))
    .filter((r) => /^Q\d+$/.test(r.qid) && r.label && !/^Q\d+$/.test(r.label));
}

async function mapRow(
  qid: string,
  p: ArtOrLandmarkProps,
  label: string,
): Promise<Row | null> {
  const title = label.trim();
  if (!title || /^Q\d+$/.test(title)) return null;

  const type = pickType(p.instanceLabels);
  if (isRejected(type)) return null;

  const date = formatSignedDate(parseWikidataDate(p.inception));
  if (!date) return null;

  const image = await pickImage(p);
  if (!image) return null;

  return {
    id: "",
    title,
    date,
    country: firstNonGeneric(p.countryLabel),
    reference_url: p.wiki ?? "",
    location: firstNonGeneric(p.locationLabel),
    type,
    architect: joinTop(p.architectLabel, 2),
    image,
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchArtLandmarkProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
