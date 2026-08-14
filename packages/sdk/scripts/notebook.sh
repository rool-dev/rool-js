#!/bin/sh
set -eu

kernel_prefix="$(mktemp -d)"
trap 'rm -rf "$kernel_prefix"' EXIT

if [ -f .env ]; then
  set -a
  . ./.env
  set +a
fi

uv run --no-project --with jupyterlab python \
  node_modules/tslab/python/install.py \
  --tslab="$PWD/node_modules/.bin/tslab" \
  --prefix="$kernel_prefix"

JUPYTER_PATH="$kernel_prefix/share/jupyter" \
  uv run --no-project --with jupyterlab jupyter lab demo/v2.ipynb "$@"
