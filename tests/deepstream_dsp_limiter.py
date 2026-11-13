#!/usr/bin/env python3
"""Exercise the actual limiter expression on generated PCM; no device or media files."""
import argparse
import math
from pathlib import Path
import re
import struct
import subprocess

parser = argparse.ArgumentParser()
parser.add_argument('--ffmpeg', required=True)
parser.add_argument('--source', type=Path, required=True)
args = parser.parse_args()
source = (args.source / 'src/player/PlayerComponentAudioEnhancement.inc').read_text()
match = re.search(r'QStringLiteral\("(alimiter=[^\"]+)"\)', source)
if not match:
    raise SystemExit('Native limiter expression missing')
graph = match.group(1)
rate = 48000

def render(samples):
    payload = struct.pack('<%sf' % len(samples), *samples)
    result = subprocess.run([args.ffmpeg, '-hide_banner', '-loglevel', 'error',
        '-f', 'f32le', '-ar', str(rate), '-ac', '1', '-i', 'pipe:0', '-af', graph,
        '-f', 'f32le', 'pipe:1'], input=payload, stdout=subprocess.PIPE,
        stderr=subprocess.PIPE, check=True)
    return struct.unpack('<%sf' % (len(result.stdout) // 4), result.stdout)

samples = [0.0] * (rate * 2)
samples[rate // 2] = 0.5
out = render(samples)
peak_index = max(range(len(out)), key=lambda i: abs(out[i]))
delay_ms = (peak_index - rate // 2) * 1000 / rate
if abs(delay_ms) > 1.0:
    raise SystemExit('Limiter impulse offset exceeded 1 ms: %.3f ms' % delay_ms)

loud = [1.4 * math.sin(2 * math.pi * 1000 * i / rate) for i in range(rate * 2)]
peak = max(abs(sample) for sample in render(loud))
if peak > 0.892:
    raise SystemExit('Limiter sample peak exceeded target: %.5f' % peak)
print('Generated PCM: limiter delay %.3f ms, sample peak %.5f; no output device.' % (delay_ms, peak))
