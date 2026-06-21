/**
 * Grow fine-art.csv via Wikidata discovery, built on the shared expand-core.
 *
 *   npm run expand:fine-art -- --keywords "..." --limit N
 *
 *   --keywords "a,b"  Narrows discovery to items whose English label CONTAINS
 *                     any of the comma-separated terms (case-insensitive).
 *                     Repeatable; comma-split.
 *   --filter "..."    Raw extra SPARQL WHERE line injected into the discover
 *                     query (e.g. a P136 genre constraint). Repeatable.
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
import { normalizeMovement } from "../normalize/normalize-art-movements";

const meta = getMeta("fine-art");

const MIN_SITELINKS = 25;

const FINE_ART_CLASSES = [
  "Q3305213", // painting
  "Q860861", // sculpture
];

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

function cleanArtist(s: string | undefined): string {
  const v = (s ?? "").trim();
  return /^https?:\/\//i.test(v) || /\.well-known\/genid\//i.test(v)
    ? "Unknown"
    : v;
}

function pickType(instances: string[] | undefined): string {
  if (!instances || instances.length === 0) return "";
  const generic = /^(artwork|work of art|art object|object)$/i;
  const specific = instances.find((i) => !generic.test(i));
  const v = specific ?? instances[0];
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
  const values = FINE_ART_CLASSES.map((q) => `wd:${q}`).join(" ");
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
        wdt:P135 [] .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${keywordFilter}
${extraFilters}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${MIN_SITELINKS})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-fine-art");
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

  const date = formatSignedDate(parseWikidataDate(p.inception));
  if (!date) return null;

  const image = await pickImage(p);
  if (!image) return null;

  const movement = normalizeMovement(firstNonGeneric(p.movementLabel));

  return {
    id: "",
    title,
    creation_date: date,
    reference_url: p.wiki ?? "",
    location: firstNonGeneric(p.locationLabel),
    artist: cleanArtist(joinTop(p.creatorLabel, 2)),
    type: pickType(p.instanceLabels),
    medium: joinTop(p.mediumLabel, 2),
    movement,
    genre: firstNonGeneric(p.genreLabel),
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
