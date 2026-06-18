#!/usr/bin/env python3
"""Stamp a stable, opaque `id` (UUIDv4) as the first column of every dataset CSV.

This is the cross-repo join key: the game seeds Item.id straight from it and the
archive app serves it. It is assigned ONCE and then frozen — a row keeps its id
for life, across title edits, re-sorts and column moves. New rows (blank/missing
id) get a fresh UUID; existing ids are never touched.

Usage:
  python3 scripts/backfill-id.py                 # fill missing ids in all CSVs
  python3 scripts/backfill-id.py datasets/x.csv  # one or more specific files
  python3 scripts/backfill-id.py --check         # error if any row lacks an id (no write)
"""
import argparse, csv, glob, io, os, sys, uuid

DATASETS_GLOB = os.path.join(os.path.dirname(__file__), "..", "datasets", "*.csv")
ID_COL = "id"


def line_ending(path):
    with open(path, "rb") as fh:
        return "\r\n" if b"\r\n" in fh.read(1 << 16) else "\n"


def read(path):
    with open(path, newline="", encoding="utf-8") as fh:
        reader = csv.DictReader(fh)
        return list(reader.fieldnames or []), list(reader)


def write(path, fields, rows, eol):
    buf = io.StringIO()
    w = csv.DictWriter(buf, fieldnames=fields, lineterminator="\n")
    w.writeheader()
    w.writerows(rows)
    data = buf.getvalue()
    if eol == "\r\n":
        data = data.replace("\r\n", "\n").replace("\n", "\r\n")
    with open(path, "w", newline="", encoding="utf-8") as fh:
        fh.write(data)


def process(path, check):
    eol = line_ending(path)
    fields, rows = read(path)
    has_id = ID_COL in fields
    out_fields = fields if has_id else [ID_COL] + fields
    assigned = 0
    missing = 0
    for r in rows:
        cur = (r.get(ID_COL) or "").strip()
        if cur:
            r[ID_COL] = cur
            continue
        missing += 1
        if check:
            continue
        r[ID_COL] = str(uuid.uuid4())
        assigned += 1
    if check:
        return missing, 0
    write(path, out_fields, rows, eol)
    return missing, assigned


def main():
    ap = argparse.ArgumentParser(description="Backfill a frozen UUID id column.")
    ap.add_argument("files", nargs="*", help="CSV files (default: all datasets/*.csv)")
    ap.add_argument("--check", action="store_true",
                    help="error if any row is missing an id; write nothing")
    args = ap.parse_args()

    paths = args.files or sorted(glob.glob(DATASETS_GLOB))
    if not paths:
        sys.exit("no CSV files found")

    total_missing = 0
    for path in paths:
        missing, assigned = process(path, args.check)
        total_missing += missing
        base = os.path.basename(path)
        if args.check:
            print(f"  {base}: {missing} missing id")
        else:
            print(f"  {base}: assigned {assigned} new id(s)")

    if args.check and total_missing:
        sys.exit(f"\n✗ {total_missing} row(s) missing an id — run without --check.")
    print("✓ done" if not args.check else "✓ all rows have an id")


if __name__ == "__main__":
    main()
