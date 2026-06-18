// CI gate for the datasets
//
// For every dataset it checks:
//   1. Schema — the CSV header equals meta.columns exactly (id first). A missing
//      column = renamed/removed; an unexpected column = added. Either fails CI
//      with a message telling you to reconcile the CSV and DATASET_META.
//   2. id — present, non-empty, globally unique across all files.
//   3. title/name — meta.titleField non-empty on every row.
//   4. date — meta.dateColumn parses with the SAME grammar the game seeder uses,
//      so a row that passes here is guaranteed to seed (not get skipped).
//

import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";
import {
  DATASET_META,
  DATASETS_DIR,
  type DatasetMeta,
  type Row,
} from "./lib/expand-core";

//   - BC year text:        "BC 753" .. "BC 3300000"  (1–7 digits, no month/day)
//   - signed bare year:    "-3300000" .. "12345"     (deep-BC stored as negative)
//   - signed YYYY[-MM[-DD]]: 1–5 digit year, optional leading "-"
const DATE_RES = [
  /^BC\s+\d{1,7}$/i,
  /^-?\d{1,5}-\d{2}-\d{2}$/,
  /^-?\d{1,5}-\d{2}$/,
  /^-?\d{1,7}$/,
];
const parsesAsDate = (v: string | undefined) => {
  const s = (v ?? "").trim();
  return s !== "" && DATE_RES.some((re) => re.test(s));
};

function readCsv(file: string): {
  rows: Row[];
  fields: string[];
  parseErrors: string[];
} {
  const text = fs.readFileSync(path.join(DATASETS_DIR, file), "utf8");
  const out = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  const parseErrors = out.errors.map(
    (e) => `${file} (row ${e.row}): ${e.message}`,
  );
  return { rows: out.data, fields: out.meta.fields ?? [], parseErrors };
}

function checkSchema(
  meta: DatasetMeta,
  fields: string[],
  errors: string[],
): void {
  const have = new Set(fields);
  const want = new Set(meta.columns);
  for (const c of meta.columns) {
    if (!have.has(c)) {
      errors.push(
        `${meta.file}: missing column "${c}" (renamed or removed? reconcile the CSV and DATASET_META).`,
      );
    }
  }
  for (const c of fields) {
    if (!want.has(c)) {
      errors.push(
        `${meta.file}: unexpected column "${c}" (added? add it to DATASET_META in expand-core.ts).`,
      );
    }
  }
  if (fields.length > 0 && fields[0] !== "id") {
    errors.push(`${meta.file}: first column is "${fields[0]}", expected "id".`);
  }
}

function main(): void {
  const errors: string[] = [];
  const warnings: string[] = [];
  const seen = new Map<string, string>();

  const onDisk = new Set(
    fs.readdirSync(DATASETS_DIR).filter((f) => f.endsWith(".csv")),
  );
  const metas = Object.values(DATASET_META);

  for (const f of onDisk) {
    if (!metas.some((m) => m.file === f)) {
      warnings.push(`${f}: no DATASET_META entry (add one to expand-core.ts).`);
    }
  }

  for (const meta of metas) {
    if (!onDisk.has(meta.file)) {
      errors.push(
        `${meta.file}: declared in DATASET_META but missing from datasets/.`,
      );
      continue;
    }
    const { rows, fields, parseErrors } = readCsv(meta.file);
    warnings.push(...parseErrors);
    checkSchema(meta, fields, errors);

    rows.forEach((r, i) => {
      const line = i + 2; // header is line 1
      const id = (r.id ?? "").trim();
      if (!id) {
        errors.push(
          `${meta.file}:${line}  missing id (${meta.titleField}="${r[meta.titleField] ?? ""}")`,
        );
      } else {
        const prev = seen.get(id);
        if (prev)
          errors.push(
            `${meta.file}:${line}  duplicate id "${id}" (first seen ${prev})`,
          );
        else seen.set(id, `${meta.file}:${line}`);
      }

      if (!(r[meta.titleField] ?? "").trim()) {
        errors.push(
          `${meta.file}:${line}  empty ${meta.titleField} (id="${id}")`,
        );
      }

      if (!parsesAsDate(r[meta.dateColumn])) {
        errors.push(
          `${meta.file}:${line}  unparseable ${meta.dateColumn}="${(r[meta.dateColumn] ?? "").slice(0, 24)}" (id="${id}")`,
        );
      }
    });
  }

  if (errors.length) {
    console.error(
      `${errors.length + warnings.length} problem(s):\n` +
        [...warnings, ...errors].join("\n"),
    );
    process.exit(1);
  }
  if (warnings.length)
    console.warn(`${warnings.length} warning(s):\n` + warnings.join("\n"));
  console.log(
    `${seen.size} rows across ${metas.length} files — schema matches DATASET_META, ids unique, dates parse.`,
  );
}

main();
