/**
 * Grow people.csv via Wikidata.
 *
 *   npm run expand:people -- --keywords "physicist,philosopher" --limit 200
 *   npm run expand:people -- --filter "?item wdt:P106 wd:Q937857 ."  # footballers
 *
 *   --keywords  narrows discovery: each keyword adds a
 *               FILTER(CONTAINS(LCASE(?itemLabel), "<kw>")) (OR-combined).
 *   --limit     SPARQL result cap (default 50). Also lowers the sitelink floor
 *               for small runs so a tiny limit still finds candidates.
 *   --filter    raw extra SPARQL line(s) appended verbatim into the WHERE block
 *               (e.g. an extra wdt:Pxx occupation constraint). Repeatable.
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

interface PeopleProps {
  qid: string;
  birthDate?: string;
  deathDate?: string;
  image?: string;
  wiki?: string;
  occupationLabel?: string;
  citizenshipLabel?: string;
  birthPlaceLabel?: string;
  genderLabel?: string;
  positionLabel?: string;
}

async function fetchPeopleProps(
  qids: string[],
): Promise<Map<string, PeopleProps>> {
  const out = new Map<string, PeopleProps>();
  if (qids.length === 0) return out;

  const CHUNK = 40;
  for (let i = 0; i < qids.length; i += CHUNK) {
    const slice = qids.slice(i, i + CHUNK);
    const query = `
SELECT ?item ?birthDate ?deathDate ?image ?article
       ?occupation ?occupationLabel ?citizenship ?citizenshipLabel
       ?birthPlace ?birthPlaceLabel ?gender ?genderLabel
       ?position ?positionLabel WHERE {
  VALUES ?item { ${valuesClause(slice)} }
  OPTIONAL { ?item wdt:P569 ?birthDate. }
  OPTIONAL { ?item wdt:P570 ?deathDate. }
  OPTIONAL { ?item wdt:P18 ?image. }
  OPTIONAL { ?item wdt:P106 ?occupation. }
  OPTIONAL { ?item wdt:P27 ?citizenship. }
  OPTIONAL { ?item wdt:P19 ?birthPlace. }
  OPTIONAL { ?item wdt:P21 ?gender. }
  OPTIONAL { ?item wdt:P39 ?position. }
  OPTIONAL {
    ?article schema:about ?item;
             schema:isPartOf <https://en.wikipedia.org/>.
  }
  SERVICE wikibase:label { bd:serviceParam wikibase:language "en". }
}`;
    const rows = await runSparql(query, "fetchPeopleProps");
    const multi = new Map<string, Map<string, Set<string>>>();
    for (const b of rows) {
      const qid = b.item?.value.replace("http://www.wikidata.org/entity/", "");
      if (!qid) continue;
      const prev = out.get(qid) ?? { qid };
      prev.birthDate = prev.birthDate ?? b.birthDate?.value;
      prev.deathDate = prev.deathDate ?? b.deathDate?.value;
      prev.image = prev.image ?? b.image?.value;
      prev.wiki = prev.wiki ?? b.article?.value;
      prev.birthPlaceLabel = prev.birthPlaceLabel ?? b.birthPlaceLabel?.value;
      prev.genderLabel = prev.genderLabel ?? b.genderLabel?.value;
      out.set(qid, prev);

      if (!multi.has(qid)) multi.set(qid, new Map());
      const per = multi.get(qid)!;
      for (const alias of ["occupation", "citizenship", "position"]) {
        const label = b[`${alias}Label`]?.value?.trim();
        if (!label || /^Q\d+$/.test(label) || /^https?:\/\//i.test(label))
          continue;
        if (!per.has(alias)) per.set(alias, new Set());
        per.get(alias)!.add(label);
      }
    }
    for (const [qid, per] of multi) {
      const p = out.get(qid)!;
      if (per.has("occupation"))
        p.occupationLabel = Array.from(per.get("occupation")!).join(" · ");
      if (per.has("citizenship"))
        p.citizenshipLabel = Array.from(per.get("citizenship")!).join(" · ");
      if (per.has("position"))
        p.positionLabel = Array.from(per.get("position")!).join(" · ");
    }
  }
  return out;
}

const meta = getMeta("people");

const OCCUPATION_RANK: { test: RegExp; weight: number }[] = [
  {
    test: /\b(president of|monarch|emperor|empress|sultan|caliph|tsar|tsarina|head of state|king|queen|sovereign|pope|paramount chief)\b/i,
    weight: 100,
  },
  {
    test: /\b(prime minister|chancellor of|dictator|premier|first lady|vice president|grand duke|grand duchess|stadtholder)\b/i,
    weight: 95,
  },
  {
    test: /\b(general|admiral|field marshal|warlord|commander|conqueror|revolutionary)\b/i,
    weight: 90,
  },
  {
    test: /\b(physicist|mathematician|chemist|biologist|astronomer|computer scientist|inventor|engineer|economist|geologist|polymath|natural philosopher|naturalist)\b/i,
    weight: 85,
  },
  {
    test: /\b(philosopher|theologian|sociologist|psychologist|historian|anthropologist|linguist|political scientist)\b/i,
    weight: 80,
  },
  {
    test: /\b(painter|sculptor|architect|composer|conductor|opera singer|playwright|novelist|poet|filmmaker|film director|screenwriter|cinematographer|photographer)\b/i,
    weight: 78,
  },
  {
    test: /\b(actor|actress|musician|singer-songwriter|singer|rapper|band leader|guitarist|pianist|violinist|drummer)\b/i,
    weight: 76,
  },
  {
    test: /\b(association football player|footballer|basketball player|tennis player|baseball player|cricketer|swimmer|boxer|wrestler|sprinter|cyclist|gymnast|golfer|skier|skater|driver|formula one driver|olympic|athlete|jockey)\b/i,
    weight: 74,
  },
  {
    test: /\b(writer|author|essayist|biographer|columnist|journalist|reporter)\b/i,
    weight: 70,
  },
  {
    test: /\b(designer|fashion designer|graphic designer|industrial designer|illustrator|cartoonist|animator)\b/i,
    weight: 65,
  },
  {
    test: /\b(senator|congressperson|congressman|congresswoman|member of parliament|governor|mayor|diplomat|ambassador|judge|jurist|justice|attorney general|secretary of state)\b/i,
    weight: 60,
  },
  {
    test: /\b(politician|statesperson|statesman|stateswoman|civil servant)\b/i,
    weight: 50,
  },
  {
    test: /\b(business[ -]?person|businessman|businesswoman|entrepreneur|investor|industrialist|chief executive|founder|financier|banker)\b/i,
    weight: 45,
  },
  {
    test: /\b(lawyer|barrister|solicitor|attorney|prosecutor|public prosecutor)\b/i,
    weight: 40,
  },
  {
    test: /\b(physician|doctor|surgeon|dentist|psychiatrist|veterinarian|pharmacist|nurse)\b/i,
    weight: 38,
  },
  {
    test: /\b(activist|civil rights activist|human rights activist|suffragist|abolitionist|feminist)\b/i,
    weight: 36,
  },
  {
    test: /\b(saint|martyr|nun|monk|priest|bishop|cardinal|imam|rabbi|prophet|guru)\b/i,
    weight: 34,
  },
  {
    test: /\b(explorer|navigator|adventurer|mountaineer|astronaut|cosmonaut)\b/i,
    weight: 32,
  },
  {
    test: /\b(model|television presenter|television personality|game show host|talk show host|youtuber|streamer|influencer|socialite|reality television star)\b/i,
    weight: 18,
  },
];

const TRIVIAL = /^(human|person|individual|man|woman|adult)$/i;

function rankOccupation(s: string): number {
  for (const r of OCCUPATION_RANK) if (r.test.test(s)) return r.weight;
  return 10;
}

function splitMulti(label: string | undefined): string[] {
  if (!label) return [];
  return label
    .split(" · ")
    .map((s) => s.trim())
    .filter((s) => s && !TRIVIAL.test(s) && !/^Q\d+$/.test(s));
}

function pickOccupations(
  occupationLabel: string | undefined,
  positionLabel: string | undefined,
  maxItems = 3,
): string {
  const occ = splitMulti(occupationLabel);
  const pos = splitMulti(positionLabel);
  if (occ.length === 0 && pos.length === 0) return "";
  const ranked = [
    ...occ.map((s) => ({ s, w: rankOccupation(s) })),
    ...pos.map((s) => ({ s, w: rankOccupation(s) + 5 })),
  ];
  const seen = new Set<string>();
  const unique: { s: string; w: number }[] = [];
  for (const x of ranked.sort((a, b) => b.w - a.w)) {
    const k = x.s.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    unique.push(x);
  }
  return unique
    .slice(0, maxItems)
    .map((x) => x.s.charAt(0).toUpperCase() + x.s.slice(1))
    .join("; ");
}

function pickNationality(label: string | undefined, maxItems = 3): string {
  if (!label) return "";
  const items = label
    .split(" · ")
    .map((s) => s.trim())
    .filter((s) => s && !/^Q\d+$/.test(s));
  return items.slice(0, maxItems).join("; ");
}

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
  const query = `
SELECT ?item ?itemLabel (COUNT(DISTINCT ?sl) AS ?n) WHERE {
  ?item wdt:P31 wd:Q5 ;
        wdt:P569 [] ;
        wdt:P18 [] .
  ?item rdfs:label ?itemLabel . FILTER(LANG(?itemLabel) = "en")
${kwFilter}
${extra}
  ?sl schema:about ?item .
}
GROUP BY ?item ?itemLabel
HAVING(COUNT(DISTINCT ?sl) >= ${minSitelinks(args.limit)})
ORDER BY DESC(?n)
LIMIT ${args.limit}`;
  const rows = await runSparql(query, "discover-people");
  return rows
    .map((b) => ({
      qid: (b.item?.value ?? "").replace("http://www.wikidata.org/entity/", ""),
      label: b.itemLabel?.value ?? "",
    }))
    .filter((r) => /^Q\d+$/.test(r.qid) && r.label);
}

async function pickImage(p: PeopleProps): Promise<string> {
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
  p: PeopleProps,
  label: string,
): Promise<Row | null> {
  const name = label.trim();
  if (!name || /^Q\d+$/.test(name)) return null;
  const date_of_birth = formatSignedDate(parseWikidataDate(p.birthDate));
  if (!date_of_birth) return null;
  const image = await pickImage(p);
  if (!image) return null;
  return {
    name,
    date_of_birth,
    nationality: pickNationality(p.citizenshipLabel),
    occupation: pickOccupations(p.occupationLabel, p.positionLabel),
    image,
    reference_url: p.wiki ?? "",
    wikidata_id: qid,
  };
}

expandWikidata({
  meta,
  args: parseArgs(process.argv.slice(2), { limit: 50 }),
  discover,
  fetchProps: fetchPeopleProps,
  mapRow,
}).catch((e) => {
  console.error(e);
  process.exit(1);
});
