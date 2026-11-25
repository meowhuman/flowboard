#!/usr/bin/env python3
'''重建 lighting/index.json：列出 lighting/ 入面全部 .mvr（板上「燈光檔」選單靠呢個清單，靜態伺服器列唔到資料夾）。
每次放新 .mvr 入 lighting/ 就跑一次：python3 tools/mvr-index.py
已有嘅 title／note 會保留；新檔預設用檔名做標題。
'''
import json
import pathlib
import re
import sys
import zipfile
import xml.etree.ElementTree as ET

ROOT = pathlib.Path(__file__).resolve().parent.parent
DIR = ROOT / 'lighting'
INDEX = DIR / 'index.json'
XML_NAME = 'GeneralSceneDescription.xml'
MAX_XML = 50 * 1024 * 1024


def count_fixtures(path):
    try:
        with zipfile.ZipFile(path) as z:
            info = next((i for i in z.infolist() if i.filename == XML_NAME), None)
            if info is None or info.file_size > MAX_XML:
                return None
            data = z.read(XML_NAME)
        if re.search(rb'<!DOCTYPE|<!ENTITY', data, re.IGNORECASE):
            return None
        return len(list(ET.fromstring(data).iter('Fixture')))
    except (zipfile.BadZipFile, ET.ParseError):
        return None


def main():
    old = {}
    if INDEX.is_file():
        for e in json.loads(INDEX.read_text(encoding='utf-8')).get('files', []):
            old[e['file']] = e
    files = []
    for p in sorted(DIR.glob('*.mvr'), key=lambda x: x.name.lower()):
        n = count_fixtures(p)
        if n is None:
            print(f'[skip] {p.name}：唔係有效 MVR', file=sys.stderr)
            continue
        prev = old.get(p.name, {})
        title = prev.get('title') or p.stem.replace('_', ' ').replace('-', ' ').title()
        files.append({'file': p.name, 'title': title, 'fixtures': n, 'note': prev.get('note', '')})
    INDEX.write_text(json.dumps({'_說明': '板上「燈光檔」選單嘅清單；跑 python3 tools/mvr-index.py 重建。title／note 可手改。', 'files': files},
                                ensure_ascii=False, indent=1) + '\n', encoding='utf-8')
    for f in files:
        print(f"{f['file']:28} {f['fixtures']:4} fixtures  {f['title']}")


if __name__ == '__main__':
    main()
