#!/usr/bin/env python3
"""由 sample 音訊產生 demo 資料：songs.json、stage-cues.json、form chart（SVG）、影片清單。

段落分界：有歌詞檔嘅歌用歌詞段落標籤（按行數分配時間）；其餘用音量變化偵測（energy novelty）。
上台名單按每段音量高低分三級；呢啲只係示範資料，用家自己改成真實編排。
用法：python3 tools/make-demo-data.py [--lyrics <suno prompt md>]
"""
import argparse, json, math, re, subprocess, sys
from pathlib import Path

import numpy as np

ROOT = Path(__file__).resolve().parent.parent
CFG = json.loads((ROOT / 'tools' / 'demo-songs.json').read_text(encoding='utf-8'))


def rms_db(path, sr=8000):
    raw = subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', str(sr), '-f', 's16le', '-'],
                         capture_output=True, check=True).stdout
    x = np.frombuffer(raw, dtype='<i2').astype(np.float32) / 32768.0
    n = len(x) // sr
    x = x[: n * sr].reshape(n, sr)
    return 20 * np.log10(np.sqrt((x ** 2).mean(axis=1)) + 1e-6)


def detect_boundaries(db, win, min_sep, max_n):
    sm = np.convolve(db, np.ones(3) / 3, mode='same')
    nov = np.zeros(len(sm))
    for t in range(win, len(sm) - win):
        nov[t] = abs(sm[t:t + win].mean() - sm[t - win:t].mean())
    picks = []
    for t in np.argsort(-nov):
        if nov[t] < CFG['segmenter']['minNovelty']:
            break
        if all(abs(t - p) >= min_sep for p in picks) and win <= t <= len(sm) - min_sep:
            picks.append(int(t))
        if len(picks) >= max_n:
            break
    return sorted(picks)


def parse_lyrics(md_path):
    t = Path(md_path).read_text(encoding='utf-8')
    block = re.search(r'LYRICS\s*```text\n(.*?)```', t, re.S).group(1)
    secs = []
    for line in block.splitlines():
        if line.startswith('['):
            secs.append([line[1:].split('|')[0].strip(), []])
        elif line.strip() and secs:
            secs[-1][1].append(line.strip())
    return secs


