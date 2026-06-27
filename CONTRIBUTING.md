# Contributing to Vetustas Archiva

Thanks for helping improve the data. Contributions can be:

- **Corrections** — fix a wrong date, author, country, dead image URL, etc.
- **New records** — add notable entries that are missing.
- **New sources / scrapers** — improve how a dataset is generated.

By contributing, you agree your dataset changes are released under
**CC BY-SA 4.0** and code changes under **MIT** (the repo's licenses).

## The one rule that matters most

**Never edit or reuse the `id` column.**

- `id` is a frozen UUIDv4 — a permanent, globally-unique key for a record.
- Correcting a title/author/date? Edit those fields, **keep the same `id`**.
- Removing a record? Delete the whole row (its `id` retires with it).
- Adding a record? Leave `id` **blank** and run `npm run backfill:id`, which
  stamps a fresh UUID onto every blank `id` and never touches existing ones.

Reusing or changing an `id` breaks anything that references the data over time.

## Editing the data

1. Edit the relevant `datasets/*.csv` (UTF-8, keep the header, one record per row).
2. Follow the existing conventions for that file:
   - **Dates**: signed `YYYY[-MM[-DD]]`, truncated to real precision, use
     `YYYY` (not `YYYY-01-01`) when only the year is known; BC is negative
     (`-YYYY`). Don't invent a day/month you don't have.
   - **Controlled columns** (`genre`, `type`, `category`, `movement`, `era`):
     use a value already present in that column. Run the matching normalizer if
     unsure (`npm run normalize:genres`, etc.).
   - **Images**: a direct URL to a hosted file (Wikimedia Commons, etc.). Prefer
     stable hosts. Don't commit binary images to the repo.
3. Validate before opening a PR:

   ```bash
   npm install            # first time only
   npm run backfill:id    # if you added rows
   npm run validate       # MUST pass: schema, unique ids, parseable dates
   ```

4. Optional but appreciated:

   ```bash
   npm run check:images   # are the image URLs you touched alive?
   npm run check:dates    # any placeholder/odd dates?
   ```

## Adding many records (scrapers)

Each dataset has an `expand:<name>` script that pulls from a source (Wikidata,
TMDB, AniList, …). If a source needs an API key, copy `.env.example` to `.env`
and fill it in. New rows are written with a blank `id`; run `npm run backfill:id`
afterwards, then `npm run validate`.

## Adding a new column

A column must be added to the dataset's schema in
`scripts/lib/expand-core.ts` (the `DATASET_META` entry) **and** to every row of
the CSV, or `npm run validate` will fail. Keep new columns lowercase and
documented in your PR description.

## Pull requests

- Keep PRs focused, ideally one dataset (or one theme) per PR.
- In the description, say **what** you changed and **where the data came from**
  (a source link helps review verify facts).
- Make sure `npm run validate` passes. PRs are reviewed before merge.

## Data quality bar

- Prefer **notable**, verifiable entries with a reliable source.
- Facts over opinions; cite a source when a value isn't obvious.
- When unsure about a date's precision, use the coarser one (year over a guessed
  day) rather than a placeholder.

Thanks again, every fix makes the dataset more trustworthy.

For more details please reach out to the maintainer: [Achraf El fadili](https://elfadiliachraf.tech) contact@elfadiliachraf.tech.
