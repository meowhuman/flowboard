#!/usr/bin/env python3
'''場地選單：由基準舞台圖縮放出多個場地，寫入 stage-plans.json（dry-run 預設；--apply 先備份再寫）。

用法：
  python3 -I tools/add-venues.py [--venues tools/venues.default.json] [--stage-plans stage-plans.json] [--apply]

規則：
- 基準 = plans 第一張（id 不變，標題改成 baseTitle）；之前由本工具生成嘅場地（generated:true）先清走再重建，所以可重覆跑。
- 器材位置、燈位、燈 aim、煙霧機位置、台面 platforms 按 stage 闊深等比縮放；燈高按房高縮（有 room 時）。
- 場地定義喺 venues.default.json，唔寫死喺程式。
'''
import argparse
import copy
import datetime
import json
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
BASE_H = 10.24  # 基準場地房高（the sample black box），冇 room.h 時用


def rel(p: pathlib.Path) -> str:
    try:
        return str(p.resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


def scaled_plan(base: dict, lighting: dict, v: dict) -> dict:
    bs, ns = base['stage'], v['stage']
    sx, sy = ns['w'] / bs['w'], ns['d'] / bs['d']
    room = v.get('room')
    sh = (room['h'] / BASE_H) if room and room.get('h') else 1.0
    p = copy.deepcopy(base)
    p.update({'id': v['id'], 'title': v['title'], 'venue': v['venue'], 'stage': ns, 'generated': True})
    if room is None:
        p.pop('room', None)
    else:
        p['room'] = room
    for it in p.get('items', []):
        it['x'] = round(it['x'] * sx, 3)
        it['y'] = round(it['y'] * sy, 3)
    for pf in p.get('platforms', []):
        pf['x'] = round(pf['x'] * sx, 3)
        pf['y'] = round(pf['y'] * sy, 3)
    lt = copy.deepcopy(lighting)
    for f in lt['rig']['fixtures']:
        f['x'] = round(f['x'] * sx, 3)
        f['y'] = round(f['y'] * sy, 3)
        f['h'] = round(f['h'] * sh, 3)
        f['aim'] = [round(f['aim'][0] * sx, 3), round(f['aim'][1] * sy, 3), f['aim'][2]]
    for pos in lt.get('fog', {}).get('positions', {}).values():
        pos['x'] = round(pos['x'] * sx, 3)
        pos['y'] = round(pos['y'] * sy, 3)
    sp = lt.get('spots')
    if sp:
        sp['hangY'] = round(sp['hangY'] * sy, 3)
        sp['hangH'] = round(sp['hangH'] * sh, 3)
    p['lighting'] = lt
    return p


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument('--venues', default=str(ROOT / 'tools' / 'venues.default.json'))
    ap.add_argument('--stage-plans', default=str(ROOT / 'stage-plans.json'))
    ap.add_argument('--apply', action='store_true')
    a = ap.parse_args()
    sp_path = pathlib.Path(a.stage_plans)
    data = json.loads(sp_path.read_text(encoding='utf-8'))
    cfg = json.loads(pathlib.Path(a.venues).read_text(encoding='utf-8'))
    plans = [p for p in data['plans'] if not p.get('generated')]
    if not plans:
        sys.exit('[ERROR] stage-plans.json 冇基準舞台圖')
    base = plans[0]
    if cfg.get('baseTitle'):
        base['title'] = cfg['baseTitle']
    data['plans'] = plans + [scaled_plan(base, data['lighting'], v) for v in cfg['venues']]
    print(f"{rel(sp_path)}: base '{base['id']}' + {len(cfg['venues'])} venues")
    for p in data['plans']:
        st = p['stage']
        print(f"  {p['id']:6} {st['w']}x{st['d']} m  room={'yes' if p.get('room') else 'no'}  items={len(p['items'])}  {p['title']}")
    if not a.apply:
        print('dry-run only (use --apply to write)')
        return
    bak = sp_path.with_suffix('.json.bak-' + datetime.datetime.now().strftime('%Y%m%d-%H%M%S'))
    shutil.copy2(sp_path, bak)
    sp_path.write_text(json.dumps(data, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print('written; backup', rel(bak))


if __name__ == '__main__':
    main()
