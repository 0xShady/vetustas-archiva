#!/usr/bin/env python3
"""Find dead image URLs across the dataset CSVs.
"""
import argparse, csv, glob, json, os, sys, time
from concurrent.futures import ThreadPoolExecutor
from urllib.request import Request, urlopen
from urllib.error import HTTPError, URLError

DATASETS_GLOB = os.path.join(os.path.dirname(__file__), "..", "..", "datasets", "*.csv")

IMAGE_COLS = ("poster", "cover", "crest", "logo", "image")
LABEL_COLS = ("name", "title")

UA = "vetustas-archiva-imgcheck/1.0 (+https://vetustas.net)"


def label_col(fields):
    for c in LABEL_COLS:
        if c in fields:
            return c
    return None


def image_cols(fields):
    return [c for c in IMAGE_COLS if c in fields]


OK, DEAD, INCONCLUSIVE = "ok", "dead", "inconclusive"

DEAD_CODES = {404, 410}


def _attempt(url, method, timeout):
    """One request. Returns (verdict, status). Raises nothing."""
    req = Request(url, method=method, headers={
        "User-Agent": UA,
        "Accept": "image/*,*/*",
        **({"Range": "bytes=0-0"} if method == "GET" else {}),
    })
    try:
        with urlopen(req, timeout=timeout) as resp:
            code = resp.getcode()
            ctype = (resp.headers.get("Content-Type") or "").lower()
            if ctype and not ctype.startswith("image/") and "octet-stream" not in ctype:
                return DEAD, f"{code} {ctype.split(';')[0]}"
            return OK, code
    except HTTPError as e:
        if e.code in DEAD_CODES:
            return DEAD, e.code
        retry_after = e.headers.get("Retry-After") if e.headers else None
        return INCONCLUSIVE, (e.code, retry_after)
    except (URLError, TimeoutError) as e:
        return INCONCLUSIVE, (getattr(e, "reason", e), None)
    except Exception as e:
        return INCONCLUSIVE, (e, None)


def probe(url, timeout, retries):
    """Return (verdict, status). DEAD only on a definitive 404/410/non-image;
    429/timeouts/connection errors stay INCONCLUSIVE after retries (with backoff)."""
    last = "unknown"
    for attempt in range(retries + 1):
        for method in ("HEAD", "GET"):
            verdict, status = _attempt(url, method, timeout)
            if verdict in (OK, DEAD):
                return verdict, status
            code, retry_after = status
            last = code
            if method == "HEAD" and code in (403, 405, 501):
                continue
        if attempt < retries:
            wait = 2.0 * (attempt + 1)
            try:
                if retry_after is not None:
                    wait = max(wait, float(retry_after))
            except (TypeError, ValueError):
                pass
            time.sleep(min(wait, 30))
    return INCONCLUSIVE, str(last)


def collect(files):
    """Yield (file, line_no, id, label, col, url) for every image URL present."""
    for path in files:
        with open(path, newline="", encoding="utf-8") as fh:
            reader = csv.DictReader(fh)
            fields = reader.fieldnames or []
            lcol = label_col(fields)
            icols = image_cols(fields)
            if not icols:
                continue
            for i, row in enumerate(reader, start=2):
                for col in icols:
                    url = (row.get(col) or "").strip()
                    if url.startswith("http"):
                        yield (
                            os.path.basename(path),
                            i,
                            (row.get("id") or "").strip(),
                            (row.get(lcol) or "").strip() if lcol else "",
                            col,
                            url,
                        )


def main():
    ap = argparse.ArgumentParser(description="Report dead image URLs in the datasets.")
    ap.add_argument("files", nargs="*", help="CSV files (default: all datasets)")
    ap.add_argument("--workers", type=int, default=8, help="concurrent requests (default 8; keep low for throttling hosts)")
    ap.add_argument("--timeout", type=float, default=12, help="per-request timeout seconds (default 12)")
    ap.add_argument("--retries", type=int, default=3, help="retries on transient errors, with backoff (default 3)")
    ap.add_argument("--json", action="store_true", help="machine-readable output")
    ap.add_argument("--inconclusive", action="store_true",
                    help="also report rate-limited/timeout/blocked URLs (hidden by default)")
    args = ap.parse_args()

    files = args.files or sorted(glob.glob(DATASETS_GLOB))
    items = list(collect(files))
    if not items:
        print("No image URLs found.", file=sys.stderr)
        return

    def check(item):
        verdict, status = probe(item[5], args.timeout, args.retries)
        return (verdict, (*item, status))

    dead, inconclusive = [], []
    count = 0
    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        for verdict, row in pool.map(check, items):
            count += 1
            if verdict == DEAD:
                dead.append(row)
            elif verdict == INCONCLUSIVE:
                inconclusive.append(row)
            print(f"\r>{count}/{len(items)}\n", end="", file=sys.stderr, flush=True)
    print("", file=sys.stderr)

    dead.sort(key=lambda r: (r[0], r[1]))
    inconclusive.sort(key=lambda r: (r[0], r[1]))

    def fmt(rows):
        for f, line, rid, label, col, url, status in rows:
            print(f"  {f}  line {line}  [{status}]")
            print(f"    id:    {rid}")
            print(f"    name:  {label}")
            print(f"    {col}: {url}\n")

    if args.json:
        keys = ("file", "line", "id", "label", "column", "url", "status")
        out = {"dead": [dict(zip(keys, d)) for d in dead]}
        if args.inconclusive:
            out["inconclusive"] = [dict(zip(keys, d)) for d in inconclusive]
        print(json.dumps(out, indent=2, ensure_ascii=False, default=str))
    else:
        print(f"\nChecked {len(items)} image URLs across {len(files)} file(s).")
        if not dead:
            print("No dead image URLs (404/410/non-image). ✓")
        else:
            print(f"\n{len(dead)} DEAD image URL(s) — these no longer exist:\n")
            fmt(dead)
        if inconclusive and args.inconclusive:
            print(f"{len(inconclusive)} INCONCLUSIVE (rate-limited / timeout / blocked — "
                  f"rerun with --workers 4 --retries 5 to confirm):\n")
            fmt(inconclusive)
        elif inconclusive:
            print(f"({len(inconclusive)} inconclusive hidden — pass --inconclusive to show.)")

    sys.exit(1 if dead else 0)


if __name__ == "__main__":
    main()
