# Scripts

Everything that **generates, validates and maintains** the datasets. You only
need these to add or refresh data — consuming the CSVs needs none of this.

- **TypeScript** scripts run via [`ts-node`](https://typestrong.org/ts-node/)
  (wired as `npm run …`) or directly with `npx tsx <file>`.
- **Python** scripts need Python 3 (no extra deps).

```bash
npm install                         # once
cp ../.env.example ../.env          # add API keys where a source needs one
```

## Typical workflow

```bash
npm run expand:games                # scrape new candidate rows for a dataset → tmp/
npm run merge -- games              # merge reviewed candidates into datasets/games.csv
npm run backfill:id                 # stamp UUIDs onto any blank id
npm run normalize:genres -- --write # canonicalize controlled columns
npm run validate                    # gate: schema + unique ids + dates  (must pass)
```

---

## Expand (scrapers)

One per dataset. Each writes candidate rows you review before merging. `id` is
left blank (stamped later by `backfill:id`).

| Command                           | Source                   | Needs a key            |
| --------------------------------- | ------------------------ | ---------------------- |
| `npm run expand:movies`           | IMDb datasets + Wikidata | IMDb dumps (see below) |
| `npm run expand:tv`               | TMDB                     | `TMDB_APP_KEY`         |
| `npm run expand:anime`            | AniList                  | —                      |
| `npm run expand:games`            | Wikidata                 | —                      |
| `npm run expand:music`            | Wikidata                 | —                      |
| `npm run expand:literature`       | Wikidata                 | —                      |
| `npm run expand:fine-art`         | Wikidata                 | —                      |
| `npm run expand:landmarks`        | Wikidata                 | —                      |
| `npm run expand:people`           | Wikidata                 | —                      |
| `npm run expand:companies`        | Wikidata                 | —                      |
| `npm run expand:inventions`       | Wikidata                 | —                      |
| `npm run expand:events`           | Wikidata                 | —                      |
| `npm run expand:football-clubs`   | Wikidata                 | —                      |
| `npm run expand:basketball-clubs` | Wikidata                 | —                      |

### Common arguments

Pass after `--`, e.g. `npm run expand:music -- --keywords "jazz" --limit 100`.

| Flag         | Alias | Default              | Description                                                                                                                                 |
| ------------ | ----- | -------------------- | ------------------------------------------------------------------------------------------------------------------------------------------- |
| `--keywords` | `-k`  | —                    | Narrow discovery. Comma-separated; repeatable. For Wikidata: label substring filter (OR-combined). For TMDB/AniList: one search query each. |
| `--filter`   | `-f`  | —                    | (Wikidata scrapers) Raw extra SPARQL line(s) injected into the `WHERE` block, e.g. `--filter "?item wdt:P17 wd:Q142 ."`. Repeatable.        |
| `--limit`    | `-n`  | `50`                 | Max candidate rows to fetch.                                                                                                                |
| `--out`      | `-o`  | `tmp/<slug>.new.csv` | Override the output path.                                                                                                                   |

Examples:

```bash
# Wikidata: jazz albums, capped at 100
npm run expand:music -- -k "jazz,blue note" -n 100

# Wikidata: French companies only (raw SPARQL constraint)
npm run expand:companies -- --filter "?item wdt:P17 wd:Q142 ." --limit 200

# TMDB: search-driven
npm run expand:tv -- --keywords "twin peaks,the wire" --limit 20
```

**movies** is special — it discovers from IMDb's public datasets. Download them
once, then run:

```bash
mkdir -p /tmp/imdb-data && cd /tmp/imdb-data
curl -O https://datasets.imdbws.com/title.ratings.tsv.gz
curl -O https://datasets.imdbws.com/title.basics.tsv.gz
npm run expand:movies -- --limit 100
```

---

## Maintenance

| Command                   | What it does                                                                                                                                      |
| ------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run merge -- <slug>` | Merge reviewed `tmp/<slug>.new.csv` candidates into `datasets/<slug>.csv`, de-duplicating against existing rows.                                  |
| `npm run backfill:id`     | Stamp a fresh UUIDv4 onto every blank `id`. Never touches an existing `id`. Run after adding rows.                                                |
| `npm run validate`        | **The CI gate.** Checks each CSV's header matches its schema, `id` is present and globally unique, and dates parse. Exit non-zero on any problem. |
| `npm run report`          | Print a per-dataset summary (row counts, column coverage).                                                                                        |

---

## Normalization

Collapse free-text columns to a small canonical vocabulary. **Dry-run by
default**, pass `--write` to apply.

| Command                                      | Column(s)  | Files                    |
| -------------------------------------------- | ---------- | ------------------------ |
| `npm run normalize:genres -- --write`        | `genre`    | movies, tv, games, music |
| `npm run normalize:art-movements -- --write` | `movement` | fine-art                 |

Per-dataset normalizers (run with `npx tsx`, in-place, idempotent):

| Script                                         | Column(s)           |
| ---------------------------------------------- | ------------------- |
| `npx tsx scripts/tools/normalize-companies.ts` | `type`, `industry`  |
| `npx tsx scripts/tools/normalize-events.ts`    | `type`              |
| `npx tsx scripts/tools/normalize-fine-art.ts`  | `movement`, `genre` |

---

## Quality checks

### `npm run check:images` — find dead image URLs

Walks every image column (`poster`/`cover`/`logo`/`crest`/`image`) and reports
URLs that are definitively gone (HTTP 404/410, or a non-image response).

| Flag             | Default      | Description                                                                                      |
| ---------------- | ------------ | ------------------------------------------------------------------------------------------------ |
| `files…`         | all datasets | Limit to specific CSV paths.                                                                     |
| `--workers N`    | `8`          | Concurrent requests. Lower for throttling hosts.                                                 |
| `--timeout S`    | `12`         | Per-request timeout (seconds).                                                                   |
| `--retries N`    | `3`          | Retries on transient errors (with backoff).                                                      |
| `--inconclusive` | off          | Also show rate-limited / timed-out / blocked URLs (hidden by default — they're noise, not dead). |
| `--json`         | off          | Machine-readable output.                                                                         |

```bash
npm run check:images                       # all datasets, dead only
npm run check:images -- datasets/tv.csv    # one file
npm run check:images -- --workers 4 --inconclusive
```

### `npm run check:dates` — flag placeholder dates

Lists rows whose date ends in a sentinel like `-01-01` or `-06-01` (often a
"only the year was known" filler) so the precision can be reviewed.

| Flag         | Default          | Description                  |
| ------------ | ---------------- | ---------------------------- |
| `files…`     | all datasets     | Limit to specific CSV paths. |
| `--suffix S` | `01-01`, `06-01` | Date suffix(es) to flag.     |
| `--csv`      | off              | Machine-readable rows.       |

---

## Library

`scripts/lib/` holds shared helpers (`expand-core.ts` — the `DATASET_META`
schema registry and CSV I/O; `wikidata.ts`, `wikipedia.ts`, `user-agent.ts`,
`load-env.ts`). Not run directly.

> Adding a **new column**? Add it to the dataset's `DATASET_META` entry in
> `scripts/lib/expand-core.ts` **and** to every CSV row, or `validate` fails.
