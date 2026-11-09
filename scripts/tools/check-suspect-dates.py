#!/usr/bin/env python3
"""List records whose date day looks like a placeholder default.

Day-precision values ending in -01-01 (Jan 1) or -06-01 (Jun 1) are the usual
"we only knew the year/month, fill the rest" sentinels. This dumps every such
record so they can be eyeballed and, where the real day is known, fixed — or
downgraded to year/month precision.

Reads only — never writes.

Usage:
  npm run check:dates                                       # all datasets, -01-01 + -06-01
  npm run check:dates -- datasets/anime.csv
  npm run check:dates -- --suffix 01-01                     # only Jan 1
  npm run check:dates -- --csv                              # machine-readable rows
"""
import argparse, csv, glob, os, sys

DATASETS_GLOB = os.path.join(os.path.dirname(__file__), "..", "..", "datasets", "*.csv")
DATE_COLS = ("date", "start_date", "release_date", "creation_date", "publish_date", "foundation_date", "first_aired", "date_of_birth")
# Columns to print as the record's label, first match wins.
LABEL_COLS = ("title", "name", "id")
DEFAULT_SUFFIXES = ("01-01", "06-01")


def pick(cols, prefs):
    for c in prefs:
        if c in cols:
            return c
    return None


def scan(path, suffixes):
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        cols = list(reader.fieldnames or [])
        date_col = pick(cols, DATE_COLS)
        label_col = pick(cols, LABEL_COLS)
        id_col = "id" if "id" in cols else None
        hits = []
        if not date_col:
            return date_col, hits
        for i, row in enumerate(reader, start=2):  # line 1 = header
            val = (row.get(date_col) or "").strip()
            if any(val.endswith("-" + s) for s in suffixes):
                hits.append(
                    {
                        "line": i,
                        "label": (row.get(label_col) or "").strip() if label_col else "",
                        "id": (row.get(id_col) or "").strip() if id_col else "",
                        "date": val,
                    }
                )
        return date_col, hits


def main():
    ap = argparse.ArgumentParser(description="List records with placeholder-looking dates.")
    ap.add_argument("files", nargs="*", help="CSV files (default: all datasets/*.csv)")
    ap.add_argument("--suffix", action="append",
                    help="day suffix to flag, e.g. 01-01 (repeatable; default 01-01 + 06-01)")
    ap.add_argument("--csv", action="store_true", help="emit file,line,id,date,label rows")
    args = ap.parse_args()

    suffixes = tuple(args.suffix) if args.suffix else DEFAULT_SUFFIXES
    paths = args.files or sorted(glob.glob(DATASETS_GLOB))
    if not paths:
        sys.exit("no CSV files found")

    if args.csv:
        w = csv.writer(sys.stdout)
        w.writerow(["file", "line", "id", "date", "label"])

    grand = 0
    for path in paths:
        date_col, hits = scan(path, suffixes)
        grand += len(hits)
        if args.csv:
            base = os.path.basename(path)
            for h in hits:
                w.writerow([base, h["line"], h["id"], h["date"], h["label"]])
            continue
        base = os.path.basename(path)
        if not date_col:
            print(f"\n{base} — (no date column)")
            continue
        print(f"\n{base} [{date_col}] — {len(hits)} suspect")
        if not hits:
            continue
        lab_w = max([5] + [len(h["label"]) for h in hits])
        for h in hits:
            print(f"  L{str(h['line']).rjust(5)}  {h['date'].ljust(12)}  "
                  f"{h['label'].ljust(lab_w)}  {h['id']}")

    if not args.csv:
        print(f"\n{grand} suspect records across {len(paths)} files "
              f"(suffixes: {', '.join(suffixes)})")


if __name__ == "__main__":
    main()
