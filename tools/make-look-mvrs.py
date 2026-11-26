#!/usr/bin/env python3
"""由 tools/looks.json 產生測試用「燈光 look」MVR：燈位同 base 檔一樣，每支燈加 Color（xyY）同 Dimmer。
3D 網格（.3ds）冇放入（板只讀 XML；大細由 2.6 MB 變成約 0.3 MB）。
用法：python3 tools/make-look-mvrs.py   然後 python3 tools/mvr-index.py 更新選單
"""
import json, re, zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SPEC = json.loads((ROOT / 'tools' / 'looks.json').read_text(encoding='utf-8'))
MAP = json.loads((ROOT / 'lighting' / 'mvr-map.json').read_text(encoding='utf-8'))
XML = 'GeneralSceneDescription.xml'


def group_of(spec_text):
    for r in MAP['groupRules']:
        if any(re.search(p, spec_text, re.I) for p in r.get('anyOf', [])):
            return r['group']
    return MAP['defaultGroup']


def hex_rgb(h):
    return [int(h[i:i + 2], 16) / 255 for i in (1, 3, 5)]


def lerp_stops(stops, t):
    t = min(1, max(0, t)) * (len(stops) - 1)
    i = min(int(t), len(stops) - 2)
    a, b = hex_rgb(stops[i]), hex_rgb(stops[i + 1])
    f = t - i
    return [a[k] + (b[k] - a[k]) * f for k in range(3)]


def rgb_xy(rgb):
    lin = [c / 12.92 if c <= 0.04045 else ((c + 0.055) / 1.055) ** 2.4 for c in rgb]
    X = 0.4124 * lin[0] + 0.3576 * lin[1] + 0.1805 * lin[2]
    Y = 0.2126 * lin[0] + 0.7152 * lin[1] + 0.0722 * lin[2]
    Z = 0.0193 * lin[0] + 0.1192 * lin[1] + 0.9505 * lin[2]
    s = X + Y + Z or 1
    return X / s, Y / s


def main():
    src = zipfile.ZipFile(ROOT / 'lighting' / SPEC['base'])
    xml = src.read(XML).decode('utf-8')
    keep = [(i.filename, src.read(i.filename)) for i in src.infolist() if i.filename.lower().endswith('.gdtf')]
    blocks = list(re.finditer(r'<Fixture\b.*?</Fixture>', xml, re.S))
    info = []
    for m in blocks:
        b = m.group(0)
        spec = re.search(r'<GDTFSpec>([^<]*)</GDTFSpec>', b)
        mode = re.search(r'<GDTFMode>([^<]*)</GDTFMode>', b)
        mat = re.search(r'\{([-\d.eE+]+),([-\d.eE+]+),([-\d.eE+]+)\}\s*</Matrix>', b)
        info.append({'group': group_of((spec.group(1) if spec else '') + ' ' + (mode.group(1) if mode else '')), 'x': float(mat.group(1)) / 1000 if mat else 0.0})
    xs = [i['x'] for i in info]
    lo, hi = min(xs), max(xs)
    for look in SPEC['looks']:
        out, last, k = [], 0, 0
        for m, inf in zip(blocks, info):
            rule = look[inf['group']]
            if 'gradient' in rule:
                rgb = lerp_stops(rule['gradient'], (inf['x'] - lo) / ((hi - lo) or 1))
            else:
                rgb = hex_rgb(rule['color'])
            x, y = rgb_xy(rgb)
            b = m.group(0)
            b = re.sub(r'(</Addresses>)', r'\1\n<CustomCommands><CustomCommand>Beam_Dimmer.Dimmer.Dimmer,f %.6f</CustomCommand></CustomCommands>' % (rule['level'] * 100), b, count=1)
            color = f'<Color>{x:.6f},{y:.6f},100.000000</Color>'
            b = re.sub(r'(</UnitNumber>)', r'\1\n' + color, b, count=1) if '</UnitNumber>' in b else b.replace('</Fixture>', color + '</Fixture>')
            out.append(xml[last:m.start()]); out.append(b); last = m.end()
        out.append(xml[last:])
        path = ROOT / 'lighting' / look['file']
        with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
            z.writestr(XML, ''.join(out))
            for name, data in keep:
                z.writestr(name, data)
        print('wrote', path.relative_to(ROOT), path.stat().st_size, 'bytes')


if __name__ == '__main__':
    main()
