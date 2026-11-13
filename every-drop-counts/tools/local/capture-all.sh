#!/usr/bin/env bash
# Real-time capture batch for LOCAL-REPORT-1 (visual review + Steam material). RX 9070 XT, vsync on.
set -u
cd "$(dirname "$0")"
C="node capture.mjs"
$C --run 1  --out s1      --video --secs 40 --shots 6,14,22,30,38 --clean
$C --run 3  --out s3      --video --secs 45 --fft 25 --shots 8,18,28,38 --clean
$C --run 5  --out s5      --video --secs 45 --shots 10,20,30,40 --clean
$C --run 8  --out s8-late --video --secs 50 --fft 45 --shots 10,20,30,40,48 --clean
$C --run ot --out ot-late --video --secs 45 --ffbodies 380 --shots 10,20,30,40 --clean
$C --run 2  --out spinup  --video --secs 29 --spinup --policy idle
$C --run 7  --out green   --secs 40 --blood green --shots 20,30,38 --clean
$C --run 2  --out flash-on  --video --secs 30
$C --run 2  --out flash-off --video --secs 30 --reduce-flashing
for q in low medium high; do $C --run 7 --out q-$q --quality $q --secs 36 --shots 35 --clean; done
echo CAPTURE-ALL-DONE
