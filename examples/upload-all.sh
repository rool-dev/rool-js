#!/usr/bin/env bash
set -euo pipefail

ENV_FLAG=""
PUBLISH_FLAG=""

while [[ $# -gt 0 ]]; do
  case "$1" in
    -e)
      ENV_FLAG="-e ${2:?missing environment after -e (dev or prod)}"
      shift 2
      ;;
    -p|--publish)
      PUBLISH_FLAG="--publish"
      shift
      ;;
    *)
      echo "Unknown argument: $1" >&2
      echo "Usage: $0 [-e dev|prod] [-p|--publish]" >&2
      exit 1
      ;;
  esac
done

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"

for dir in "$SCRIPT_DIR"/*/; do
  [ -f "$dir/manifest.json" ] || continue
  name="$(basename "$dir")"
  echo "==> Uploading $name $ENV_FLAG $PUBLISH_FLAG"
  (cd "$dir" && rool extension upload $ENV_FLAG $PUBLISH_FLAG)
done

echo "Done."
