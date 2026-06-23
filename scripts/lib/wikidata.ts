/**
 * Shared Wikidata helpers used by more than one expand script.
 * - throttled SPARQL with retry/backoff (`runSparql`)
 * - `valuesClause` for building SPARQL VALUES blocks
 * - batched property fetch for the multi-consumer datasets (art/landmarks, clubs)
 * - `commonsImageThumb` / `parseWikidataDate` helpers
 */

import { userAgent } from "./user-agent";

const UA = userAgent();

const SPARQL = "https://query.wikidata.org/sparql";

let lastCall = 0;
const MIN_GAP_MS = 350; // ~3 req/s ceiling

async function throttle() {
  const now = Date.now();
  const wait = lastCall + MIN_GAP_MS - now;
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  lastCall = Date.now();
}

export async function runSparql(
  query: string,
  label = "sparql",
): Promise<Record<string, { value: string; "xml:lang"?: string }>[]> {
  const body = `query=${encodeURIComponent(query)}`;
  const MAX_ATTEMPTS = 7;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt += 1) {
    await throttle();
    try {
      const res = await fetch(SPARQL, {
        method: "POST",
        headers: {
          "User-Agent": UA,
          Accept: "application/sparql-results+json",
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body,
      });
      if (res.ok) {
        const json = (await res.json()) as {
          results: { bindings: Record<string, { value: string }>[] };
        };
        return json.results.bindings;
      }
      if (res.status === 429 || res.status >= 500) {
        const retryAfter = Number(res.headers.get("retry-after"));
        const waitMs =
          Number.isFinite(retryAfter) && retryAfter > 0
            ? retryAfter * 1000
            : Math.min(60000, (attempt + 1) * 15000);
        if (attempt === MAX_ATTEMPTS - 1) break;
        await new Promise((r) => setTimeout(r, waitMs));
        continue;
      }
      throw new Error(`SPARQL ${res.status} on ${label}`);
    } catch (e) {
      if (attempt === MAX_ATTEMPTS - 1) throw e;
      await new Promise((r) => setTimeout(r, (attempt + 1) * 5000));
    }
  }
  throw new Error(`SPARQL unreachable after retries (${label})`);
}

export function valuesClause(qids: string[]): string {
  return qids.map((q) => `wd:${q}`).join(" ");
}

export interface ArtOrLandmarkProps {
  qid: string;
  inception?: string;
  image?: string;
  images?: string[];
  wiki?: string;
  instanceLabels?: string[];
  creatorLabel?: string;
  architectLabel?: string;
  locationLabel?: string;
  countryLabel?: string;
  originCountryLabel?: string;
  museumCityLabel?: string;
  museumCountryLabel?: string;
  mediumLabel?: string;
  movementLabel?: string;
  genreLabel?: string;
  heightValue?: string;
}

