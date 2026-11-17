#!/usr/bin/env bash
# Downloads the generic demo photos (Unsplash / Pexels, free commercial use) into a work directory.
# Usage: scripts/fetch-demo-sources.sh <output-dir>   then   node scripts/build-demo-images.mjs <output-dir>
set -euo pipefail
out="${1:?output directory required}"
mkdir -p "$out"

u() { curl -fsS -m 60 -o "$out/$1.jpg" "https://images.unsplash.com/photo-$2?w=2000&q=85&fm=jpg&fit=max"; echo "$1"; }
p() { curl -fsS -m 60 -o "$out/$1.jpg" "https://images.pexels.com/photos/$2/pexels-photo-$2.jpeg?auto=compress&cs=tinysrgb&w=2000"; echo "$1"; }

u hero 1566073771259-6a8506099945
u exterior 1455587734955-081b22074882
u pool 1551882547-ff40c63fe5fa
u lagoon 1519046904884-53103b34b206
u room-classic 1618773928121-c32242e63f39
p room-deluxe 262048
u suite 1578683010236-d716f9a3f461
u bathroom 1620626011761-996317b8d101
u dish 1504674900247-0877df9cc836
u restaurant 1559339352-11d035aa65de
u bar 1514933651103-005eec06c04b
u spa 1540555700478-4be289fbecef
u snorkel 1544551763-77ef2d0cfc6c
p lobby 2507010
u garden 1522798514-97ceb8c4f1c8