def tiers(db, bounds, dur):
    edges = [0] + bounds + [dur]
    means = [float(db[a:b].mean()) for a, b in zip(edges, edges[1:])]
    order = sorted(range(len(means)), key=lambda i: (means[i], i))
    rank = {i: r for r, i in enumerate(order)}
    return edges, [min(2, 3 * rank[i] // len(means)) for i in range(len(means))], means


def form_chart_svg(title, edges, names, tier_list, db):
    w, h, pad = 960, 300, 40
    dur = edges[-1]
    x = lambda t: pad + (w - 2 * pad) * t / dur
    mx, mn = float(db.max()), float(db.min())
    y = lambda v: 200 - 120 * (v - mn) / ((mx - mn) or 1)
    pts = ' '.join(f'{x(i):.1f},{y(v):.1f}' for i, v in enumerate(db))
    colors = ['#8fa9d2', '#d28a69', '#7b1e2e']
    out = [f'<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 {w} {h}" font-family="sans-serif">',
           f'<rect width="{w}" height="{h}" fill="#fbfaf7"/>',
           f'<text x="{pad}" y="26" font-size="18" font-weight="700" fill="#1b1b1d">{title}</text>',
           f'<text x="{w - pad}" y="26" font-size="11" text-anchor="end" fill="#666">Form chart · sections from {CFG["chartSource"]}</text>']
    for i, (a, b) in enumerate(zip(edges, edges[1:])):
        out.append(f'<rect x="{x(a):.1f}" y="60" width="{x(b) - x(a):.1f}" height="150" fill="{colors[tier_list[i]]}" opacity=".16"/>')
        out.append(f'<line x1="{x(a):.1f}" y1="52" x2="{x(a):.1f}" y2="226" stroke="#999" stroke-dasharray="3 3"/>')
        out.append(f'<text x="{(x(a) + x(b)) / 2:.1f}" y="48" font-size="12" text-anchor="middle" fill="#1b1b1d">{names[i]}</text>')
        out.append(f'<text x="{(x(a) + x(b)) / 2:.1f}" y="244" font-size="11" text-anchor="middle" fill="#666">{int(a // 60)}:{int(a % 60):02d}</text>')
    out.append(f'<polyline points="{pts}" fill="none" stroke="#1b1b1d" stroke-width="1.4"/>')
    out.append(f'<text x="{pad}" y="284" font-size="11" fill="#666">Line = loudness (dB). Shading = relative energy (blue low, orange mid, red high).</text></svg>')
    return '\n'.join(out)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--lyrics', help='Suno prompt md（有歌詞段落嘅歌用）')
    args = ap.parse_args()
    seg = CFG['segmenter']
    songs, cues = [], {}
    tier_on = CFG['tierOn']
    for idx, s in enumerate(CFG['songs'], 1):
        num = f'{idx:02d}'
        audio = ROOT / s['audio']
        db = rms_db(audio)
        dur = len(db)
        names = None
        if s.get('lyricsSource') and args.lyrics:
            secs = parse_lyrics(args.lyrics)
            weights = [max(1, len(l)) for _, l in secs]
            tot = sum(weights)
            acc, bounds = 0, []
            for wgt in weights[:-1]:
                acc += wgt
                bounds.append(int(dur * acc / tot))
            names = [n for n, _ in secs]
            s['lyrics'] = {s['lyricsLang']: '\n\n'.join(f'[{n}]\n' + '\n'.join(l) for n, l in secs)}
        else:
            bounds = detect_boundaries(db, seg['window'], seg['minSeparation'], seg['maxBoundaries'])
        edges, tier_list, _ = tiers(db, bounds, dur)
        if names is None:
            names = [f'Section {chr(65 + i)}' for i in range(len(tier_list))]
        top = max(range(len(tier_list)), key=lambda i: tier_list[i] * 1000 + i)
        cl = []
        for i, name in enumerate(names):
            c = {'name': name, 'at': edges[i], 'on': list(tier_on[tier_list[i]]), 'solo': [], 'hl': [],
                 'note': CFG['cueNote']}
            if i == top:
                if s.get('instrumental'):
                    c['solo'] = [CFG['soloItem']]
                else:
                    c['hl'] = [CFG['leadItem']]
            cl.append(c)
        cues[num] = cl
        chart = f'media/charts/{s["slug"]}-form.svg'
        (ROOT / chart).write_text(form_chart_svg(s['title'], edges, names, tier_list, db), encoding='utf-8')
        song = {'number': num, 'title': s['title'], 'section': s['section'], 'credit': s['credit'],
                'notes': s['notes'], 'instrumentation': s['instrumentation'], 'parts': s['parts'],
                'demo': s['audio'], 'demoLabel': s.get('demoLabel', 'mix'), 'charts': {'form': chart}}
        if s.get('bpm'): song['bpm'] = s['bpm']
        if s.get('instrumental'): song['instrumental'] = True
        if s.get('alternates'): song['alternates'] = s['alternates']
        if s.get('lyrics'): song['lyrics'] = s['lyrics']
        songs.append(song)
        print(num, s['title'], f'{dur}s', 'boundaries', bounds, 'tiers', tier_list, file=sys.stderr)
    (ROOT / 'songs.json').write_text(json.dumps(songs + [dict(x) for x in CFG.get('tracks', [])], ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    (ROOT / 'stage-cues.json').write_text(json.dumps({'cues': cues}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    videos = []
    for v in CFG['loops']:
        f = ROOT / 'media' / 'loops' / f'{v["id"]}.mp4'
        videos.append({'filename': v['filename'], 'folder': v['folder'], 'fileId': v['id'],
                       'sizeBytes': f.stat().st_size, 'songNumbers': [f'{i:02d}' for i in range(1, len(songs) + 1)],
                       'matchType': 'section-only'})
    (ROOT / 'source-materials' / 'drive-video-inventory.json').write_text(
        json.dumps({'videos': videos}, ensure_ascii=False, indent=1) + '\n', encoding='utf-8')


main()
