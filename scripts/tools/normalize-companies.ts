/**
 * Normalize companies.csv `type` and `industry` columns
 */
import * as path from "path";
import {
  getMeta,
  readDataset,
  writeCsv,
  DATASETS_DIR,
  type Row,
} from "../lib/expand-core";

const TYPE_CANON = new Set([
  "Public Company",
  "Private Company",
  "Subsidiary",
  "State-Owned",
  "Defunct",
  "Brand",
]);

const TYPE_KEYWORDS: [RegExp, string][] = [
  [/defunct|dissolved|\bformer\b|no longer (exists|active)/, "Defunct"],
  [/subsidiary|wholly[- ]owned/, "Subsidiary"],
  [
    /state[- ]?owned|government[- ]?owned|nationali[sz]ed|public sector|statutory (corporation|body|authority)|crown corporation|sovereign wealth/,
    "State-Owned",
  ],
  [
    /public (limited )?company|publicly[- ]traded|public corporation|joint[- ]stock company|kabushiki|société anonyme|aktiengesellschaft|\bplc\b|\bs\.?p\.?a\.?\b/,
    "Public Company",
  ],
  [
    /private (limited )?company|privately[- ]held|family[- ]owned|family business|\bgmbh\b|\bllc\b|limited liability|sole proprietor|partnership/,
    "Private Company",
  ],
  [/\bbrand\b/, "Brand"],
];

// verbose Wikidata industry strings → the dataset's lowercase taxonomy.
const INDUSTRY_KEYWORDS: [RegExp, string][] = [
  [/cocoa|chocolate|confectionery|sugar|dairy|food/, "food"],
  [
    /cognac|wine|alcohol|brewing|brewery|\bbeer\b|champagne|distill|spirits|beverage|soft drink/,
    "beverages",
  ],
  [/pharmaceutic|drug manufactur|biotech/, "pharma"],
  [/semiconductor/, "semiconductors"],
  [/financ|\bbank|insurance|asset management/, "finance"],
  [/firearm|\bweapon|small arms|munition|ammunition/, "weapons"],
  [
    /defen[cs]e|military (equipment|contractor)|arms (industry|manufactur)/,
    "defense",
  ],
  [/aerospace|aircraft|aviation|spaceflight|rocketry/, "aerospace"],
  [/petroleum|oil and gas|petrochemical|\boil\b refining/, "petroleum"],
  [/mining|metallurg|\bore\b|extraction of/, "mining"],
  [/\bsteel\b|basic metals|metal industry|iron and steel/, "steel"],
  [/chemical/, "chemicals"],
  [
    /automobile|automotive|motor vehicle|car manufactur|\btyres?\b|\btires?\b/,
    "automotive",
  ],
  [/publish|printing/, "publishing"],
  [/stationery/, "stationery"],
  [/construction material|cement|building material/, "construction materials"],
  [/musical instrument/, "music"],
  [/telecommunic|telecom|mobile network/, "telecom"],
  [/conglomerate|holding company|diversified/, "conglomerate"],
  [/retail/, "retail"],
  [/e-?commerce|online (retail|marketplace)/, "e-commerce"],
  [/airline|air transport|flag carrier/, "airline"],
  [/hospitality|hotel|lodging/, "hospitality"],
  [/cosmetic|personal care/, "cosmetics"],
  [/fashion|apparel|clothing|luxury goods/, "fashion"],
  [/software|information technology|\bIT\b services|computer/, "software"],
  [
    /internet|web (services|portal)|search engine|social (media|network)/,
    "internet",
  ],
  [/electronics|electrical equipment/, "electronics"],
  [
    /machinery|plastics|rubber|industrial|manufactur|engineering/,
    "manufacturing",
  ],
  [
    /consumer goods|household (goods|products)|earthenware|pottery|ceramic/,
    "consumer goods",
  ],
  [/\btrade\b|trading/, "trade"],
];

function normType(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  const titled = v
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
  if (TYPE_CANON.has(titled)) return titled;
  const low = v.toLowerCase();
  for (const [re, bucket] of TYPE_KEYWORDS) if (re.test(low)) return bucket;
  return v;
}

function normIndustry(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  if (!/[;]/.test(v) && v === v.toLowerCase() && v.split(" ").length <= 2)
    return v;
  const low = v.toLowerCase();
  for (const [re, canon] of INDUSTRY_KEYWORDS) if (re.test(low)) return canon;
  return v;
}

function main() {
  const meta = getMeta("companies");
  const { rows } = readDataset(meta.file);
  let tChg = 0;
  let iChg = 0;
  const out: Row[] = rows.map((r) => {
    const nt = normType(r.type ?? "");
    const ni = normIndustry(r.industry ?? "");
    if (nt !== (r.type ?? "")) tChg++;
    if (ni !== (r.industry ?? "")) iChg++;
    return { ...r, type: nt, industry: ni };
  });
  writeCsv(path.join(DATASETS_DIR, meta.file), meta.columns, out);
  console.log(
    `Normalized companies.csv — type:${tChg} industry:${iChg} changed`,
  );
}

main();
