#!/usr/bin/env python3
"""Make the sample audio: a quiet chord pad with a click on every beat, one file per sample song.

The board needs some audio to show the timeline, the playhead and the version switcher.
These files are generated here (no recording, no third-party material), so they carry no
rights questions. Replace them with your own rehearsal audio; see README "Add songs and videos".
Usage: python3 tools/make-sample-audio.py   (needs numpy and ffmpeg)
"""
import subprocess
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
SR = 22050
# file name, seconds (matches the cue times in stage-cues.json), bpm, root note (Hz), with a melody line
TRACKS = [
    ('ngo-mou-hok-waai', 200, 70, 110.0, False),
    ('forgotten-dream-pop', 213, 76, 98.0, False),
    ('floor-breathing', 172, 84, 123.5, False),
    ('saudade-do-teu-olhar', 205, 66, 87.3, False),
    ('le-dernier-bal', 200, 72, 103.8, False),
    ('slow-dying-keep-instrumental', 227, 60, 92.5, False),
    ('slow-dying-keep-vocals', 227, 60, 92.5, True),
]
CHORD = [1.0, 6 / 5, 3 / 2, 9 / 5]          # minor seventh stack
PROG = [1.0, 4 / 3, 9 / 8, 6 / 5]           # root moves every two bars


def render(sec, bpm, root, melody):
    t = np.arange(int(sec * SR)) / SR
    beat = 60.0 / bpm
    bar = beat * 4
    out = np.zeros_like(t)
    seg = (t // (bar * 2)).astype(int) % len(PROG)
    for i, mul in enumerate(PROG):
        m = seg == i
        for k, c in enumerate(CHORD):
            f = root * mul * c
            out[m] += (0.06 / (1 + 0.3 * k)) * np.sin(2 * np.pi * f * t[m] + 0.7 * k)
    out *= 0.75 + 0.25 * np.sin(2 * np.pi * t / (bar * 4))       # slow swell
    ph = (t % beat) / beat
    first = ((t // beat).astype(int) % 4 == 0)
    freq = np.where(first, 1500.0, 1000.0)
    out += 0.035 * np.exp(-ph * 55) * np.sin(2 * np.pi * freq * t)
    if melody:
        step = (t // beat).astype(int) % 8
        degree = np.array([0, 2, 4, 2, 3, 2, 1, 0])[step]
        f = root * 4 * (2 ** (np.array([0, 3, 7, 10, 12])[np.minimum(degree, 4)] / 12.0))
        env = np.exp(-((t % beat) / beat) * 3)
        out += 0.05 * env * np.sin(2 * np.pi * f * t)
    fade = np.minimum(1, np.minimum(t / 1.5, (sec - t) / 3.0))
    return (out * fade).astype(np.float32)


def main():
    outdir = ROOT / 'media' / 'music'
    outdir.mkdir(parents=True, exist_ok=True)
    for name, sec, bpm, root, melody in TRACKS:
        pcm = (np.clip(render(sec, bpm, root, melody), -1, 1) * 32767).astype('<i2').tobytes()
        dst = outdir / f'{name}.mp3'
        subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 's16le', '-ar', str(SR), '-ac', '1', '-i', '-',
                        '-map_metadata', '-1', '-c:a', 'libmp3lame', '-b:a', '64k', str(dst)],
                       input=pcm, check=True)
        print(dst.relative_to(ROOT), f'{sec}s {bpm}bpm')


if __name__ == '__main__':
    main()
