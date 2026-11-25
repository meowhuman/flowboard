#!/usr/bin/env python3
'''MVR 匯入：燈光師 .mvr 匯出 → stage-plans.json lighting.rig（dry-run 預設；--apply 先備份再寫）。

用法：
  python3 -I tools/mvr-import.py lighting/capture_demo_show.mvr \
      [--map map.json] [--stage-plans path.json] [--report path.json] [--apply]

安全：只讀 zip 內 GeneralSceneDescription.xml（唔解壓）、拒絕 DOCTYPE/ENTITY、大細上限。
'''
import argparse
import datetime
import json
import math
import pathlib
import re
import shutil
import sys
import xml.etree.ElementTree as ET
import zipfile

ROOT = pathlib.Path(__file__).resolve().parent.parent
DEFAULT_MAP = ROOT / 'lighting' / 'mvr-map.json'
WORK_DIR = ROOT / 'tools' / '.mvr-import'
XML_NAME = 'GeneralSceneDescription.xml'
GROUPS = ('wash', 'back', 'follow')
IDENTITY = {'u': (1.0, 0.0, 0.0), 'v': (0.0, 1.0, 0.0), 'w': (0.0, 0.0, 1.0), 'o': (0.0, 0.0, 0.0)}
DESCEND = {'Scene', 'Layers', 'Layer', 'ChildList', 'GroupObject', 'Fixture', 'FocusPoint'}


def rel(p: pathlib.Path) -> str:
    '''repo 內路徑顯示成相對路徑（唔寫入本機絕對路徑）'''
    try:
        return str(p.resolve().relative_to(ROOT))
    except ValueError:
        return str(p)


def die(msg: str) -> None:
    print(f'[ERROR] {msg}', file=sys.stderr)
    sys.exit(1)


def load_map(path: pathlib.Path) -> dict:
    if not path.is_file():
        die(f'map 檔不存在：{path}')
    m = json.loads(path.read_text())
    need = ('originOffset', 'rotZDeg', 'flipX', 'flipY', 'maxXmlBytes', 'maxZipEntries',
            'stage', 'defaultGroup', 'groupRules', 'groupAim', 'fixtureAims')
    for k in need:
        if k not in m:
            die(f'map 缺少欄位 {k!r}')
    if m['defaultGroup'] not in GROUPS:
        die(f'defaultGroup 要係 {GROUPS} 其中一個，實得 {m["defaultGroup"]!r}')
    for r in m['groupRules']:
        if r.get('group') not in GROUPS:
            die(f'groupRules.group 要係 {GROUPS} 其中一個，實得 {r.get("group")!r}')
        for pat in r.get('anyOf', []):
            try:
                re.compile(pat)
            except re.error as e:
                die(f'groupRules regex 無效 {pat!r}：{e}')
    return m


def parse_matrix(text: str) -> dict:
    nums = re.findall(r'[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?', text or '')
    if len(nums) != 12:
        raise ValueError(f'Matrix 要 4 組各 3 個數，實得 {len(nums)} 個')
    a = [float(n) for n in nums]
    return {'u': a[0:3], 'v': a[3:6], 'w': a[6:9], 'o': a[9:12]}


def mat_mul(P: dict, C: dict) -> dict:
    '''世界 = P(C(x))：C 先，P 後。'''
    def col(vec: tuple) -> tuple:
        return [P['u'][i] * vec[0] + P['v'][i] * vec[1] + P['w'][i] * vec[2] for i in range(3)]
    u, v, w = (col(C['u']), col(C['v']), col(C['w']))
    o = [P['o'][i] + P['u'][i] * C['o'][0] + P['v'][i] * C['o'][1] + P['w'][i] * C['o'][2] for i in range(3)]
    return {'u': tuple(u), 'v': tuple(v), 'w': tuple(w), 'o': tuple(o)}


def mat_apply(m: dict, p: tuple) -> tuple:
    u, v, w, o = m['u'], m['v'], m['w'], m['o']
    return (o[0] + u[0] * p[0] + v[0] * p[1] + w[0] * p[2],
            o[1] + u[1] * p[0] + v[1] * p[1] + w[1] * p[2],
            o[2] + u[2] * p[0] + v[2] * p[1] + w[2] * p[2])


