/**
 * Normalize fine-art.csv `movement` and `genre` columns in place.
 *
 *   npx tsx scripts/tools/normalize-fine-art.ts
 *
 * - movement → reuses normalizeMovement (the canonical art-movement vocab).
 * - genre    → the dataset's lowercase genre taxonomy via keyword rules
 *              (first match wins, specific→general). Wikidata's P136 often leaks
 *              period/movement values ("Mycenaean Greece", "Anglo-Saxon art")
 *              into genre — anything that matches no real genre is cleared.
 *
 * Idempotent. Prints any genre values it cleared so they can be reviewed.
 */
import * as path from "path";
import { getMeta, readDataset, writeCsv, DATASETS_DIR, type Row } from "../lib/expand-core";
import { normalizeMovement } from "../normalize/normalize-art-movements";

// canonical genre ← ordered keyword rules (first match wins).
const GENRE_RULES: [string, string[]][] = [
  ["self-portrait", ["self-portrait", "self portrait"]],
  ["group portrait", ["group portrait"]],
  ["portrait", ["portrait", "bust", "tronie"]],
  ["religious art", ["religio", "madonna", "altarpiece", "icon", "crucifix", "biblical", "sacred", "saint", "gospel", "devotional"]],
  ["mythological art", ["mytholog"]],
  ["history painting", ["history paint", "historical paint"]],
  ["battle scene", ["battle"]],
  ["nude", ["nude"]],
  ["landscape", ["landscape"]],
  ["cityscape", ["cityscape", "veduta", "capriccio", "townscape"]],
  ["marine art", ["marine", "seascape"]],
  ["still life", ["still life", "vanitas"]],
  ["allegory", ["allegor"]],
  ["genre scene", ["genre art", "genre scene", "genre paint", "genre work"]],
  ["figurine", ["figurine", "statuette"]],
  ["funerary art", ["funerary", "funeral"]],
  ["public art", ["public art", "monument", "equestrian"]],
  ["abstract", ["abstract"]],
  ["figure", ["figure", "kore", "kouros"]],
];

function normGenre(raw: string): string {
  const s = raw.trim().toLowerCase();
  if (!s) return "";
  for (const [canon, stems] of GENRE_RULES) {
    if (stems.some((st) => s.includes(st))) return canon;
  }
  return ""; // not a real genre (likely a period/movement leak) — clear it
}

function main() {
  const meta = getMeta("fine-art");
  const { rows } = readDataset(meta.file);
  let mChg = 0;
  let gChg = 0;
  const cleared = new Set<string>();
  const out: Row[] = rows.map((r) => {
    const nm = normalizeMovement(r.movement ?? "");
    const ng = normGenre(r.genre ?? "");
    if (nm !== (r.movement ?? "")) mChg++;
    if (ng !== (r.genre ?? "")) {
      gChg++;
      if ((r.genre ?? "").trim() && !ng) cleared.add(r.genre.trim());
    }
    return { ...r, movement: nm, genre: ng };
  });
  writeCsv(path.join(DATASETS_DIR, meta.file), meta.columns, out);
  console.log(`Normalized fine-art — movement:${mChg} genre:${gChg} changed`);
  if (cleared.size) console.log(`Cleared non-genre values: ${[...cleared].join(", ")}`);
}

main();