export async function fetchArtLandmarkProps(
  qids: string[],
): Promise<Map<string, ArtOrLandmarkProps>> {
  const out = new Map<string, ArtOrLandmarkProps>();
  if (qids.length === 0) return out;

  const CHUNK = 30;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?inception ?image ?article ?height
       ?instance ?instanceLabel
       ?creator ?creatorLabel
       ?architect ?architectLabel
       ?location ?locationLabel
       ?country ?countryLabel
       ?origin ?originLabel
       ?museumCity ?museumCityLabel
       ?museumCountry ?museumCountryLabel
       ?medium ?mediumLabel
       ?movement ?movementLabel
       ?genre ?genreLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P31 ?instance. }
  OPTIONAL { ?item wdt:P170 ?creator. }
  OPTIONAL { ?item wdt:P84 ?architect. }
  OPTIONAL { ?item wdt:P276 ?location.
             OPTIONAL { ?location wdt:P131 ?museumCity. }
             OPTIONAL { ?location wdt:P17 ?museumCountry. } }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P495 ?origin. }
  OPTIONAL { ?item wdt:P186 ?medium. }
  OPTIONAL { ?item wdt:P135 ?movement. }
  OPTIONAL { ?item wdt:P136 ?genre. }
  OPTIONAL { ?item wdt:P2048 ?height. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchArtLandmarkProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const imgSets = new Map<string, Set<string>>();
    const instSets = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.inception = prev.inception ?? b.inception?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.heightValue = prev.heightValue ?? b.height?.value;
      out.set(qid, prev);

      const img = b.image?.value;
      if (img) {
        if (!imgSets.has(qid)) imgSets.set(qid, new Set());
        imgSets.get(qid)!.add(img);
      }
      const inst = b.instanceLabel?.value?.trim();
      if (inst && !/^Q\d+$/.test(inst)) {
        if (!instSets.has(qid)) instSets.set(qid, new Set());
        instSets.get(qid)!.add(inst);
      }

      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of [
        "creator",
        "architect",
        "location",
        "country",
        "origin",
        "museumCity",
        "museumCountry",
        "medium",
        "movement",
        "genre",
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
      if (per.has("creator"))
        p.creatorLabel = Array.from(per.get("creator")!).join(" · ");
      if (per.has("architect"))
        p.architectLabel = Array.from(per.get("architect")!).join(" · ");
      if (per.has("location"))
        p.locationLabel = Array.from(per.get("location")!).join(" · ");
      if (per.has("country"))
        p.countryLabel = Array.from(per.get("country")!).join(" · ");
      if (per.has("origin"))
        p.originCountryLabel = Array.from(per.get("origin")!).join(" · ");
      if (per.has("museumCity"))
        p.museumCityLabel = Array.from(per.get("museumCity")!).join(" · ");
      if (per.has("museumCountry"))
        p.museumCountryLabel = Array.from(per.get("museumCountry")!).join(
          " · ",
        );
      if (per.has("medium"))
        p.mediumLabel = Array.from(per.get("medium")!).join(" · ");
      if (per.has("movement"))
        p.movementLabel = Array.from(per.get("movement")!).join(" · ");
      if (per.has("genre"))
        p.genreLabel = Array.from(per.get("genre")!).join(" · ");
    }
    for (const [qid, set] of imgSets) {
      const p = out.get(qid)!;
      p.images = Array.from(set);
      p.image = p.images[0];
    }
    for (const [qid, set] of instSets) {
      const p = out.get(qid)!;
      p.instanceLabels = Array.from(set);
    }
  }
  return out;
}

export interface ClubProps {
  qid: string;
  inception?: string;
  image?: string;
  images?: string[];
  wiki?: string;
  countryLabel?: string;
  leagueLabel?: string;
  hqLabel?: string;
}

export async function fetchClubProps(
  qids: string[],
): Promise<Map<string, ClubProps>> {
  const out = new Map<string, ClubProps>();
  if (qids.length === 0) return out;

  const CHUNK = 40;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?inception ?image ?article
       ?country ?countryLabel ?league ?leagueLabel ?hq ?hqLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P571 ?inception. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P17 ?country. }
  OPTIONAL { ?item wdt:P118 ?league. }
  OPTIONAL { ?item wdt:P159 ?hq. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchClubProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    const imgSets = new Map<string, Set<string>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.inception = prev.inception ?? b.inception?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.countryLabel = prev.countryLabel ?? b.countryLabel?.value;
      prev.hqLabel = prev.hqLabel ?? b.hqLabel?.value;
      out.set(qid, prev);

      const img = b.image?.value;
      if (img) {
        if (!imgSets.has(qid)) imgSets.set(qid, new Set());
        imgSets.get(qid)!.add(img);
      }

      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      const label = b.leagueLabel?.value?.trim();
      if (label && !/^Q\d+$/.test(label)) {
        if (!per.has("league")) per.set("league", new Set());
        per.get("league")!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("league"))
        p.leagueLabel = Array.from(per.get("league")!).join(" · ");
    }
    for (const [qid, set] of imgSets) {
      const p = out.get(qid)!;
      p.images = Array.from(set);
      p.image = p.images[0];
    }
  }
  return out;
}

export function commonsImageThumb(
  raw: string | undefined,
  width = 800,
): string | null {
  if (!raw) return null;
  const m = raw.match(/Special:FilePath\/(.+)$/);
  const filename = m ? decodeURIComponent(m[1]) : raw.split("/").pop();
  if (!filename) return null;
  return `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(filename)}?width=${width}`;
}

// Parse Wikidata literal date like.
export function parseWikidataDate(value: string | undefined): {
  year: number;
  month: number;
  day: number;
} | null {
  if (!value) return null;
  const m = value.match(/^([+-]?)(\d+)-(\d{2})-(\d{2})/);
  if (!m) return null;
  const sign = m[1] === "-" ? -1 : 1;
  return {
    year: sign * parseInt(m[2], 10),
    month: parseInt(m[3], 10),
    day: parseInt(m[4], 10),
  };
}