def load_mvr(path: pathlib.Path, m: dict):
    '''返回 (fixtures, focuspoints, warnings)。fixtures 元素 = dict(name, gdftfspec, gdftfmode,
    layer, id 候選, mat 已累乘, in_group, focus_uuid)。'''
    try:
        zf = zipfile.ZipFile(path)
    except zipfile.BadZipFile:
        die(f'唔係 zip 檔（MVR 應係 zip）：{path.name}')
    with zf:
        if len(zf.namelist()) > m['maxZipEntries']:
            die(f'zip 條目數 {len(zf.namelist())} 超過上限 {m["maxZipEntries"]}')
        info = next((i for i in zf.infolist() if i.filename == XML_NAME), None)
        if info is None:
            die(f'zip 內冇 {XML_NAME}（條目：{zf.namelist()[:5]}…）')
        if info.file_size > m['maxXmlBytes']:
            die(f'{XML_NAME} 大細 {info.file_size} 超過上限 {m["maxXmlBytes"]} bytes')
        data = zf.read(XML_NAME)
    try:
        text = data.decode('utf-8')
    except UnicodeDecodeError as e:
        die(f'{XML_NAME} 唔係 UTF-8：{e}')
    if re.search(r'<!DOCTYPE|<!ENTITY', text, re.IGNORECASE):
        die('XML 含 DOCTYPE/ENTITY，拒絕（防 XML bomb）')
    try:
        root = ET.fromstring(data)
    except ET.ParseError as e:
        die(f'XML 解析失敗：{e}')
    if root.tag != 'GeneralSceneDescription':
        die(f'root 標籤應係 GeneralSceneDescription，實得 {root.tag!r}')
    warnings = []
    layers = list(root.iter('Layer'))
    if not layers:
        die('空 Layers（冇 Layer 元素），冇嘢可匯入')
    fixtures = []
    focuspoints = {}

    def own_mat(el):
        mm = el.find('Matrix')
        if mm is None or not (mm.text or '').strip():
            return IDENTITY
        try:
            return parse_matrix(mm.text)
        except ValueError as e:
            warnings.append(f'{el.tag} 嘅 Matrix 格式錯，當 identity：{e}')
            return IDENTITY

    def rec(el, parent_mat, in_group, layer_name):
        tag = el.tag
        if tag in ('Fixture', 'FocusPoint'):
            cm = mat_mul(parent_mat, own_mat(el))
            if tag == 'Fixture':
                if (el.get('multipatch') or '').strip():
                    warnings.append(f'multipatch 子 fixture 唔重複計，略過：{el.get("name", "")!r}')
                    return
                fid = (el.findtext('FixtureID') or '').strip()
                unit = (el.findtext('UnitNumber') or '').strip()
                fixtures.append({
                    'name': el.get('name', ''),
                    'gdftfspec': (el.findtext('GDTFSpec') or '').strip(),
                    'gdftfmode': (el.findtext('GDTFMode') or '').strip(),
                    'layer': layer_name,
                    'fixture_id': fid,
                    'unit_number': unit,
                    'focus': (el.findtext('Focus') or '').strip(),
                    'mat': cm,
                    'in_group': in_group,
                })
            else:
                focuspoints[(el.get('uuid') or '').strip()] = {'name': el.get('name', ''), 'mat': cm}
            return
        if tag == 'GroupObject':
            in_group = True
        cm = mat_mul(parent_mat, own_mat(el)) if tag in ('Layer', 'GroupObject') else parent_mat
        ln = el.get('name', layer_name) if tag == 'Layer' else layer_name
        for ch in el:
            if ch.tag in DESCEND:
                rec(ch, cm, in_group, ln)

    for layer in layers:
        rec(layer, IDENTITY, False, layer.get('name', ''))
    return fixtures, focuspoints, warnings


def align_pos(p_mm: tuple, m: dict) -> tuple:
    off = m['originOffset']
    x = (p_mm[0] - off['x']) / 1000.0
    y = (p_mm[1] - off['y']) / 1000.0
    z = (p_mm[2] - off['z']) / 1000.0
    th = math.radians(m['rotZDeg'])
    c, s = math.cos(th), math.sin(th)
    x, y = c * x - s * y, s * x + c * y
    if m['flipX']:
        x = -x
    if m['flipY']:
        y = -y
    return (x, y, z)


def align_dir(v: tuple, m: dict) -> tuple:
    x, y, _ = v
    th = math.radians(m['rotZDeg'])
    c, s = math.cos(th), math.sin(th)
    x, y = c * x - s * y, s * x + c * y
    if m['flipX']:
        x = -x
    if m['flipY']:
        y = -y
    return (x, y, v[2])


def assign_group(fx: dict, m: dict):
    sources = [s for s in (fx['gdftfspec'], fx['layer'], fx['gdftfmode']) if s]
    for r in m['groupRules']:
        for pat in r.get('anyOf', []):
            rx = re.compile(pat, re.IGNORECASE)
            if any(rx.search(s) for s in sources):
                return r['group'], True
    return m['defaultGroup'], False


def unique_id(base: str, used: set) -> str:
    if base not in used:
        used.add(base)
        return base
    i = 2
    while f'{base}-{i}' in used:
        i += 1
    used.add(f'{base}-{i}')
    return f'{base}-{i}'


