#!/usr/bin/env python3
"""Reorder the columns of a CSV, in place (or to --output).

takes either:
- `--order col1,col2,...` to move these columns to the front
- `--last colA,colB,...` to move these columns to the end

- strict mode (`--strict`) requires that `--order` list every column (no implicit remainder)
"""
import argparse, csv, sys


def line_ending(path):
    with open(path, "rb") as fh:
        return "\r\n" if b"\r\n" in fh.read(1 << 16) else "\n"


def main():
    ap = argparse.ArgumentParser(description="Reorder CSV columns.")
    ap.add_argument("file")
    ap.add_argument("--order", help="comma-separated columns to move to the FRONT (in this order)")
    ap.add_argument("--last", help="comma-separated columns to move to the END (in this order)")
    ap.add_argument("--strict", action="store_true",
                    help="require --order to list every column (no implicit remainder)")
    ap.add_argument("--check", action="store_true", help="print the new order, do not write")
    ap.add_argument("--output", help="write here instead of overwriting the input")
    args = ap.parse_args()

    if not args.order and not args.last:
        sys.exit("error: give --order and/or --last")

    eol = line_ending(args.file)
    with open(args.file, newline="") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames or []
        rows = list(reader)

    front = [c.strip() for c in args.order.split(",")] if args.order else []
    last = [c.strip() for c in args.last.split(",")] if args.last else []

    unknown = [c for c in front + last if c not in fields]
    if unknown:
        sys.exit(f"error: column(s) not found: {unknown}. Columns: {fields}")
    dup = set(front) & set(last)
    if dup:
        sys.exit(f"error: column(s) in both --order and --last: {sorted(dup)}")

    middle = [c for c in fields if c not in front and c not in last]
    if args.strict and middle:
        sys.exit(f"error: --strict but these columns were not listed: {middle}")

    new_fields = front + middle + last
    if new_fields == fields:
        print("columns already in that order; nothing to do.")
        return

    print("old:", ", ".join(fields))
    print("new:", ", ".join(new_fields))
    if args.check:
        print("(--check: no file written)")
        return

    dest = args.output or args.file
    with open(dest, "w", newline="") as fh:
        writer = csv.DictWriter(fh, fieldnames=new_fields, lineterminator=eol)
        writer.writeheader()
        writer.writerows(rows)
    print(f"WRITTEN -> {dest}")


if __name__ == "__main__":
    main()
