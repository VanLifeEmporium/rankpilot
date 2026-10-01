#!/usr/bin/env bash
# Rebuild the full RankPilot source tree the same way the Dockerfile does: extract the tarball, then
# apply every "COPY patches/..." line in order. Use it to run `shopify app deploy` for the theme app
# extension (Render deploys only the web app). Usage: tools/reconstruct.sh [target-dir]
set -euo pipefail
cd "$(dirname "$0")/.."
target="${1:-rankpilot-app}"
rm -rf "$target" && mkdir -p "$target"
tar -xzf rankpilot-source.tar.gz --strip-components=1 -C "$target"
grep -E '^COPY patches/' Dockerfile | while read -r _ src dst; do
  dst="${dst/#\/app/$target}"
  if [[ "$src" == */ ]]; then mkdir -p "$dst"; cp -R "$src". "$dst"; else mkdir -p "$(dirname "$dst")"; cp "$src" "$dst"; fi
done
echo "Source tree ready in $target (extension: $target/extensions/rankpilot-schema)"
