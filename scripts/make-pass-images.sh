#!/bin/sh
# Regenerates the monogram artwork in pass/images/. Requires ImageMagick.
# Replace the PNGs with your own artwork (same file names and sizes) if you prefer.
set -eu
cd "$(dirname "$0")/../pass/images"
FONT="${FONT:-/System/Library/Fonts/Supplemental/Arial Bold.ttf}"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

magick -size 512x512 xc: -sparse-color Barycentric '0,0 #007AFF 511,511 #5856D6' "$TMP/bg.png"
magick -size 512x512 xc:none -fill white -draw "roundrectangle 0,0 511,511 112,112" "$TMP/mask.png"
magick "$TMP/bg.png" "$TMP/mask.png" -alpha off -compose CopyOpacity -composite \
  -font "$FONT" -pointsize 220 -fill white -gravity center -annotate +0+8 'ST' "$TMP/master.png"

for spec in 29:icon 58:icon@2x 87:icon@3x 90:thumbnail 180:thumbnail@2x 270:thumbnail@3x 50:logo 100:logo@2x 150:logo@3x; do
  size="${spec%%:*}"
  magick "$TMP/master.png" -resize "${size}x${size}" "${spec##*:}.png"
done
