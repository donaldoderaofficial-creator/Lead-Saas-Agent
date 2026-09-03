#!/usr/bin/env bash
set -euo pipefail

iterations="${HARNESS_ITERATIONS:-1}"
if [[ "$iterations" =~ ^[0-9]+$ ]] && (( iterations >= 1 && iterations <= 5 )); then
  :
else
  echo 'HARNESS_ITERATIONS must be an integer from 1 to 5' >&2
  exit 2
fi

for ((iteration = 1; iteration <= iterations; iteration++)); do
  echo "Harness iteration ${iteration}/${iterations}"
  npm run check
  node --test
  git diff --check
done

echo 'Engineering harness passed.'
