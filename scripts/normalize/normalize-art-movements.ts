// Normalize the `movement` column of fine-art.csv to a stable, Title-Cased
// canonical vocabulary.
//
//   npm run normalize:art-movements            # DRY RUN — distribution + diffs
//   npm run normalize:art-movements -- --write # rewrite fine-art.csv in place

import * as fs from "fs";
import * as path from "path";
import Papa from "papaparse";

type Row = Record<string, string>;

const DATASETS_DIR = path.resolve(__dirname, "..", "datasets");
const FILE = "fine-art.csv";
const COLUMN = "movement";

const CANON: Record<string, string> = {
  renaissance: "Renaissance",
  "high renaissance": "High Renaissance",
  "early renaissance": "Early Renaissance",
  "italian renaissance": "Italian Renaissance",
  "italian renaissance sculpture": "Italian Renaissance",
  "northern renaissance": "Northern Renaissance",
  "early netherlandish painting": "Early Netherlandish",
  "early netherlandish": "Early Netherlandish",
  "dutch golden age painting": "Dutch Golden Age",
  "dutch golden age": "Dutch Golden Age",
  "venetian school": "Venetian School",
  mannerism: "Mannerism",
  // Baroque / Rococo
  baroque: "Baroque",
  "baroque sculpture": "Baroque",
  "italian baroque": "Baroque",
  "italian baroque painting": "Baroque",
  "spanish golden age": "Spanish Golden Age",
  rococo: "Rococo",
  // 18th–19th c.
  neoclassicism: "Neoclassicism",
  "neoclassical painting": "Neoclassicism",
  neoclassical: "Neoclassicism",
  "academic art": "Academic Art",
  romanticism: "Romanticism",
  realism: "Realism",
  "french realism": "Realism",
  "american realism": "American Realism",
  naturalism: "Naturalism",
  orientalism: "Orientalism",
  "pre-raphaelite brotherhood": "Pre-Raphaelite",
  tonalism: "Tonalism",
  // Impressionism & after
  impressionism: "Impressionism",
  "post-impressionism": "Post-Impressionism",
  "neo-impressionism": "Neo-Impressionism",
  pointillism: "Pointillism",
  symbolism: "Symbolism",
  "art nouveau": "Art Nouveau",
  // 20th c. modernism
  fauvism: "Fauvism",
  expressionism: "Expressionism",
  "german expressionism": "Expressionism",
  cubism: "Cubism",
  futurism: "Futurism",
  suprematism: "Suprematism",
  constructivism: "Constructivism",
  "de stijl": "De Stijl",
  dada: "Dada",
  surrealism: "Surrealism",
  "art deco": "Art Deco",
  regionalism: "Regionalism",
  "abstract expressionism": "Abstract Expressionism",
  "pop art": "Pop Art",
  minimalism: "Minimalism",
  "modern art": "Modern",
  "contemporary art": "Contemporary",
  // Antiquity & pre-modern
  "hellenistic sculpture": "Hellenistic",
  "hellenistic art": "Hellenistic",
  "hellenistic period": "Hellenistic",
  "greek late classical period": "Late Classical Greek",
  "classical antiquity": "Classical Antiquity",
  "ancient egyptian art": "Ancient Egyptian",
  "art of the paleolithic": "Paleolithic",
  "art of the middle paleolithic": "Paleolithic",
  "middle paleolithic": "Paleolithic",
  "upper paleolithic": "Paleolithic",
  "prehistoric art": "Prehistoric",
  "etruscan art": "Etruscan",
  etruscan: "Etruscan",
  "german renaissance": "German Renaissance",
  "naïve art": "Naïve Art",
  "naive art": "Naïve Art",
  cloisonnism: "Cloisonnism",
  "byzantine art": "Byzantine",
  "romanesque art": "Romanesque",
  "gothic art": "Gothic",
  gothic: "Gothic",
  "international gothic": "International Gothic",
};

function titleCase(s: string): string {
  return s
    .split(/\s+/)
    .map((w) =>
      w
        .split("-")
        .map((p) => (p ? p.charAt(0).toUpperCase() + p.slice(1) : p))
        .join("-"),
    )
    .join(" ");
}

export function normalizeMovement(raw: string | undefined): string {
  const s = (raw ?? "").trim();
  if (!s) return "";
  const key = s.toLowerCase();
  if (CANON[key]) return CANON[key];
  const stripped = key.replace(/\s+(painting|sculpture|art)$/, "");
  if (stripped !== key && CANON[stripped]) return CANON[stripped];
  return titleCase(s);
}

function sanitizeCell(x: string | undefined): string {
  return (x ?? "").replace(/[\r\n]+/g, " ").trim();
}

function run(write: boolean): void {
  const full = path.join(DATASETS_DIR, FILE);
  const res = Papa.parse<Row>(fs.readFileSync(full, "utf8"), {
    header: true,
    skipEmptyLines: true,
  });
  const fields = res.meta.fields ?? [];
  const rows = res.data;

  const dist: Record<string, number> = {};
  const diffs: string[] = [];
  let emptied = 0;

  for (const r of rows) {
    const before = (r[COLUMN] ?? "").trim();
    const after = normalizeMovement(before);
    if (!after) {
      emptied++;
    } else {
      dist[after] = (dist[after] ?? 0) + 1;
    }
    if (after !== before && diffs.length < 12) {
      diffs.push(`   "${before}" → "${after}"`);
    }
    r[COLUMN] = after;
  }

  console.log(`\n===== ${FILE} (${COLUMN}): ${rows.length} rows =====`);
  for (const [c, n] of Object.entries(dist).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${String(n).padStart(4)} ${c}`);
  }
  if (emptied) console.log(`  (!) ${emptied} rows have no movement`);
  for (const d of diffs) console.log(d);

  if (write) {
    const out = Papa.unparse(
      { fields, data: rows.map((r) => fields.map((c) => sanitizeCell(r[c]))) },
      { newline: "\r\n" },
    );
    fs.writeFileSync(full, out + "\r\n", "utf8");
    console.log(`  ✓ wrote ${FILE}`);
  } else {
    console.log("\nDRY RUN — pass --write to apply.");
  }
}

if (require.main === module) {
  run(process.argv.includes("--write"));
}
