/**
 * Update the record counts in README.md from the actual CSVs.
 */
import * as fs from "fs";
import * as path from "path";
import { DATASET_META, readDataset } from "../lib/expand-core";

const README = path.resolve(__dirname, "..", "..", "README.md");

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function main() {
  const metas = Object.values(DATASET_META);
  const counts = metas.map((m) => ({
    file: m.file,
    n: readDataset(m.file).rows.length,
  }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  const datasetCount = counts.length;
  const fmt = (n: number) => n.toLocaleString("en-US");

  let md = fs.readFileSync(README, "utf8");
  const before = md;
  const changes: string[] = [];

  for (const { file, n } of counts) {
    const re = new RegExp(
      "(`datasets/" + escapeRe(file) + "`\\s*\\|\\s*)([\\d,]+)",
    );
    md = md.replace(re, (_m, head, old) => {
      if (old !== fmt(n)) changes.push(`${file}: ${old} -> ${fmt(n)}`);
      return head + fmt(n);
    });
  }

  md = md.replace(
    /\*\*[\d,]+ records across \d+ datasets\.\*\*/,
    `**${fmt(total)} records across ${datasetCount} datasets.**`,
  );

  md = md.replace(
    /records-[\d%A-Za-z,]+-orange/,
    `records-${encodeURIComponent(fmt(total))}-orange`,
  );
  md = md.replace(/datasets-\d+-orange/, `datasets-${datasetCount}-orange`);

  console.log("Dataset record counts:");
  for (const { file, n } of counts)
    console.log(`  ${file.replace(".csv", "").padEnd(18)} ${fmt(n)}`);
  console.log(
    `  ${"TOTAL".padEnd(18)} ${fmt(total)}  (${datasetCount} datasets)`,
  );

  if (md === before) {
    console.log("\nREADME.md already up to date.");
    return;
  }
  fs.writeFileSync(README, md, "utf8");
  console.log(
    `\nUpdated README.md${changes.length ? " — " + changes.join(", ") : ""}.`,
  );
}

main();
