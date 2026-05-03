#!/usr/bin/env bash
# Seed infra/space/ from infra/space-seed/ on first run.
# Refuses to clobber a non-empty space.
set -euo pipefail

cd "$(dirname "$0")"

if [ -d "space" ] && [ -n "$(ls -A space 2>/dev/null)" ]; then
  echo "infra/space/ is not empty — refusing to overwrite."
  echo "Move or remove it first if you want to re-seed."
  exit 1
fi

mkdir -p space
cp -r space-seed/. space/
echo "Seeded infra/space/ from infra/space-seed/"
