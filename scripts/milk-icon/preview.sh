#!/usr/bin/env bash
# Renders the milk-glass icons at real sizes into a preview sheet: bash scripts/milk-icon/preview.sh <dir>
set -e
P="$1"; mkdir -p "$P"
python3 "$(dirname "$0")/generate.py" "$P"
cd "$P"
for s in 240 48 24; do
  inkscape stat.svg -w $s -h $s -o stat_$s.png >/dev/null 2>&1
  inkscape large.svg -w $s -h $s -o large_$s.png >/dev/null 2>&1
done
convert stat_48.png -filter point -resize 200% s48.png
convert stat_24.png -filter point -resize 400% s24.png
convert stat_240.png large_240.png +append top.png
convert s48.png s24.png -background '#202124' +append bottom.png
convert top.png bottom.png -background '#202124' -gravity west -append preview.png
echo "$P/preview.png"
