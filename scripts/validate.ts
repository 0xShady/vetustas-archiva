import fs from "node:fs";
import path from "node:path";
import Papa from "papaparse";

const DATASETS_DIR = path.join(__dirname, "..", "datasets");

type Row = Record<string, string>;

const REQUIRED: Record<string, string[]> = {
  "anime.csv": ["data_id", "title", "release_date", "genre"],
  "basketball-clubs.csv": ["data_id", "name", "founded", "country"],
  "companies.csv": ["data_id", "name", "founded", "industry", "country"],
  "events.csv": ["data_id", "date", "type", "country"],
  "fine-art.csv": ["data_id", "title", "artist", "year_completed"],
  "football-clubs.csv": ["data_id", "name", "founded", "country"],
  "games.csv": ["data_id", "title", "release_date", "genre"],
  "inventions.csv": ["data_id", "name", "year_invented", "country"],
  "landmarks.csv": ["data_id", "title", "country", "year_built"],
  "literature.csv": ["data_id", "title", "author", "year_published"],
  "movies.csv": ["data_id", "title", "release_date", "genre", "country"],
  "music.csv": ["data_id", "title", "artist", "release_date", "genre"],
  "people.csv": ["data_id", "name", "date_of_birth", "nationality"],
  "tv.csv": ["data_id", "title", "first_aired", "genre", "country"],
};

const NAME_FIELD: Record<string, string> = {
  "anime.csv": "title",
  "fine-art.csv": "title",
  "games.csv": "title",
  "landmarks.csv": "title",
  "literature.csv": "title",
  "movies.csv": "title",
  "music.csv": "title",
  "tv.csv": "title",
  "basketball-clubs.csv": "name",
  "companies.csv": "name",
  "football-clubs.csv": "name",
  "inventions.csv": "name",
  "people.csv": "name",
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

function main() {
  const files = fs
    .readdirSync(DATASETS_DIR)
    .filter((f) => f.endsWith(".csv"))
    .sort();

  const seen = new Map<string, string>();
  const errors: string[] = [];
  const warnings: string[] = [];

  for (const file of files) {
    const { rows, fields, parseErrors } = readCsv(file);
    warnings.push(...parseErrors);

    const required = REQUIRED[file];
    if (!required) {
      warnings.push(
        `${file}: no canonical-column rule (add one to validate.ts).`,
      );
    } else {
      const header = new Set(fields);
      for (const col of required) {
        if (!header.has(col))
          errors.push(`${file}: missing canonical column "${col}".`);
      }
    }

    const nameField = NAME_FIELD[file];
    rows.forEach((r, i) => {
      const line = i + 2;

      const id = (r.data_id ?? "").trim();
      if (!id) {
        errors.push(
          `${file}:${line}  missing data_id` +
            (nameField ? ` (${nameField}="${r[nameField] ?? ""}")` : ""),
        );
      } else {
        const prev = seen.get(id);
        if (prev)
          errors.push(
            `${file}:${line}  duplicate data_id "${id}" (first seen ${prev})`,
          );
        else seen.set(id, `${file}:${line}`);
      }

      if (nameField && !(r[nameField] ?? "").trim()) {
        errors.push(`${file}:${line}  empty ${nameField} (data_id="${id}")`);
      }
    });
  }

  const all = [...warnings, ...errors];
  if (errors.length) {
    console.error(`${all.length} problem(s):\n` + all.join("\n"));
    process.exit(1);
  }
  if (warnings.length)
    console.warn(`${warnings.length} warning(s):\n` + warnings.join("\n"));
  console.log(
    `${seen.size} rows across ${files.length} files — ids unique, canonical columns present.`,
  );
}

main();
