#!/usr/bin/env bash
# Synthetic sample videos for the seed and the demo (ADR 0018): generated patterns only, no people, no third-party
# footage. Small (8-10 s, 480x270, H.264 baseline, no audio) so they ship in the repo.
set -euo pipefail
out="$(dirname "$0")/../apps/web/public/demo-videos"
mkdir -p "$out"
enc=(-c:v libx264 -profile:v baseline -level 3.0 -pix_fmt yuv420p -preset veryslow -crf 34 -movflags +faststart -an)
ffmpeg -y -loglevel error -f lavfi -i "testsrc2=size=480x270:rate=24:duration=10" "${enc[@]}" "$out/colour-shapes.mp4"
ffmpeg -y -loglevel error -f lavfi -i "mandelbrot=size=480x270:rate=24:end_scale=0.6" -t 10 "${enc[@]}" "$out/spiral-zoom.mp4"
ffmpeg -y -loglevel error -f lavfi -i "cellauto=rule=18:size=160x90:rate=8:scroll=1" -t 8 -vf "scale=480:270:flags=neighbor,format=yuv420p,colorchannelmixer=rr=0.36:gg=0.29:bb=0.86" "${enc[@]}" "$out/growing-dots.mp4"
ls -la "$out"
