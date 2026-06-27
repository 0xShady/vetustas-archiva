<div align="center">

<img src=".github/logo.png" alt="Vetustas Archiva" width="130" />

# Vetustas Archiva

**Open, curated datasets of notable things across history and culture**.
movies, music, games, books, people, companies, inventions, landmarks, art and
more, compiled and enriched from public sources into clean, consistent CSVs.

[![Data: CC BY-SA 4.0](https://img.shields.io/badge/data-CC%20BY--SA%204.0-blue.svg)](datasets/LICENSE)
[![Code: MIT](https://img.shields.io/badge/code-MIT-green.svg)](LICENSE)
[![Records](https://img.shields.io/badge/records-4%2C531-orange)](#datasets)
[![Datasets](https://img.shields.io/badge/datasets-14-orange)](#datasets)
[![GitHub stars](https://img.shields.io/github/stars/0xShady/vetustas-archiva?style=flat&logo=github)](https://github.com/0xShady/vetustas-archiva/stargazers)
[![Last commit](https://img.shields.io/github/last-commit/0xShady/vetustas-archiva)](https://github.com/0xShady/vetustas-archiva/commits)

[![Explore the data](https://img.shields.io/badge/%F0%9F%94%8E%20Explore%20%26%20charts-archiva.vetustas.net-8A2BE2?style=for-the-badge)](https://archiva.vetustas.net)
[![Public API](https://img.shields.io/badge/%F0%9F%94%8C%20API-docs.vetustas.net-0A7E8C?style=for-the-badge)](https://docs.vetustas.net)
[![Play the game](https://img.shields.io/badge/%F0%9F%8E%AE%20Game-vetustas.net-E0245E?style=for-the-badge)](https://vetustas.net)

</div>

**4,531 records across 14 datasets.** Plain CSV, one file per category. No build
step needed to use the data — just read the files.

## The Vetustas ecosystem

This repository is the **single source of truth**. Everything else is built on it:

|                                              |                        |                                                                                                                                    |
| -------------------------------------------- | ---------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| **[Explorer](https://archiva.vetustas.net)** | `archiva.vetustas.net` | Browse, search, sort and filter every dataset, with interactive charts (value counts, histograms, choropleth maps).                |
| **[Public API](https://docs.vetustas.net)**  | `api.vetustas.net`     | Token-less, rate-limited JSON API. Per-dataset endpoints with filters. Docs at **[docs.vetustas.net](https://docs.vetustas.net)**. |
| **[The Game](https://vetustas.net)**         | `vetustas.net`         | A trivia / guessing game powered by these datasets.                                                                                |

## Datasets

| File                            | Records | What                                               |
| ------------------------------- | ------: | -------------------------------------------------- |
| `datasets/movies.csv`           |     440 | Films, with IMDb ratings, director, genre, runtime |
| `datasets/tv.csv`               |     329 | TV series, seasons/episodes, network, creator      |
| `datasets/anime.csv`            |     268 | Anime, studio, format, AniList scores              |
| `datasets/games.csv`            |     272 | Video games, developer, publisher, series          |
| `datasets/music.csv`            |     309 | Albums, label, tracks, certifications, popularity  |
| `datasets/literature.csv`       |     315 | Books, author, type, language                      |
| `datasets/fine-art.csv`         |     292 | Paintings & sculptures, artist, movement, medium   |
| `datasets/landmarks.csv`        |     289 | Buildings & sites, architect, country              |
| `datasets/people.csv`           |     502 | Notable people, occupation, nationality            |
| `datasets/companies.csv`        |     398 | Companies, founding, industry, type                |
| `datasets/inventions.csv`       |     296 | Inventions & discoveries, inventor, category       |
| `datasets/events.csv`           |     497 | Historical events, type, era                       |
| `datasets/football-clubs.csv`   |     234 | Football clubs                                     |
| `datasets/basketball-clubs.csv` |      90 | Basketball clubs                                   |

## Data format

- UTF-8 CSV, `\r\n` line endings, header row first.
- Every row has a frozen **`id`** — a UUIDv4 that is permanent and globally
  unique. It never changes and is never reused, even if a record is corrected.
  It's the stable key to reference a record over time.
- Dates use signed `YYYY[-MM[-DD]]`, truncated to the real precision (a year-only
  fact is `YYYY`, not `YYYY-01-01`). BC dates are negative, `-YYYY`.
- Image columns (`poster` / `cover` / `logo` / `crest` / `image`) hold **URLs**
  to externally hosted files (this repo doesn't store the images).
- Controlled-vocabulary columns (`genre`, `type`, `category`, `movement`, `era`)
  are normalized to a small canonical set per dataset.

## Using the data

It's just CSV — open it in anything (pandas, a spreadsheet, `csv` in any
language):

```python
import csv
with open("datasets/movies.csv") as f:
    for row in csv.DictReader(f):
        print(row["title"], row["release_date"], row["imdb_rating"])
```

```typescript
import fs from "fs";
const movies = fs
  .readFileSync("datasets/movies.csv", "utf-8")
  .split("\n")
  .slice(1)
  .map((line) => line.split(","))
  .map(([id, title, release_date, imdb_rating]) => ({
    id,
    title,
    release_date,
    imdb_rating,
  }));
```

Or query it live, without cloning anything, via the **public API**:

```bash
curl "https://api.vetustas.net/v1/movies?genre=Sci-Fi&min_rating=8&year_min=2000"
```

Full endpoint reference and filters: **[docs.vetustas.net](https://docs.vetustas.net)**.

## Scripts

The datasets are generated and maintained by a set of Node + Python scripts
under [`scripts/`](scripts/). You only need these to **add or refresh** data —
using the data needs nothing but the CSVs.

```bash
npm install
cp .env.example .env       # add API keys where a source needs one (e.g. TMDB)

npm run expand:movies      # one scraper per category (expand:tv, expand:games, …)
npm run backfill:id        # stamp UUIDs onto new rows
npm run validate           # schema, unique ids, date checks
```

📖 **Full script reference — every command, what it does, and its arguments, is
in [`scripts/README.md`](scripts/README.md).**

> Requires Node 18+ and Python 3.8+.

## License

Dual-licensed:

- **Datasets** (`datasets/`) — [CC BY-SA 4.0](datasets/LICENSE). Free to use, share
  and adapt (including commercially) with attribution; derivatives stay open
  under the same license.
- **Code** (`scripts/`) — [MIT](LICENSE).

Data is compiled from public sources, each under its own terms.
See [`datasets/LICENSE`](datasets/LICENSE) for the full attribution and source notes.

## Contributing

Contributions welcome and very needed. corrections, new records, new sources.
See [CONTRIBUTING.md](CONTRIBUTING.md) for the rules and how to submit a PR.
