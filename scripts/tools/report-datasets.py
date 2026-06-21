#!/usr/bin/env python3
"""Fill-rate report over the dataset CSVs.

Reads only — never writes. CRLF/LF does not matter for reading.

Usage:
  # report every dataset
  python3 scripts/report-datasets.py

  # one or more specific files
  python3 scripts/report-datasets.py datasets/anime.csv datasets/movies.csv

  # sort each table by fill rate (sparsest column first) instead of CSV order
  python3 scripts/report-datasets.py --sort
"""
import argparse, csv, glob, json, os, re, sys

DATASETS_GLOB = os.path.join(os.path.dirname(__file__), "..", "..", "datasets", "*.csv")

DATE_COLS = ("date", "start_date", "release_date", "creation_date", "publish_date", "foundation_date", "first_aired", "date_of_birth")

# Signed-ISO date, truncated by precision: -?YYYY[-MM[-DD]].
ISO = re.compile(r"^-?\d{1,9}(?:-(\d{2}))?(?:-(\d{2}))?$")


def date_precision(val):
    """day | month | year | other for a signed-ISO date string."""
    m = ISO.match(val.strip())
    if not m:
        return "other"
    if m.group(2):
        return "day"
    if m.group(1):
        return "month"
    return "year"


def pick_date_col(cols):
    for cand in DATE_COLS:
        if cand in cols:
            return cand
    return None


def analyze(path):
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        cols = list(reader.fieldnames or [])
        date_col = pick_date_col(cols)
        filled = {c: 0 for c in cols}
        prec = {"day": 0, "month": 0, "year": 0, "other": 0}
        total = 0
        for row in reader:
            total += 1
            for c in cols:
                val = row.get(c)
                if val is not None and val.strip() != "":
                    filled[c] += 1
            if date_col:
                dv = (row.get(date_col) or "").strip()
                prec[date_precision(dv) if dv else "other"] += 1
    return {
        "file": os.path.basename(path),
        "rows": total,
        "date_col": date_col,
        "precision": prec,
        "columns": [
            {
                "name": c,
                "filled": filled[c],
                "pct": (100.0 * filled[c] / total) if total else 0.0,
            }
            for c in cols
        ],
    }


def print_table(rep, sort):
    cols = rep["columns"]
    if sort:
        cols = sorted(cols, key=lambda c: c["pct"])
    name_w = max([len("column")] + [len(c["name"]) for c in cols])
    cnt_w = max(len("filled"), len(str(rep["rows"])))
    print(f"\n{rep['file']} — {rep['rows']} rows")
    print(f"  {'column'.ljust(name_w)}  {'filled'.rjust(cnt_w)}  {'%'.rjust(6)}")
    print(f"  {'-' * name_w}  {'-' * cnt_w}  {'-' * 6}")
    for c in cols:
        bar = "" if c["pct"] >= 100 else ("  <-- gaps" if c["pct"] < 90 else "")
        print(
            f"  {c['name'].ljust(name_w)}  {str(c['filled']).rjust(cnt_w)}  "
            f"{c['pct']:6.1f}{bar}"
        )
    print_precision(rep, name_w, cnt_w)


def print_precision(rep, name_w, cnt_w):
    if not rep["date_col"]:
        print("  (no date column)")
        return
    total = rep["rows"]
    prec = rep["precision"]
    print(f"  date precision [{rep['date_col']}]")
    for label in ("day", "month", "year", "other"):
        n = prec[label]
        if label == "other" and n == 0:
            continue
        pct = (100.0 * n / total) if total else 0.0
        print(f"    {label.ljust(name_w - 2)}  {str(n).rjust(cnt_w)}  {pct:6.1f}")


def main():
    ap = argparse.ArgumentParser(description="Per-column fill-rate report for CSVs.")
    ap.add_argument("files", nargs="*", help="CSV files (default: all datasets/*.csv)")
    ap.add_argument("--sort", action="store_true",
                    help="sort each table by fill rate (sparsest first)")
    ap.add_argument("--json", action="store_true", help="emit JSON instead of tables")
    args = ap.parse_args()

    paths = args.files or sorted(glob.glob(DATASETS_GLOB))
    if not paths:
        sys.exit("no CSV files found")

    reports = [analyze(p) for p in paths]

    if args.json:
        print(json.dumps(reports, indent=2))
        return

    for rep in reports:
        print_table(rep, args.sort)

    grand = sum(r["rows"] for r in reports)
    print(f"\n{len(reports)} files, {grand} rows total")


if __name__ == "__main__":
    main()
