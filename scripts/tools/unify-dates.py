#!/usr/bin/env python3
"""Unify the date columns of a dataset to ONE convention (signed ISO-8601).
Years are zero-padded to at least 4 digits so the column sorts and reads cleanly.

Usage:
  python3 scripts/unify-dates.py datasets/events.csv            # cols date,end_date
  python3 scripts/unify-dates.py datasets/events.csv --columns date,end_date
  python3 scripts/unify-dates.py datasets/events.csv --check    # report only, no write
"""
import argparse, csv, re, sys

BC = re.compile(r"^BC\s+(\d{1,9})$", re.I)
ISO = re.compile(r"^(-?)(\d{1,9})(?:-(\d{2}))?(?:-(\d{2}))?$")


def pad_year(sign, digits):
    return f"{sign}{int(digits):04d}" if len(digits) < 4 else f"{sign}{digits}"


def unify(value):
    """Return (new_value, changed) or raise ValueError on an unparseable date."""
    v = value.strip()
    if not v:
        return "", False
    m = BC.match(v)
    if m:
        return pad_year("-", m.group(1)), True
    m = ISO.match(v)
    if m:
        sign, year, mo, day = m.group(1), m.group(2), m.group(3), m.group(4)
        out = pad_year(sign, year)
        if mo:
            out += f"-{mo}"
            if day:
                out += f"-{day}"
        return out, out != v
    raise ValueError(f"unrecognized date: {value!r}")


def main():
    ap = argparse.ArgumentParser(description="Unify dataset date columns to signed-ISO.")
    ap.add_argument("file")
    ap.add_argument("--columns", default="date,end_date",
                    help="comma-separated date columns (default: date,end_date)")
    ap.add_argument("--check", action="store_true", help="report only, do not write")
    args = ap.parse_args()

    cols = [c.strip() for c in args.columns.split(",") if c.strip()]
    with open(args.file, "rb") as fh:
        eol = "\r\n" if b"\r\n" in fh.read(1 << 16) else "\n"
    with open(args.file, newline="") as fh:
        reader = csv.DictReader(fh)
        fields = reader.fieldnames
        rows = list(reader)

    cols = [c for c in cols if c in (fields or [])]
    if not cols:
        sys.exit(f"error: none of the date columns exist. Columns: {fields}")

    changes, errors = [], []
    for i, r in enumerate(rows, 2):
        for c in cols:
            try:
                new, changed = unify(r[c])
            except ValueError as e:
                errors.append(f"{args.file}:{i} {r.get('id','?')} {c}: {e}")
                continue
            if changed:
                changes.append((r.get("id", "?"), c, r[c], new))
                r[c] = new

    for did, c, old, new in changes:
        print(f"{did} | {c} | {old!r} -> {new!r}")
    if errors:
        print("\nERRORS (left untouched):")
        for e in errors:
            print("  ", e)
    print(f"\n{len(changes)} value(s) unified, {len(errors)} error(s)")

    if errors:
        sys.exit(1)
    if args.check:
        print("(--check: no file written)")
        return
    with open(args.file, "w", newline="") as fh:
        w = csv.DictWriter(fh, fieldnames=fields, lineterminator=eol)
        w.writeheader()
        w.writerows(rows)
    print("WRITTEN")


if __name__ == "__main__":
    main()
