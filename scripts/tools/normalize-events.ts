/**
 * Normalize the events.csv `type` column to the dataset's controlled vocabulary.
 */
import * as path from "path";
import {
  getMeta,
  readDataset,
  writeCsv,
  DATASETS_DIR,
  type Row,
} from "../lib/expand-core";

const CANON = new Set([
  "War",
  "Battle",
  "Treaty",
  "Civil war",
  "Disaster",
  "Military operation",
  "Historical period",
  "Revolution",
  "Siege",
  "Rebellion",
  "Conquest",
  "Religious event",
  "Assassination",
  "Pandemic",
  "Terrorist attack",
  "Exploration",
  "Protest march",
]);

const KEYWORDS: [RegExp, string][] = [
  [/civil war/i, "Civil war"],
  [/\bbattle\b|naval battle|land battle/i, "Battle"],
  [/\bsiege\b/i, "Siege"],
  [/\bwar\b|warfare|conflict/i, "War"],
  [/treaty|peace (agreement|accord)/i, "Treaty"],
  [/revolution|coup/i, "Revolution"],
  [/rebellion|revolt|uprising|insurrection|mutiny/i, "Rebellion"],
  [/pandemic|epidemic|plague|influenza|flu\b/i, "Pandemic"],
  [/assassination|fusillade|regicide/i, "Assassination"],
  [/terror|bombing|massacre|hijack/i, "Terrorist attack"],
  [
    /fire|eruption|explosion|earthquake|flood|famine|shipwreck|disaster|wreck|sinking|nuclear accident|capsiz/i,
    "Disaster",
  ],
  [
    /operation|offensive|campaign|invasion|landing|airlift/i,
    "Military operation",
  ],
  [/conquest/i, "Conquest"],
  [/expedition|voyage|exploration|circumnavigation/i, "Exploration"],
  [/protest|march|demonstration|tea party/i, "Protest march"],
  [
    /religio|council|schism|crusade|inquisition|witch trial/i,
    "Religious event",
  ],
  [
    /period|dynasty|empire|civilization|civilisation|kingdom|age\b|era\b|organization|organisation/i,
    "Historical period",
  ],
];

const EXACT: Record<string, string> = {
  Conspiracy: "Rebellion",
  Occurrence: "Rebellion",
  Incident: "Protest march",
  "Declaration of independence": "Revolution",
};

function normType(raw: string): string {
  const v = raw.trim();
  if (!v) return v;
  const titled = v.charAt(0).toUpperCase() + v.slice(1);
  if (CANON.has(titled)) return titled;
  for (const [re, canon] of KEYWORDS) if (re.test(v)) return canon;
  if (EXACT[titled]) return EXACT[titled];
  return v;
}

function main() {
  const meta = getMeta("events");
  const { rows } = readDataset(meta.file);
  let changed = 0;
  const unknown = new Set<string>();
  const out: Row[] = rows.map((r) => {
    const nt = normType(r.type ?? "");
    if (!CANON.has(nt)) unknown.add(r.type ?? "");
    if (nt !== (r.type ?? "")) changed++;
    return { ...r, type: nt };
  });
  writeCsv(path.join(DATASETS_DIR, meta.file), meta.columns, out);
  console.log(`Normalized events type — ${changed} changed`);
  if (unknown.size)
    console.log(`Unmapped (left as-is): ${[...unknown].join(", ")}`);
}

main();