def convert(fixtures, focuspoints, m, known_groups) -> dict:
    '''返回 {fixtures: [...], warnings: [...], stats: {...}}。'''
    out = []
    warnings = []
    used_ids = set()
    aim_stats = {'focus': 0, 'map': 0, 'ray': 0, 'group-default': 0}
    unmatched = []
    for idx, fx in enumerate(fixtures, 1):
        pos = align_pos(fx['mat']['o'], m)
        group, matched = assign_group(fx, m)
        if group not in known_groups:
            warnings.append(f'group {group!r} 唔喺 rig.groups，照寫（board 會忽略呢支燈）')
        if not matched:
            unmatched.append(fx['name'] or fx['fixture_id'] or f'#{idx}')
        raw_id = fx['fixture_id'] or fx['unit_number'] or fx['name'] or f'fx-{idx:03d}'
        fid = unique_id(str(raw_id), used_ids)
        aim, source = None, None
        fp = focuspoints.get(fx['focus']) if fx['focus'] else None
        if fp is not None:
            aim = align_pos(fp['mat']['o'], m)
            source = 'focus'
        else:
            aim = m['fixtureAims'].get(fx['fixture_id']) or m['fixtureAims'].get(fx['unit_number']) \
                or m['fixtureAims'].get(fx['name'])
            if aim:
                aim, source = tuple(aim), 'map'
        if source is None:
            beam = align_dir((-fx['mat']['w'][0], -fx['mat']['w'][1], -fx['mat']['w'][2]), m)
            if beam[2] < -0.05 and pos[2] > 0:
                t = -pos[2] / beam[2]
                aim = (pos[0] + t * beam[0], pos[1] + t * beam[1], 0.0)
                source = 'ray'
        if source is None:
            gaim = m['groupAim'].get(group)
            if gaim:
                aim, source = tuple(gaim), 'group-default'
            else:
                aim, source = (pos[0], pos[1], 0.0), 'group-default'
                warnings.append(f'{fid}：group {group!r} 冇 groupAim，aim 用燈位正下方')
        aim_stats[source] += 1
        out.append({
            'id': fid,
            'group': group,
            'x': round(pos[0], 3),
            'y': round(pos[1], 3),
            'h': round(pos[2], 3),
            'aim': [round(aim[0], 3), round(aim[1], 3), round(aim[2], 3)],
            '_aimSource': source,
            '_name': fx['name'],
            '_spec': fx['gdftfspec'],
            '_layer': fx['layer'],
            '_inGroup': fx['in_group'],
        })
    stats = {
        'total': len(out),
        'nested': sum(1 for f in out if f['_inGroup']),
        'groups': {g: sum(1 for f in out if f['group'] == g) for g in GROUPS},
        'aimSources': aim_stats,
        'unmatched': unmatched,
    }
    return {'fixtures': out, 'warnings': warnings, 'stats': stats}


def stage_check(fixtures, m) -> dict:
    half_w = m['stage']['widthM'] / 2.0
    depth = m['stage']['depthM']
    def inside(f):
        return abs(f['x']) <= half_w + 1e-6 and -1e-6 <= f['y'] <= depth + 1e-6
    xs = [f['x'] for f in fixtures] + [a for f in fixtures for a in (f['aim'][0],)]
    ys = [f['y'] for f in fixtures] + [a for f in fixtures for a in (f['aim'][1],)]
    zs = [f['h'] for f in fixtures] + [a for f in fixtures for a in (f['aim'][2],)]
    n_in = sum(1 for f in fixtures if inside(f))
    out_names = [f['id'] for f in fixtures if not inside(f)]
    return {
        'stage': {'widthM': m['stage']['widthM'], 'depthM': m['stage']['depthM']},
        'fixturesInStage': n_in,
        'fixturesOutOfRange': out_names,
        'positionRange': {'x': [min(xs), max(xs)], 'y': [min(ys), max(ys)], 'h': [min(zs), max(zs)]},
    }


