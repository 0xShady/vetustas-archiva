/**
 * Generic merge — the ONE cross-dataset script. Folds a reviewed temp file of new
 * rows (produced by `expand-<dataset>.ts`) back into the main CSV, then stamps
 * ids, sorts, and validates.
 *
 *   npm run merge -- <dataset> [tmpfile]
 *   npm run merge -- people                 # uses tmp/people.new.csv
 *   npm run merge -- movies tmp/movies.reviewed.csv
 *
 * Steps: read temp + main → re-dedupe by the dataset's identity keys (safety) →
 * append → `backfill-id.py` (fills blank ids on the new rows) → `sort-csv.py`
 * (orders by the dataset's date column) → `validate.ts`. Leaves a commit-ready CSV.
 */
import * as fs from "fs";
import * as path from "path";
import { execFileSync } from "child_process";
import Papa from "papaparse";
import {
  getMeta,
  readDataset,
  writeCsv,
  existingKeySets,
  isKnown,
  passesRequired,
  DATASETS_DIR,
  TMP_DIR,
  type Row,
} from "../lib/expand-core";

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function readCsvFile(full: string): Row[] {
  const text = fs.readFileSync(full, "utf8");
  return Papa.parse<Row>(text, { header: true, skipEmptyLines: true }).data;
}

function sh(cmd: string, args: string[]): void {
  console.log(`  $ ${cmd} ${args.join(" ")}`);
  execFileSync(cmd, args, { cwd: REPO_ROOT, stdio: "inherit" });
}

function main(): void {
  const [slug, tmpArg] = process.argv.slice(2);
  if (!slug) {
    console.error("usage: merge.ts <dataset> [tmpfile]");
    process.exit(1);
  }
  const meta = getMeta(slug);

  const tmpPath = tmpArg
    ? path.resolve(REPO_ROOT, tmpArg)
    : path.join(TMP_DIR, `${meta.slug}.new.csv`);
  if (!fs.existsSync(tmpPath)) {
    console.error(
      `No temp file at ${tmpPath} — run \`npm run expand:${meta.slug}\` first.`,
    );
    process.exit(1);
  }

  const { rows: existing } = readDataset(meta.file);
  const incoming = readCsvFile(tmpPath);
  console.log(`Main: ${existing.length} rows · temp: ${incoming.length} rows`);

  // Safety re-dedupe against the current main file + within the temp batch, and
  // re-apply the required gate.
  const sets = existingKeySets(existing, meta.dedupKeys);
  const batch = existingKeySets([], meta.dedupKeys);
  const toAppend: Row[] = [];
  let skippedKnown = 0;
  let skippedIncomplete = 0;
  for (const r of incoming) {
    if (isKnown(r, sets, meta.dedupKeys)) {
      skippedKnown++;
      continue;
    }
    if (isKnown(r, batch, meta.dedupKeys)) {
      skippedKnown++;
      continue;
    }
    if (!passesRequired(meta, r)) {
      skippedIncomplete++;
      continue;
    }
    for (const k of meta.dedupKeys) {
      const v = (r[k] ?? "").trim();
      if (v) batch[k].add(v);
    }
    toAppend.push(r);
  }

  if (toAppend.length === 0) {
    console.log(
      `Nothing to merge (skipped ${skippedKnown} known, ${skippedIncomplete} incomplete).`,
    );
    return;
  }

  const merged = [...existing, ...toAppend];
  const mainFull = path.join(DATASETS_DIR, meta.file);
  writeCsv(mainFull, meta.columns, merged);
  console.log(
    `Appended ${toAppend.length} rows (skipped ${skippedKnown} known, ${skippedIncomplete} incomplete). Now ${merged.length} rows.`,
  );

  const rel = `datasets/${meta.file}`;
  console.log("\nStamping ids, sorting, validating…");
  sh("python3", ["scripts/tools/backfill-id.py", rel]);
  sh("python3", ["scripts/tools/sort-csv.py", rel, meta.dateColumn]);
  sh("npx", ["ts-node", "scripts/validate.ts"]);

  if (!tmpArg) fs.rmSync(tmpPath, { force: true });
  console.log(
    `\n✓ merged ${meta.slug}. Review \`git diff ${rel}\` and commit.`,
  );
}

main();
