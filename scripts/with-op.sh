#!/bin/sh
# Runs a command with the op:// references of .env resolved by the 1Password CLI.
# Without references (CI, containers, plain values) the command runs as is.
set -eu

[ -f .env ] && grep -q 'op://' .env || exec "$@"
command -v op >/dev/null || { echo ".env has op:// references: install the 1Password CLI (op) first." >&2; exit 1; }
exec op run --env-file=.env -- "$@"
