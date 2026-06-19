#!/usr/bin/env python3
"""Sort a CSV by a column, in place (or to --output).

Usage:
  python3 scripts/sort-csv.py datasets/events.csv date
  python3 scripts/sort-csv.py datasets/events.csv date --desc
  python3 scripts/sort-csv.py datasets/movies.csv imdb_rating --desc --type number
  python3 scripts/sort-csv.py datasets/people.csv name --type text --output sorted.csv

Args:
  file                 path to the CSV
  column               column name to sort by (must exist in the header)
  --desc               descending order (default ascending)
  --type {auto,date,number,text}
                       force a comparison type; 'auto' (default) detects it
  --blanks {last,first}
                       where empty values go (default last)
  --output PATH        write here instead of overwriting the input
"""
import argparse, csv, re, sys

_BC = re.compile(r"^BC\s+(\d+)$", re.I)
_ISO = re.compile(r"^(-?\d{1,9})(?:-(\d{2}))?(?:-(\d{2}))?$")

def date_key(v):
    v = v.strip()
    m = _BC.match(v)
    if m:
        return (-int(m.group(1)), 1, 1)
    m = _ISO.match(v)
    if m:
        return (int(m.group(1)), int(m.group(2) or 1), int(m.group(3) or 1))
    return None


def number_key(v):
    try:
        return float(v.replace(",", "").strip())
    except ValueError:
        return None


def text_key(v):
    return v.strip().casefold()


def detect_type(values):
    vals = [v for v in values if v.strip()]
    if not vals:
        return "text"
    if all(date_key(v) is not None for v in vals):
        return "date"
    if all(number_key(v) is not None for v in vals):
        return "number"
    return "text"


def line_ending(path):
    with open(path, "rb") as fh:
        sample = fh.read(65536)
    return "\r\n" if b"\r\n" in sample else "\n"


def main():
    ap = argparse.ArgumentParser(description="Sort a CSV by a column (date-aware).")
    ap.add_argument("file")
    ap.add_argument("column")
    ap.add_argument("--desc", action="store_true", help="descending (default ascending)")
    ap.add_argument("--type", choices=["auto", "date", "number", "text"], default="auto")
    ap.add_argument("--blanks", choices=["last", "first"], default="last")
    ap.add_argument("--output", help="write here instead of overwriting the input")
    args = ap.parse_args()

    eol = line_ending(args.file)
    with open(args.file, newline="") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames
        rows = list(reader)

    if not fields or args.column not in fields:
        sys.exit(f"error: column {args.column!r} not found. Columns: {fields}")

    col = args.column
    ctype = detect_type([r[col] for r in rows]) if args.type == "auto" else args.type
    keyfn = {"date": date_key, "number": number_key, "text": text_key}[ctype]

    present, blanks = [], []
    for r in rows:
        k = keyfn(r[col]) if r[col].strip() else None
        (blanks if k is None else present).append((k, r))

    present.sort(key=lambda kr: kr[0], reverse=args.desc)
    blank_rows = [r for _, r in blanks]
    ordered = [r for _, r in present]
    out_rows = (blank_rows + ordered) if args.blanks == "first" else (ordered + blank_rows)

    dest = args.output or args.file
    with open(dest, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=fields, lineterminator=eol)
        writer.writeheader()
        writer.writerows(out_rows)

    print(f"sorted {len(out_rows)} rows by {col!r} ({ctype}, "
          f"{'desc' if args.desc else 'asc'}, blanks {args.blanks}) -> {dest}")


if __name__ == "__main__":
    main()
