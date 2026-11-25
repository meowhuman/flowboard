#!/usr/bin/env python3
'''產生兩個自製示範 MVR（燈位示範用，唔係真實演出嘅燈圖）：小型 club rig、劇場 rig。
座標跟 lighting/mvr-map.json：board x = MVR x，board y = MVR y + 8000（mm），燈高 = MVR z。
用法：python3 tools/make-sample-mvr.py   （寫入 lighting/*.mvr）
'''
import pathlib
import uuid
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / 'lighting'
HEAD = ('<?xml version="1.0" encoding="UTF-8"?>\n<GeneralSceneDescription verMajor="1" verMinor="5">\n'
        '<Scene><Layers>\n')
TAIL = '</Layers></Scene>\n</GeneralSceneDescription>\n'


def fixture(name, spec, x, y, z, fid):
    m = '{1,0,0}{0,1,0}{0,0,1}{%d,%d,%d}' % (x, y, z)
    return (f'<Fixture uuid="{uuid.uuid5(uuid.NAMESPACE_URL, f"{name}-{fid}")}" name="{name}">'
            f'<Matrix>{m}</Matrix><GDTFSpec>{spec}</GDTFSpec><GDTFMode>Default</GDTFMode>'
            f'<FixtureID>{fid}</FixtureID><UnitNumber>{fid}</UnitNumber></Fixture>\n')


def build(path, layers):
    xml = HEAD
    fid = 1
    for lname, items in layers:
        xml += f'<Layer uuid="{uuid.uuid5(uuid.NAMESPACE_URL, lname)}" name="{lname}"><ChildList>\n'
        for name, spec, x, y, z in items:
            xml += fixture(name, spec, x, y, z, fid)
            fid += 1
        xml += '</ChildList></Layer>\n'
    xml += TAIL
    with zipfile.ZipFile(path, 'w', zipfile.ZIP_DEFLATED) as z:
        z.writestr('GeneralSceneDescription.xml', xml)
    print(path.name, fid - 1, 'fixtures')


def bar(name, spec, n, x0, x1, y, z):
    return [(name, spec, round(x0 + (x1 - x0) * i / max(1, n - 1)), y, z) for i in range(n)]


def main():
    build(OUT / 'small-club-rig.mvr', [
        ('Front bar', bar('LED PAR 64 RGBW', 'LED PAR 64 RGBW.gdtf', 6, -3500, 3500, -1500, 4200)),
        ('Back bar', bar('Wash Beam 1', 'WashBeam.gdtf', 4, -3000, 3000, -6500, 4600)),
        ('Follow', bar('Robin MMX Spot', 'Robin MMX Spot.gdtf', 2, -2500, 2500, 2500, 5000)),
    ])
    build(OUT / 'theatre-rig.mvr', [
        ('Front of house', bar('LED PAR 64 RGBW', 'LED PAR 64 RGBW.gdtf', 10, -6000, 6000, 2000, 6000)),
        ('Mid bar', bar('Alpha Spot QWO 800', 'Alpha Spot QWO 800.gdtf', 8, -6500, 6500, -2500, 6500)),
        ('Back truss', bar('ALC4 Backlight', 'ALC4.gdtf', 10, -7000, 7000, -7000, 6200)),
        ('Follow', bar('Robin MMX Spot', 'Robin MMX Spot.gdtf', 4, -4500, 4500, 3500, 6800)),
    ])


if __name__ == '__main__':
    main()
