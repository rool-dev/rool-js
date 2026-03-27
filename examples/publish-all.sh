#!/usr/bin/env bash
set -euo pipefail

ENV_FLAG=""
if [[ "${1:-}" == "-e" ]]; then
  ENV_FLAG="-e ${2:?missing environment after -e (dev or prod)}"
fi

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for dir in "$SCRIPT_DIR"/*/; do
  [ -f "$dir/manifest.json" ] || continue
  name="$(basename "$dir")"
  echo "==> Publishing $name $ENV_FLAG"
  (cd "$dir" && rool extension publish $ENV_FLAG)
done

echo "Done."