def main() -> None:
    ap = argparse.ArgumentParser(description='MVR 匯入 stage-plans.json 嘅燈位（dry-run 預設）')
    ap.add_argument('mvr', help='.mvr 檔路徑')
    ap.add_argument('--map', default=None, help='map json（預設 lighting/mvr-map.json）')
    ap.add_argument('--stage-plans', default=None, help='stage-plans.json 路徑（預設 repo 根目錄嗰份）')
    ap.add_argument('--report', default=str(WORK_DIR / 'mvr-import-report.json'))
    ap.add_argument('--apply', action='store_true', help='寫入（先備份 .bak-<YYYYMMDD>-before-mvr）')
    a = ap.parse_args()

    sp_path = pathlib.Path(a.stage_plans) if a.stage_plans else ROOT / 'stage-plans.json'
    if not sp_path.is_file():
        die(f'stage-plans 唔存在：{sp_path}')
    map_path = pathlib.Path(a.map) if a.map else DEFAULT_MAP
    mvr_path = pathlib.Path(a.mvr)
    if not mvr_path.is_file():
        die(f'MVR 檔唔存在：{mvr_path}')
    m = load_map(map_path)
    plans = json.loads(sp_path.read_text())
    lighting = plans.get('lighting', {})
    rig = lighting.get('rig', {})
    known_groups = list(rig.get('groups', {}).keys())
    if not known_groups:
        die('stage-plans 冇 lighting.rig.groups')

    mvr_fixtures, focuspoints, warn0 = load_mvr(mvr_path, m)
    res = convert(mvr_fixtures, focuspoints, m, known_groups)
    fx = res['fixtures']
    st = res['stats']
    sc = stage_check(fx, m)
    warnings = warn0 + res['warnings']

    old_hang = rig.get('hangAt')
    new_hang = 'fixture' if old_hang == 'screenTop' else old_hang
    hang_note = None
    if old_hang == 'screenTop':
        hang_note = ("hangAt 改動：screenTop → fixture。之前 lighting.js 會忽略每支燈嘅 h，全部吊喺投影幕頂；"
                     '改咗之後每支燈用自己嘅 h（buildRig: hang = hangAt==="screenTop" ? screenTop : null）。')

    # ---- 印表格 ----
    print(f'MVR 匯入（dry-run{"，--apply" if a.apply else ""}）：{mvr_path.name} → {sp_path.name}')
    print(f'{"id":<14} {"組":<8} {"x":>8} {"y":>8} {"h":>8}  aim[x,y,h]                    aim 來源')
    for f in fx:
        aim = f['aim']
        print(f"{f['id']:<14} {f['group']:<8} {f['x']:>8.2f} {f['y']:>8.2f} {f['h']:>8.2f}  "
              f"[{aim[0]:>8.2f}, {aim[1]:>8.2f}, {aim[2]:>8.2f}]  {f['_aimSource']}")
    if hang_note:
        print(hang_note)

    # ---- 報告 ----
    report = {
        'source': mvr_path.name,
        'map': rel(map_path),
        'stagePlans': rel(sp_path),
        'totalFixtures': st['total'],
        'groupCounts': st['groups'],
        'nestedInGroup': st['nested'],
        'focusPoints': len(focuspoints),
        'aimSources': st['aimSources'],
        'unmatchedGroups': st['unmatched'],
        'stage': sc,
        'hangAt': {'was': old_hang, 'now': new_hang} if hang_note else None,
        'warnings': warnings,
        'errors': [],
        'fixtureDetail': [
            {'id': f['id'], 'group': f['group'], 'x': f['x'], 'y': f['y'], 'h': f['h'],
             'aim': f['aim'], 'aimSource': f['_aimSource'], 'name': f['_name'],
             'gdtfspec': f['_spec'], 'layer': f['_layer']}
            for f in fx
        ],
    }
    if a.apply:
        bak = sp_path.with_name(f'{sp_path.name}.bak-{datetime.date.today():%Y%m%d}-before-mvr')
        shutil.copy2(sp_path, bak)
        out = json.loads(json.dumps(plans))
        out['lighting']['rig']['fixtures'] = [
            {k: f[k] for k in ('id', 'group', 'x', 'y', 'h', 'aim')} for f in fx
        ]
        out['lighting']['rig']['hangAt'] = new_hang
        out['lighting']['mvrImport'] = {
            'map': rel(map_path),
            'source': mvr_path.name,
            'importedAt': datetime.datetime.now().astimezone().isoformat(timespec='seconds'),
            'fixtureCount': st['total'],
            'aimSources': st['aimSources'],
        }
        sp_path.write_text(json.dumps(out, indent=2, ensure_ascii=False) + '\n')
        print(f'[apply] 備份：{bak.name}\n[apply] 已寫入：{rel(sp_path)}')
    rp = pathlib.Path(a.report)
    rp.parent.mkdir(parents=True, exist_ok=True)
    rp.write_text(json.dumps(report, indent=2, ensure_ascii=False) + '\n')
    print(f'報告：{rel(rp)}')
    print(f'總結：總 {st["total"]} 支（GroupObject 內 {st["nested"]}）；組 ' +
          '、'.join(f'{g}={st["groups"][g]}' for g in GROUPS) +
          f'；aim 來源 {st["aimSources"]}；台上 {sc["fixturesInStage"]}/{st["total"]}'
          + (f'；警告 {len(warnings)} 項' if warnings else '；無警告'))


if __name__ == '__main__':
    main()
