// 3D 舞台燈光 preset ＋ 煙霧機。純視覺預覽（試吓感覺），唔係燈光師 cue。
// 全部參數喺 stage-plans.json 嘅 lighting；使用者揀嘅 preset／煙霧設定存 localStorage。
const KEY = 'flowboard-light-v1';

// ---- MVR 燈光檔（My Virtual Rig）：喺瀏覽器內讀 zip → 燈位。同 tools/mvr-import.py 同一套對位邏輯（參數喺 lighting/mvr-map.json）----
const MVR_XML = 'GeneralSceneDescription.xml';
const MVR_DESCEND = new Set(['Scene', 'Layers', 'Layer', 'ChildList', 'GroupObject', 'Fixture', 'FocusPoint']);
const MVR_IDENT = { u: [1, 0, 0], v: [0, 1, 0], w: [0, 0, 1], o: [0, 0, 0] };
const mvrRound = (x) => Math.round(x * 1000) / 1000;

async function mvrReadXml(buf, map) {
  const bytes = new Uint8Array(buf), dv = new DataView(buf), u16 = (o) => dv.getUint16(o, true), u32 = (o) => dv.getUint32(o, true);
  let eocd = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 65535); i--) if (u32(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('唔係 zip 檔（MVR 應該係 zip）');
  const total = u16(eocd + 10);
  if (total > map.maxZipEntries) throw new Error(`zip 條目數 ${total} 超過上限 ${map.maxZipEntries}`);
  let p = u32(eocd + 16), found = null;
  for (let i = 0; i < total; i++) {
    if (u32(p) !== 0x02014b50) throw new Error('zip 目錄損壞');
    const nlen = u16(p + 28), elen = u16(p + 30), clen = u16(p + 32);
    if (new TextDecoder().decode(bytes.subarray(p + 46, p + 46 + nlen)) === MVR_XML) { found = { method: u16(p + 10), csize: u32(p + 20), usize: u32(p + 24), loff: u32(p + 42) }; break; }
    p += 46 + nlen + elen + clen;
  }
  if (!found) throw new Error(`zip 內冇 ${MVR_XML}`);
  if (found.usize > map.maxXmlBytes) throw new Error(`${MVR_XML} 太大（${found.usize} bytes，上限 ${map.maxXmlBytes}）`);
  if (u32(found.loff) !== 0x04034b50) throw new Error('zip 檔頭損壞');
  const start = found.loff + 30 + u16(found.loff + 26) + u16(found.loff + 28), raw = bytes.subarray(start, start + found.csize);
  let out;
  if (found.method === 0) out = raw;
  else if (found.method === 8) out = new Uint8Array(await new Response(new Blob([raw]).stream().pipeThrough(new DecompressionStream('deflate-raw'))).arrayBuffer());
  else throw new Error('zip 壓縮方式唔支援');
  if (out.length > map.maxXmlBytes) throw new Error(`${MVR_XML} 解壓後太大`);
  let text;
  try { text = new TextDecoder('utf-8', { fatal: true }).decode(out); } catch { throw new Error(`${MVR_XML} 唔係 UTF-8`); }
  if (/<!DOCTYPE|<!ENTITY/i.test(text)) throw new Error('XML 含 DOCTYPE/ENTITY，拒絕');
  return text;
}
const mvrNums = (t) => (String(t || '').match(/[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/g) || []).map(Number);
function mvrParseMatrix(t) {
  const a = mvrNums(t);
  if (a.length !== 12) throw new Error(`Matrix 要 4 組各 3 個數，實得 ${a.length} 個`);
  return { u: a.slice(0, 3), v: a.slice(3, 6), w: a.slice(6, 9), o: a.slice(9, 12) };
}
function mvrMul(P, C) {                                              // 世界 = P(C(x))
  const col = (c) => [0, 1, 2].map((i) => P.u[i] * c[0] + P.v[i] * c[1] + P.w[i] * c[2]);
  return { u: col(C.u), v: col(C.v), w: col(C.w), o: [0, 1, 2].map((i) => P.o[i] + P.u[i] * C.o[0] + P.v[i] * C.o[1] + P.w[i] * C.o[2]) };
}
function mvrAlign(x, y, m) {                                         // 轉向＋翻轉（先 rotZ 後 flip）
  const th = (m.rotZDeg * Math.PI) / 180, c = Math.cos(th), s = Math.sin(th);
  let X = c * x - s * y, Y = s * x + c * y;
  if (m.flipX) X = -X;
  if (m.flipY) Y = -Y;
  return [X, Y];
}
// CIE 1931 xyY → sRGB（亮度唔計，只取色相；亮度另外由 level 表達）
function mvrXyHex(x, y) {
  if (!(y > 0)) return null;
  const X = x / y, Y = 1, Z = (1 - x - y) / y;
  let c = [3.2406 * X - 1.5372 * Y - 0.4986 * Z, -0.9689 * X + 1.8758 * Y + 0.0415 * Z, 0.0557 * X - 0.204 * Y + 1.057 * Z].map((v) => Math.max(0, v));
  const m = Math.max(...c) || 1;
  const enc = (v) => Math.round(Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * Math.pow(v, 1 / 2.4) - 0.055)) * 255);
  return '#' + c.map((v) => enc(v / m).toString(16).padStart(2, '0')).join('');
}
const mvrChild = (el, tag) => [...el.children].find((c) => c.tagName === tag);
const mvrText = (el, tag) => { const c = mvrChild(el, tag); return c ? (c.textContent || '').trim() : ''; };

// 返回 [{id,group,x,y,h,aim:[x,y,h]}]（米）；陣列上 .warnings 係警告文字
export async function parseMvr(arrayBuffer, map) {
  const text = await mvrReadXml(arrayBuffer, map);
  const doc = new DOMParser().parseFromString(text, 'application/xml');
  if (doc.getElementsByTagName('parsererror').length) throw new Error('XML 解析失敗');
  const root = doc.documentElement;
  if (root.tagName !== 'GeneralSceneDescription') throw new Error(`root 標籤應該係 GeneralSceneDescription，實得 ${root.tagName}`);
  const layers = [...root.getElementsByTagName('Layer')];
  if (!layers.length) throw new Error('冇 Layer，冇嘢可匯入');
  const warnings = [], fixtures = [], focus = {};
  const ownMat = (el) => {
    const mm = mvrChild(el, 'Matrix');
    if (!mm || !(mm.textContent || '').trim()) return MVR_IDENT;
    try { return mvrParseMatrix(mm.textContent); } catch (e) { warnings.push(`${el.tagName} 嘅 Matrix 格式錯，當 identity：${e.message}`); return MVR_IDENT; }
  };
  const rec = (el, parent, inGroup, layerName) => {
    const tag = el.tagName;
    if (tag === 'Fixture' || tag === 'FocusPoint') {
      const cm = mvrMul(parent, ownMat(el));
      if (tag === 'Fixture') {
        if ((el.getAttribute('multipatch') || '').trim()) { warnings.push(`multipatch 子 fixture 唔重複計，略過：${el.getAttribute('name') || ''}`); return; }
        const cmds = [...el.getElementsByTagName('CustomCommand')].map((c) => c.textContent || ''), dim = cmds.filter((c) => /dimmer[^,]*,\s*f\s/i.test(c)).map((c) => mvrNums(c.split(/,\s*f\s/i)[1])[0]).filter((v) => Number.isFinite(v)).pop();
        fixtures.push({ name: el.getAttribute('name') || '', spec: mvrText(el, 'GDTFSpec'), mode: mvrText(el, 'GDTFMode'), layer: layerName, fid: mvrText(el, 'FixtureID'), unit: mvrText(el, 'UnitNumber'), focus: mvrText(el, 'Focus'), color: mvrText(el, 'Color'), dim, mat: cm });
      } else focus[(el.getAttribute('uuid') || '').trim()] = { mat: cm };
      return;
    }
    if (tag === 'GroupObject') inGroup = true;
    const cm = tag === 'Layer' || tag === 'GroupObject' ? mvrMul(parent, ownMat(el)) : parent;
    const ln = tag === 'Layer' ? el.getAttribute('name') ?? layerName : layerName;
    for (const ch of el.children) if (MVR_DESCEND.has(ch.tagName)) rec(ch, cm, inGroup, ln);
  };
  for (const layer of layers) rec(layer, MVR_IDENT, false, layer.getAttribute('name') || '');
  const off = map.originOffset, used = new Set(), out = [];
  const pos = (o) => { const [x, y] = mvrAlign((o[0] - off.x) / 1000, (o[1] - off.y) / 1000, map); return [x, y, (o[2] - off.z) / 1000]; };
  fixtures.forEach((fx, idx) => {
    const p = pos(fx.mat.o);
    let group = map.defaultGroup;
    const sources = [fx.spec, fx.layer, fx.mode].filter(Boolean);
    outer: for (const r of map.groupRules) for (const pat of r.anyOf || []) if (sources.some((s) => new RegExp(pat, 'i').test(s))) { group = r.group; break outer; }
    const base = String(fx.fid || fx.unit || fx.name || `fx-${String(idx + 1).padStart(3, '0')}`);
    let fid = base;
    if (used.has(fid)) { let i = 2; while (used.has(`${base}-${i}`)) i++; fid = `${base}-${i}`; }
    used.add(fid);
    let aim = null;
    const fp = fx.focus ? focus[fx.focus] : null;
    if (fp) aim = pos(fp.mat.o);
    else {
      const fa = (fx.fid && map.fixtureAims[fx.fid]) || (fx.unit && map.fixtureAims[fx.unit]) || (fx.name && map.fixtureAims[fx.name]);
      if (fa) aim = [...fa];
    }
    if (!aim) {
      const [bx, by] = mvrAlign(-fx.mat.w[0], -fx.mat.w[1], map), bz = -fx.mat.w[2];
      if (bz < -0.05 && p[2] > 0) { const t = -p[2] / bz; aim = [p[0] + t * bx, p[1] + t * by, 0]; }
    }
    if (!aim) {
      const ga = map.groupAim[group];
      aim = ga ? [...ga] : [p[0], p[1], 0];
    }
    const rec2 = { id: fid, group, x: mvrRound(p[0]), y: mvrRound(p[1]), h: mvrRound(p[2] + (map.heightLift && p[2] >= map.heightLift.fromM ? map.heightLift.byM : 0)), aim: aim.map(mvrRound), name: fx.name, type: (fx.spec.split(/[\\/]/).pop() || '').replace(/\.gdtf$/i, '') };
    const cn = mvrNums(fx.color);                                   // 燈光師存喺檔案入面嘅顏色（xyY）同亮度；冇就唔寫
    if (cn.length >= 3) {
      const hex = mvrXyHex(cn[0], cn[1]);
      if (hex) { rec2.color = hex; rec2.level = Math.round(Math.max(0, Math.min(1, fx.dim != null ? fx.dim / 100 : cn[2] / 100)) * 1000) / 1000; }
    }
    out.push(rec2);
  });
  out.warnings = warnings;
  return out;
}
export const mvrInStage = (list, map) => list.filter((f) => Math.abs(f.x) <= map.stage.widthM / 2 + 1e-6 && f.y >= -1e-6 && f.y <= map.stage.depthM + 1e-6).length;
let mvrMapP = null, mvrIndexP = null;
const mvrFetchJson = (url) => fetch(url).then((r) => { if (!r.ok) throw new Error(`${url} ${r.status}`); return r.json(); });
export const mvrMap = () => (mvrMapP = mvrMapP || mvrFetchJson('lighting/mvr-map.json').catch((e) => { mvrMapP = null; throw e; }));
export const mvrIndex = () => (mvrIndexP = mvrIndexP || mvrFetchJson('lighting/index.json').catch((e) => { mvrIndexP = null; throw e; }));

export function createLighting({ THREE, scene, box, base, getBpm, getTime, getHang }) {
  let cfg = null, cfgKey = '', snap = null, panel = null, lightBtn = null;
  let st = { preset: null, mix: null, spot: null, fog: {}, fix: {}, zone: {}, markers: null };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (isObj(s)) st = { preset: s.preset || null, mix: isObj(s.mix) ? s.mix : null, spot: isObj(s.spot) ? s.spot : null, fog: isObj(s.fog) ? s.fog : {}, fix: isObj(s.fix) ? s.fix : {}, zone: isObj(s.zone) ? s.zone : {}, markers: typeof s.markers === 'boolean' ? s.markers : null };
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  // ---- 燈光檔（.mvr）：按舞台方案記住揀咗邊個燈位（key＝原本 cfg 嘅雜湊，每個方案各自一份）----
  const MVR_KEY = 'flowboard-mvr-v1', MVR_KEEP = 400;
  let origCfg = null, origHash = '', mvrMeta = null;
  const hashOf = (s) => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return String(h >>> 0); };
  const mvrStore = () => { try { const s = JSON.parse(localStorage.getItem(MVR_KEY)); return isObj(s) ? s : {}; } catch { return {}; } };
  const mvrSave = (s) => { try { localStorage.setItem(MVR_KEY, JSON.stringify(s)); } catch {} };
  const useFixtures = (list, meta) => { cfg = { ...origCfg, rig: { ...origCfg.rig, fixtures: list } }; mvrMeta = meta; st.fix = {}; st.zone = {}; selFix = null; selZone = null; buildRig(); };
  const resetFixtures = () => { cfg = origCfg; mvrMeta = null; st.fix = {}; st.zone = {}; selFix = null; selZone = null; if (st.preset === '@file') { st.preset = null; st.mix = null; } save(); buildRig(); };

  const root = new THREE.Group();
  scene.add(root);
  const b0 = { hemi: base.hemi.intensity, ambient: base.ambient.intensity, key: base.key.intensity };
  const fogObj = new THREE.FogExp2(0x0b0d0c, 0);               // density > 0 先掛上 scene（冇煙時 shader 同原本一樣）
  let fixtures = [], machines = [], rods = null;
  const cur = { hemi: 1, ambient: 1, key: 1, haze: 0, density: 0 };
  const stats = { preset: null, base: {}, fixtures: [], fog: { density: 0, haze: 0, machines: [] } };

  // ---- 柔邊煙霧貼圖 ----
  const puffTex = (() => {
    const c = document.createElement('canvas');
    c.width = c.height = 128;
    const x = c.getContext('2d'), g = x.createRadialGradient(64, 64, 4, 64, 64, 62);
    g.addColorStop(0, 'rgba(255,255,255,0.9)');
    g.addColorStop(0.5, 'rgba(255,255,255,0.35)');
    g.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = g;
    x.fillRect(0, 0, 128, 128);
    return new THREE.CanvasTexture(c);
  })();

  const rigHasLook = () => !!(cfg && cfg.rig.fixtures.some((f) => f.color));
  const filePreset = () => { const w = cfg.presets.find((q) => q.id === 'warm') || cfg.presets[0], z = { color: '#ffffff', level: 0 }; return { id: '@file', name: '檔案原狀', hint: '燈光檔入面存嘅顏色同亮度（燈光師匯出嗰刻嘅狀態）', base: (w && w.base) ? { ...w.base } : { hemi: 0.4, ambient: 0.4, key: 0.3 }, wash: z, back: z, follow: z }; };
  const presetOf = () => (cfg && st.preset === '@file' && rigHasLook() ? filePreset() : cfg && (cfg.presets.find((p) => p.id === st.preset) || cfg.presets.find((p) => p.id === cfg.default) || cfg.presets[0])) || null;
  // 單支燈而家應該係咩色／幾亮：組設定 →（檔案原狀 preset 就用檔案入面嘅）→ 單支覆蓋
  const baseTarget = (def, P) => {
    const gp = effGroup(P, def.group);
    if (P.id === '@file' && !st.mix) return { color: def.color || '#ffffff', level: def.color ? (def.level ?? 1) : 0 };
    return { color: gp.color, level: gp.level || 0 };
  };
  // 疊層：組設定 → 燈區 → 單支燈（後者蓋前者）
  const fixTarget = (def, P) => {
    const t0 = baseTarget(def, P);
    const apply = (o) => { if (!o) return; if (o.color) t0.color = o.color; if (o.level != null) t0.level = o.level; if (o.on === false) t0.level = 0; else if (o.on === true && !(t0.level > 0)) t0.level = 1; };
    apply(st.zone[zones().of.get(def.id)]); apply(st.fix[def.id]);
    return t0;
  };
  // 燈區：燈太多（例如 Capture 匯出 76 支）逐支調唔現實，所以每組按舞台深度（y）切成最多幾排，一排一區成區一齊調。參數喺 cfg.rig.zones（minFixtures／bands），冇就用預設
  const zoneCache = { key: null, v: null };
  function zones() {
    const fx = cfg.rig.fixtures;
    if (zoneCache.key === fx && zoneCache.v) return zoneCache.v;
    const Z = cfg.rig.zones || {}, minN = Z.minFixtures || 6, bands = Z.bands || 3, list = [], of = new Map();
    for (const g of GROUPS) {
      const mem = fx.filter((f) => f.group === g);
      if (!mem.length) continue;
      const label = (cfg.rig.groups[g] || {}).label || g, k = mem.length >= minN ? Math.max(1, Math.min(bands, Math.floor(mem.length / 2))) : 1;
      const sorted = [...mem].sort((a, b) => a.y - b.y || a.x - b.x);
      for (let i = 0; i < k; i++) {
        const part = sorted.slice(Math.round((i * sorted.length) / k), Math.round(((i + 1) * sorted.length) / k)), id = g + ':' + (i + 1), ys = part.map((f) => f.y);
        list.push({ id, group: g, name: k > 1 ? `${label} · 第 ${i + 1} 排` : label, ids: part.map((f) => f.id), y0: Math.min(...ys), y1: Math.max(...ys) });
        part.forEach((f) => of.set(f.id, id));
      }
    }
    zoneCache.key = fx; zoneCache.v = { list, of, split: list.length > new Set(list.map((z) => z.group)).size };
    return zoneCache.v;
  }
  const markersOn = () => !!st.markers;                              // 「顯示全部燈位點」；平時淨係見到揀咗嗰區／嗰支，唔會成面點
  let selFix = null, selZone = null, fixOpen = false;     // fixOpen：「單支燈」摺疊區打開先標出揀咗嗰支
  const MARK = { wash: 0x6f8fb0, back: 0xa070b0, follow: 0xc0a050 };
  const markGeo = new THREE.SphereGeometry(0.09, 10, 8);
  const fogState = (m) => ({ on: !!m.on, pos: m.pos, strength: m.strength, ...(st.fog[m.id] || {}) });
  // 追光：一組設定（顏色／強度／闊度）＋ 一份名單，名單入面每人一束光
  const spotState = () => { const d = (cfg && cfg.spots && cfg.spots.default) || {}; return { on: !!d.on, color: d.color, strength: d.strength, width: d.width, targets: [...(d.targets || [])], ...(st.spot || {}) }; };
  const hangH = () => { const h = getHang && getHang(); return cfg && cfg.rig.hangAt === 'screenTop' && h ? h : null; };   // 燈吊喺幾高：同投影幕頂一樣
  const LV = () => (cfg && cfg.levels) || 10;                       // 強度刻度：1–LV
  const clampLv = (v) => Math.max(0, Math.min(LV(), Math.round(+v) || 0));
  const GROUPS = ['wash', 'back', 'follow'];
  // 面光／逆光／追光而家用邊個顏色同強度：用家改過就用佢嘅（mix），否則跟 preset
  const effGroup = (P, g) => (st.mix && st.mix[g]) || (P && P[g]) || { color: '#ffffff', level: 0 };
  const angleOf = (w) => { const sp = cfg.spots, t = (Math.max(1, Math.min(LV(), w)) - 1) / (LV() - 1); return sp.angleMin + (sp.angleMax - sp.angleMin) * t; };

  function clearRig() {
    for (const f of fixtures) { root.remove(f.grp); if (f.spot) root.remove(f.spot, f.spot.target); f.beam.geometry.dispose(); f.mat.dispose(); if (f.marker) { root.remove(f.marker); f.marker.material.dispose(); } }
    for (const m of machines) for (const p of m.puffs) { root.remove(p.sprite); p.sprite.material.dispose(); }
    if (rods) { root.remove(rods); rods.geometry.dispose(); rods.material.dispose(); rods = null; }
    fixtures = []; machines = [];
  }

  let builtHang = null;
  function buildRig() {
    clearRig();
    const groups = cfg.rig.groups;
    const hang = hangH();
    builtHang = hang;
    const addFixture = (def, g, len, custom) => {
      const pos = new THREE.Vector3(def.x, hang ?? def.h, def.y), aim = new THREE.Vector3(def.aim[0], def.aim[2], def.aim[1]);
      const L = len || pos.distanceTo(aim) + 3, r = L * Math.tan(g.angle);
      const geo = new THREE.CylinderGeometry(0, r, L, 24, 1, true);
      geo.translate(0, -L / 2, 0);
      geo.rotateX(-Math.PI / 2);                                   // 錐尖喺原點，向 +Z 伸出
      const p = geo.attributes.position, col = new Float32Array(p.count * 3);
      for (let i = 0; i < p.count; i++) { const t = Math.min(1, p.getZ(i) / L), v = Math.pow(1 - t, 0.9); col[i * 3] = col[i * 3 + 1] = col[i * 3 + 2] = v; }
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3));
      const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, vertexColors: true, transparent: true, opacity: 0, blending: THREE.AdditiveBlending, depthWrite: false, fog: false, side: THREE.DoubleSide });
      const beam = new THREE.Mesh(geo, mat);
      beam.frustumCulled = false;
      beam.renderOrder = 5;
      const grp = new THREE.Group();
      grp.position.copy(pos);
      grp.add(beam);
      root.add(grp);
      let spot = null;
      if (g.peak > 0) {
        spot = new THREE.SpotLight(0xffffff, 0, 0, g.angle, g.penumbra ?? 0.5, g.decay ?? 1);
        spot.position.copy(pos);
        spot.target.position.copy(aim);                              // 燈亮先加入場景（update 入面），唔亮嘅 SpotLight 都會令所有物料 shader 變重
      }
      let marker = null;
      if (!custom) {                                               // 燈位點：睇到燈喺邊（光柱熄咗都見到）
        marker = new THREE.Mesh(markGeo, new THREE.MeshBasicMaterial({ color: MARK[def.group] || 0x888888, fog: false, depthWrite: false }));
        marker.position.copy(pos);
        marker.renderOrder = 7;
        root.add(marker);
      }
      fixtures.push({ marker, def, g, grp, spot, beam, mat, aim, custom, ang: g.angle, level: 0, color: new THREE.Color('#ffffff'), idx: fixtures.filter((f) => f.def.group === def.group).length });
    };
    cfg.rig.fixtures.forEach((def) => { const g = groups[def.group]; if (g) addFixture(def, g, 0, false); });
    // 吊桿：每支吊高 >= minH 嘅燈拉一條幼線上去同一個高度（rig 頂 + over 米），睇落係吊住，唔係浮喺半空。參數喺 cfg.rig.truss
    const TR = cfg.rig.truss || {}, hung = cfg.rig.fixtures.filter((d) => groups[d.group] && (hang ?? d.h) >= (TR.minH ?? 3));
    if (hung.length >= 3) {
      const top = Math.max(...hung.map((d) => hang ?? d.h)) + (TR.over ?? 0.5), pts = [];
      hung.forEach((d) => { const h = hang ?? d.h; pts.push(d.x, h + 0.12, d.y, d.x, top, d.y); });
      const rg = new THREE.BufferGeometry();
      rg.setAttribute('position', new THREE.Float32BufferAttribute(pts, 3));
      rods = new THREE.LineSegments(rg, new THREE.LineBasicMaterial({ color: TR.color || 0x6b7480, transparent: true, opacity: 0.5, fog: false }));
      rods.frustumCulled = false;
      root.add(rods);
    }
    const sp = cfg.spots;
    if (sp) for (let k = 0; k < sp.max; k++) addFixture({ id: 'sp' + (k + 1), group: 'spot', x: 0, y: sp.hangY, h: sp.hangH, aim: [0, sp.hangY, 0] }, { peak: sp.peak, angle: sp.angleMax, penumbra: sp.penumbra, decay: sp.decay, beam: sp.beam }, sp.beamLength, true);
    const pp = cfg.fog.particles;
    for (const def of cfg.fog.machines) {
      const m = { def, puffs: [], cx: 0, cz: 0 };
      for (let i = 0; i < pp.maxPuffs; i++) {
        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: puffTex, color: 0xd5d9de, transparent: true, depthWrite: false, opacity: 0, fog: false }));
        sprite.visible = false;
        sprite.renderOrder = 6;
        root.add(sprite);
        m.puffs.push({ sprite, alive: false, age: 0, life: 1, v: new THREE.Vector3() });
      }
      machines.push(m);
    }
  }

  // ---- 面板 ----
  const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const targetList = () => {
    const sp = cfg.spots, items = ((snap && snap.items) || []).filter((i) => sp.targetTypes.includes(i.type));
    return [['@solo', sp.soloLabel], ...items.map((i) => [i.id, String(i.label || i.type).replace(/ ★.*$/, '')]), ...Object.entries(sp.points).map(([k, v]) => [k, v.name])];
  };
  let targetKey = '';
  function syncMix() {                                              // 面光／逆光／追光嘅顏色同強度掣，顯示而家生效嘅值
    if (!panel) return;
    const P = presetOf();
    for (const g of GROUPS) {
      const row = panel.querySelector(`[data-g="${g}"]`), e = effGroup(P, g);
      if (!row) continue;
      row.querySelector('[data-k="color"]').value = e.color;
      row.querySelector('[data-k="level"]').value = Math.round(e.level * LV());
      row.querySelector('output').textContent = Math.round(e.level * LV());
    }
    const chase = panel.querySelector('[data-lp="chase"]');
    if (chase) chase.hidden = !(P && P.chase && !st.mix);
  }
  const nameOfTarget = (id) => (targetList().find((t) => t[0] === id) || [id, id])[1];
  function renderSpotMembers() {                                    // 追光名單（chip）同「加入」下拉
    if (!panel || !cfg || !cfg.spots) return;
    const q = spotState(), full = q.targets.length >= cfg.spots.max;
    panel.querySelector('[data-lp="chips"]').innerHTML = q.targets.length
      ? q.targets.map((t) => `<span class="lp-chip" data-t="${esc(t)}">${esc(nameOfTarget(t))}<button class="lp-x" data-lp="rm" data-t="${esc(t)}" aria-label="移走 ${esc(nameOfTarget(t))}">✕</button></span>`).join('')
      : '<span class="lp-hint">名單冇人：追光唔會照任何位置</span>';
    const sel = panel.querySelector('select[data-k="add"]');
    sel.innerHTML = targetList().filter(([v]) => !q.targets.includes(v)).map(([v, n]) => `<option value="${esc(v)}">${esc(n)}</option>`).join('');
    sel.disabled = full || !sel.options.length;
    panel.querySelector('button[data-lp="add"]').disabled = sel.disabled;
    targetKey = targetList().map((t) => t[0]).join();
  }
  async function applyMvr(buf, title, file) {
    const map = await mvrMap(), list = await parseMvr(buf, map);
    if (!list.length) throw new Error('檔內冇燈');
    useFixtures(list, { title, file });
    const look = rigHasLook();
    if (look) { st.preset = '@file'; st.mix = null; }                // 檔案本身有顏色／亮度：用設計師嘅，唔係我哋嘅 preset
    save();
    const store = mvrStore();
    if (list.length <= MVR_KEEP) store[origHash] = { title, file, fixtures: list };
    else if (file) store[origHash] = { title, file };
    else delete store[origHash];
    mvrSave(store);
    return { n: list.length, look, inStage: mvrInStage(list, map), kept: list.length <= MVR_KEEP || !!file, warnings: list.warnings };
  }
  async function loadFolderFile(file, title, quiet) {
    const r = await fetch('lighting/' + encodeURIComponent(file));
    if (!r.ok) throw new Error(`搵唔到 ${file}（${r.status}）`);
    return applyMvr(await r.arrayBuffer(), title || file, file);
  }
  async function wireMvr() {
    const q = (k) => panel && panel.querySelector(`[data-mvr="${k}"]`);
    const box = q('box'), sel = q('sel'), pick = q('pick'), input = q('file'), status = q('status');
    if (!box) return;
    let index = null;
    try { await mvrMap(); } catch { return; }                       // 呢個板冇 lighting/mvr-map.json（例如籌備站）就唔出呢個區塊
    try { index = (await mvrIndex()).files || []; } catch { sel.hidden = true; }
    if (!panel || q('box') !== box) return;
    box.hidden = false;
    if (index) for (const f of index) sel.append(new Option(`${f.title || f.file}（${f.fixtures} 支）`, f.file));
    const showCurrent = () => {
      const f = mvrMeta && mvrMeta.file;
      if (f && ![...sel.options].some((o) => o.value === f)) sel.append(new Option(mvrMeta.title || f, f));
      if (mvrMeta && !f) { sel.append(new Option(`（本機）${mvrMeta.title}`, '@local')); sel.value = '@local'; } else sel.value = f || '';
      if (mvrMeta) status.textContent = `而家用：${mvrMeta.title}（${cfg.rig.fixtures.length} 支）`;
    };
    showCurrent();
    const busy = (b) => { sel.disabled = pick.disabled = b; };
    const done = (r, name) => {
      status.textContent = `已載入：${name}（${r.n} 支，台上 ${r.inStage} 支）` + (r.look ? '。已用檔案入面嘅顏色同亮度' : '。呢個檔只有燈位，冇顏色／亮度（設計師嘅 cue 唔喺 MVR）：用 preset，或下面「' + (zones().split ? '燈區' : '單支燈') + '」自己設') + (r.kept ? '' : '。檔太大，reload 後要重新揀') + (r.warnings && r.warnings.length ? `。${r.warnings.length} 項警告` : '');
      refreshPanel();
    };
    sel.addEventListener('change', async () => {
      const f = sel.value;
      if (f === '@local') return;
      if (!f) { resetFixtures(); const s = mvrStore(); delete s[origHash]; mvrSave(s); status.textContent = '已還原預設燈位'; refreshPanel(); return; }
      busy(true); status.textContent = '載入中…';
      try { const e = (index || []).find((x) => x.file === f); done(await loadFolderFile(f, e && e.title), (e && e.title) || f); } catch (err) { status.textContent = `載入失敗：${err.message}`; showCurrent(); }
      busy(false);
    });
    pick.addEventListener('click', () => input.click());
    input.addEventListener('change', async () => {
      const file = input.files[0];
      if (!file) return;
      busy(true); status.textContent = '載入中…';
      try {
        const r = await applyMvr(await file.arrayBuffer(), file.name, null);
        showCurrent(); done(r, file.name);
      } catch (err) { status.textContent = `載入失敗：${err.message}`; }
      input.value = ''; busy(false);
    });
  }
  function renderZones() {
    const box = panel && panel.querySelector('[data-zn="box"]');
    if (!box || !cfg) return;
    const Z = zones(), n = cfg.rig.fixtures.length;
    box.hidden = !Z.split;
    if (!Z.split) return;
    const lv = LV();
    box.querySelector('[data-zn="title"]').textContent = `燈區（${n} 支燈分成 ${Z.list.length} 區，成區一齊調）`;
    box.querySelector('[data-zn="list"]').innerHTML = Z.list.map((z) => `<div class="lp-zrow" data-z="${esc(z.id)}"><button class="lp-zname" type="button" data-zn="pick" aria-pressed="${z.id === selZone}" title="y ${z.y0.toFixed(1)}–${z.y1.toFixed(1)} m">${esc(z.name)}<small>${z.ids.length} 支</small></button>` +
      `<input type="checkbox" data-zk="on" aria-label="${esc(z.name)} 亮／熄"><input type="color" data-zk="color" aria-label="${esc(z.name)} 顏色"><input type="range" min="0" max="${lv}" step="1" data-zk="level" aria-label="${esc(z.name)} 強度 0 至 ${lv}"><output></output></div>`).join('');
    syncZones();
  }
  function syncZones() {
    if (!panel || !cfg) return;
    const Z = zones(), lv = LV(), P = presetOf(), byId = new Map(cfg.rig.fixtures.map((f) => [f.id, f]));
    panel.querySelectorAll('[data-z]').forEach((row) => {
      const z = Z.list.find((q) => q.id === row.dataset.z);
      if (!z || !P) return;
      const ts = z.ids.map((id) => fixTarget(byId.get(id), P)), top = ts.reduce((a, b) => (b.level > a.level ? b : a), ts[0]), avg = ts.reduce((s, x) => s + x.level, 0) / ts.length;
      row.querySelector('[data-zk="on"]').checked = avg > 0; row.querySelector('[data-zk="color"]').value = top.color;
      row.querySelector('[data-zk="level"]').value = Math.round(avg * lv); row.querySelector('output').textContent = Math.round(avg * lv);
      row.querySelector('[data-zn="pick"]').setAttribute('aria-pressed', String(z.id === selZone));
    });
    const m = panel.querySelector('[data-zn="markers"]'); if (m) m.checked = markersOn();
  }
  function wireZones() {
    const box = panel.querySelector('[data-zn="box"]');
    box.addEventListener('click', (e) => {
      const b = e.target.closest('[data-zn]'); if (!b) return;
      if (b.dataset.zn === 'pick') { const id = b.closest('[data-z]').dataset.z; selZone = selZone === id ? null : id; selFix = null; renderFixList(); syncZones(); }
      if (b.dataset.zn === 'reset') { st.zone = {}; st.fix = {}; save(); syncZones(); syncFix(); }
    });
    box.querySelector('[data-zn="markers"]').addEventListener('change', (e) => { st.markers = e.target.checked; save(); syncFix(); });
    const edit = (e) => {
      const k = e.target.dataset.zk, row = e.target.closest('[data-z]'); if (!k || !row) return;
      const id = row.dataset.z, z = zones().list.find((q) => q.id === id), o = st.zone[id] || {}, lv = LV();
      if (k === 'on') { o.on = e.target.checked; if (o.on && !(row.querySelector('[data-zk="level"]').value > 0)) o.level = 1; }
      else if (k === 'color') { o.color = e.target.value; if (o.on === undefined) o.on = true; }
      else { const v = clampLv(e.target.value); o.level = v / lv; if (v > 0) delete o.on; else o.on = false; row.querySelector('output').textContent = v; }
      st.zone[id] = o; z.ids.forEach((fid) => delete st.fix[fid]);     // 區嘅設定係最新意思，蓋過呢區入面舊嘅單支設定
      save();
      if (k !== 'level') syncZones();
    };
    box.addEventListener('input', edit);
  }
  function renderFixList() {
    const sel = panel && panel.querySelector('[data-fx="sel"]'), box = panel && panel.querySelector('[data-fx="box"]');
    if (!sel || !cfg) return;
    const all = cfg.rig.fixtures, Z = zones(), list = selZone ? all.filter((f) => Z.of.get(f.id) === selZone) : all;
    box.hidden = !all.length;
    sel.innerHTML = list.map((f) => `<option value="${esc(f.id)}">${esc(f.id)} · ${esc(f.name || f.type || '燈')} · ${esc((cfg.rig.groups[f.group] || {}).label || f.group)}</option>`).join('');
    if (!list.some((f) => f.id === selFix)) selFix = list.length ? list[0].id : null;
    sel.value = selFix || '';
    syncFix();
  }
  function syncFix() {                                              // 顯示揀咗嗰支燈而家嘅設定
    const q = (k) => panel.querySelector(`[data-fx="${k}"]`), def = cfg.rig.fixtures.find((f) => f.id === selFix);
    q('markers').checked = markersOn();
    if (!def) return;
    const t0 = fixTarget(def, presetOf()), lv = LV();
    q('on').checked = t0.level > 0; q('color').value = t0.color; q('level').value = Math.round(t0.level * lv); q('out').textContent = Math.round(t0.level * lv);
    q('info').textContent = `位置 x ${def.x} · y ${def.y} · 高 ${def.h} m${def.type ? ' · ' + def.type : ''}${def.color ? ' · 檔案有顏色' : ''}${st.fix[def.id] ? ' · 已手動改' : ''}`;
  }
  function wireFix() {
    const q = (k) => panel.querySelector(`[data-fx="${k}"]`), ids = () => [...q('sel').options].map((o) => o.value);
    const step = (d) => { const a = ids(); if (!a.length) return; selFix = a[(Math.max(0, a.indexOf(selFix)) + d + a.length) % a.length]; q('sel').value = selFix; syncFix(); };
    q('sel').addEventListener('change', () => { selFix = q('sel').value; syncFix(); });
    q('prev').addEventListener('click', () => step(-1));
    q('next').addEventListener('click', () => step(1));
    q('markers').addEventListener('change', () => { st.markers = q('markers').checked; save(); syncZones(); });
    q('reset').addEventListener('click', () => { delete st.fix[selFix]; save(); syncFix(); });
    q('resetall').addEventListener('click', () => { st.fix = {}; st.zone = {}; save(); syncFix(); syncZones(); });
    const edit = (k) => {
      if (!selFix) return;
      const o = st.fix[selFix] || {};
      if (k === 'on') { o.on = q('on').checked; if (o.on && !(fixTarget(cfg.rig.fixtures.find((f) => f.id === selFix), presetOf()).level > 0)) o.level = 1; }
      else if (k === 'color') { o.color = q('color').value; if (o.on === undefined) o.on = true; }
      else if (k === 'level') { const v = clampLv(q('level').value); o.level = v / LV(); if (v > 0) delete o.on; else o.on = false; q('out').textContent = v; }
      st.fix[selFix] = o; save();
      if (k !== 'level') syncFix();
      syncZones();
    };
    for (const k of ['on', 'color', 'level']) q(k).addEventListener('input', () => edit(k));
  }
  function refreshPanel() {                                         // 換咗燈位／look 之後更新面板（唔重建，面板保持打開）
    if (!panel || !cfg) return;
    const P = presetOf();
    panel.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(!!P && b.dataset.preset === P.id)));
    const fl = panel.querySelector('[data-lp="filelook"]'); if (fl) fl.hidden = !rigHasLook();
    const h = panel.querySelector('[data-lp="hint"]'); if (h) h.textContent = P ? P.hint || '' : '';
    syncMix(); renderZones(); renderFixList();
  }
  function buildPanel() {
    if (panel) panel.remove();
    panel = document.createElement('div');
    panel.className = 'lightpanel';
    panel.hidden = true;
    panel.setAttribute('role', 'dialog');
    panel.setAttribute('aria-label', '燈光同煙霧');
    const P = presetOf(), lv = LV(), sp = cfg.spots;
    const mixRows = GROUPS.map((g) => `<div class="lp-line" data-g="${g}"><span class="lp-name">${esc(cfg.rig.groups[g].label)}</span>` +
      `<input type="color" data-k="color" aria-label="${esc(cfg.rig.groups[g].label)} 顏色"><input type="range" min="0" max="${lv}" step="1" data-k="level" aria-label="${esc(cfg.rig.groups[g].label)} 強度 0 至 ${lv}"><output></output></div>`).join('');
    const spotBox = sp ? (() => {
      const q = spotState();
      return `<div class="lp-card" data-sp><div class="lp-line"><label class="lp-on"><input type="checkbox" data-k="on"${q.on ? ' checked' : ''}> 開追光</label><span></span><input type="color" data-k="color" value="${esc(q.color)}" aria-label="追光 顏色"></div>` +
        `<div class="lp-line"><span class="lp-name">強度</span><input type="range" min="1" max="${lv}" step="1" value="${clampLv(q.strength)}" data-k="strength" aria-label="追光 強度 1 至 ${lv}"><output>${clampLv(q.strength)}</output></div>` +
        `<div class="lp-line"><span class="lp-name">光束闊度</span><input type="range" min="1" max="${lv}" step="1" value="${clampLv(q.width)}" data-k="width" aria-label="追光 光束闊度 1 至 ${lv}"><output>${clampLv(q.width)}</output></div>` +
        '<div class="lp-chips" data-lp="chips"></div>' +
        '<div class="lp-line lp-addrow"><select data-k="add" aria-label="加入邊個"></select><button class="smallbtn" data-lp="add">＋ 加入</button></div></div>';
    })() : '';
    panel.innerHTML =
      '<div class="lp-head"><b>燈光 / 煙霧</b><button class="smallbtn" data-lp="close" aria-label="收埋燈光面板">✕</button></div>' +
      '<div class="lp-sec lp-mvr" data-mvr="box" hidden><div class="lp-title">燈光檔（.mvr）</div><div class="lp-line lp-mvrrow"><select data-mvr="sel" aria-label="燈光檔"><option value="">預設燈位</option></select><button class="smallbtn" data-mvr="pick" type="button">揀檔…</button><input type="file" accept=".mvr" data-mvr="file" hidden></div><div class="lp-hint" data-mvr="status" role="status"></div></div>' +
      '<div class="lp-sec"><div class="lp-title">燈光 preset（揀咗會載入對應顏色同強度）</div><div class="lp-presets">' +
      cfg.presets.map((p) => `<button class="smallbtn" data-preset="${esc(p.id)}" title="${esc(p.hint || '')}" aria-pressed="${P && P.id === p.id}">${esc(p.name)}</button>`).join('') +
      `<button class="smallbtn" data-preset="@file" data-lp="filelook"${rigHasLook() ? '' : ' hidden'} title="燈光檔入面存嘅顏色同亮度" aria-pressed="${!!P && P.id === '@file'}">檔案原狀</button>` +
      '</div><div class="lp-hint" data-lp="hint"></div></div>' +
      '<div class="lp-sec lp-zones" data-zn="box" hidden><div class="lp-title" data-zn="title"></div><div data-zn="list"></div>' +
      '<div class="lp-line lp-fixrow"><label class="lp-on"><input type="checkbox" data-zn="markers"> 顯示全部燈位點</label><button class="smallbtn" data-zn="reset" type="button">全部還原</button></div>' +
      '<div class="lp-hint">撳區名會喺 3D 入面標出嗰區嘅燈位；平時唔顯示燈位點。</div></div>' +
      '<details class="lp-sec lp-fix" data-fx="box" hidden><summary class="lp-title">進階：單支燈（逐支調顏色同亮度）</summary>' +
      '<div class="lp-line lp-fixrow"><select data-fx="sel" aria-label="揀燈"></select><button class="smallbtn" data-fx="prev" type="button" aria-label="上一支">◀</button><button class="smallbtn" data-fx="next" type="button" aria-label="下一支">▶</button></div>' +
      '<div class="lp-hint" data-fx="info"></div>' +
      `<div class="lp-line"><label class="lp-on"><input type="checkbox" data-fx="on"> 亮</label><input type="color" data-fx="color" aria-label="呢支燈顏色"><input type="range" min="0" max="${lv}" step="1" data-fx="level" aria-label="呢支燈強度 0 至 ${lv}"><output data-fx="out"></output></div>` +
      '<div class="lp-line lp-fixrow"><label class="lp-on"><input type="checkbox" data-fx="markers"> 顯示燈位點</label><button class="smallbtn" data-fx="reset" type="button">還原呢支</button><button class="smallbtn" data-fx="resetall" type="button">全部還原</button></div></details>' +
      `<div class="lp-sec"><div class="lp-title">自訂顏色同強度（0＝熄，${lv}＝最亮）</div>${mixRows}<div class="lp-hint" data-lp="chase" hidden>顏色循環中：改顏色或強度會停止循環。撳 preset 可還原。</div></div>` +
      (sp ? `<div class="lp-sec"><div class="lp-title">追光（一組設定，名單入面每人一束光，最多 ${sp.max} 束）</div>${spotBox}</div>` : '') +
      '<div class="lp-sec"><div class="lp-title">煙霧機（強度 1–' + lv + '）</div>' +
      cfg.fog.machines.map((m) => {
        const s = fogState(m), v = Math.max(1, clampLv(s.strength * lv));
        return `<div class="lp-row" data-m="${esc(m.id)}"><label class="lp-on"><input type="checkbox" data-k="on"${s.on ? ' checked' : ''}> ${esc(m.name)}</label>` +
          `<select data-k="pos" aria-label="${esc(m.name)} 位置">${Object.entries(cfg.fog.positions).map(([k, v2]) => `<option value="${esc(k)}"${s.pos === k ? ' selected' : ''}>${esc(v2.name)}</option>`).join('')}</select>` +
          `<input type="range" min="1" max="${lv}" step="1" value="${v}" data-k="strength" aria-label="${esc(m.name)} 強度 1 至 ${lv}"><output>${v}</output></div>`;
      }).join('') +
      '</div>';
    box.append(panel);
    renderSpotMembers();
    syncMix();
    const hint = () => { const q = presetOf(); panel.querySelector('[data-lp="hint"]').textContent = q ? q.hint || '' : ''; };
    hint();
    renderZones();
    renderFixList();
    wireZones();
    wireFix();
    panel.querySelector('details.lp-fix').addEventListener('toggle', (e) => { fixOpen = e.target.open; });
    wireMvr();
    panel.addEventListener('click', (e) => {
      const btn = e.target.closest('button'), d = (btn && btn.dataset) || {};
      if (d.lp === 'close') api.toggle(false);
      if (d.lp === 'add' || d.lp === 'rm') {
        const q = spotState(), cur0 = st.spot || {};
        if (d.lp === 'add') { const v = panel.querySelector('select[data-k="add"]').value; if (v && !q.targets.includes(v) && q.targets.length < cfg.spots.max) cur0.targets = [...q.targets, v]; }
        else cur0.targets = q.targets.filter((t) => t !== d.t);
        st.spot = cur0; save(); renderSpotMembers();
      }
      if (d.preset) {
        st.preset = d.preset; st.mix = null; save();
        panel.querySelectorAll('[data-preset]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.preset === d.preset)));
        hint(); syncMix();
      }
    });
    const onInput = (e) => {
      const k = e.target.dataset.k;
      if (!k) return;
      const mrow = e.target.closest('[data-m]'), sbox = e.target.closest('[data-sp]'), grow = e.target.closest('[data-g]');
      if (mrow) {
        const cur0 = st.fog[mrow.dataset.m] || {};
        if (k === 'on') cur0.on = e.target.checked;
        else if (k === 'pos') cur0.pos = e.target.value;
        else if (k === 'strength') { const v = Math.max(1, clampLv(e.target.value)); cur0.strength = v / lv; mrow.querySelector('output').textContent = v; }
        st.fog[mrow.dataset.m] = cur0;
      } else if (sbox) {
        if (k === 'add') return;
        const cur0 = st.spot || {};
        if (k === 'on') cur0.on = e.target.checked;
        else if (k === 'color') cur0.color = e.target.value;
        else if (k === 'strength' || k === 'width') { const v = Math.max(1, clampLv(e.target.value)); cur0[k] = v; e.target.closest('.lp-line').querySelector('output').textContent = v; }
        st.spot = cur0;
      } else if (grow) {
        const P0 = presetOf();
        if (!st.mix) st.mix = Object.fromEntries(GROUPS.map((g) => [g, { ...effGroup(P0, g) }]));
        const m = st.mix[grow.dataset.g];
        if (k === 'color') m.color = e.target.value;
        else if (k === 'level') { const v = clampLv(e.target.value); m.level = v / lv; grow.querySelector('output').textContent = v; }
        syncMix();
      } else return;
      save();
    };
    panel.addEventListener('input', onInput);
    panel.addEventListener('change', onInput);
  }
  function refreshTargets() {                                       // 樂手名單變咗（轉歌／轉 plan）就更新追光名單同「加入」選項
    if (!panel || !cfg || !cfg.spots) return;
    if (targetList().map((t) => t[0]).join() !== targetKey) renderSpotMembers();
  }

  const api = {
    setConfig(c) {
      if (!c) return;
      const k = JSON.stringify(c);
      if (k === cfgKey) return;
      cfgKey = k; cfg = c; origCfg = c; origHash = hashOf(k); mvrMeta = null;
      const saved = mvrStore()[origHash];
      if (saved && Array.isArray(saved.fixtures) && saved.fixtures.length) { cfg = { ...c, rig: { ...c.rig, fixtures: saved.fixtures } }; mvrMeta = { title: saved.title, file: saved.file }; }
      buildRig();
      buildPanel();
      if (saved && !saved.fixtures && saved.file) loadFolderFile(saved.file, saved.title, true).catch(() => {});
      if (lightBtn) lightBtn.hidden = false;
    },
    setSnap(s) { snap = s; refreshTargets(); },
    fixtureCount() { return cfg ? cfg.rig.fixtures.length : 0; },
    rigTitle() { return mvrMeta ? mvrMeta.title || '' : ''; },
    describe() {                                                    // 輸出報告用：而家生效嘅設定（人睇得明嘅名同 1–10 數值）
      if (!cfg) return null;
      const P = presetOf(), lv = LV(), q = spotState();
      return {
        levels: lv, hang: hangH(),
        preset: { id: P.id, name: P.name, hint: P.hint || '', custom: !!st.mix, chase: !!(P.chase && !st.mix) },
        groups: GROUPS.map((g) => { const e = effGroup(P, g); return { id: g, label: cfg.rig.groups[g].label, color: e.color, level: Math.round(e.level * lv) }; }),
        spot: { on: q.on, color: q.color, strength: clampLv(q.strength), width: clampLv(q.width), targets: q.targets.map(nameOfTarget) },
        fog: cfg.fog.machines.map((m) => { const s = fogState(m); return { name: m.name, on: s.on, pos: (cfg.fog.positions[s.pos] || {}).name || s.pos, strength: Math.max(1, clampLv(s.strength * lv)) }; }),
      };
    },
    bindButton(btn) { lightBtn = btn; btn.hidden = !cfg; },
    toggle(force) {
      if (!panel) return false;
      const open = force == null ? panel.hidden : !!force;
      panel.hidden = !open;
      box.classList.toggle('lp-open', open);
      const wide = !window.matchMedia('(max-width: 900px)').matches;   // 手機係底部抽屜，高度由 CSS 管
      if (open && wide) { const tb = box.querySelector('.threebar'); panel.style.maxHeight = tb ? 'calc(100% - ' + (tb.offsetHeight + 16) + 'px)' : ''; } else panel.style.maxHeight = '';   // 工具列換行時面板唔好蓋住佢
      if (lightBtn) lightBtn.setAttribute('aria-pressed', String(open));
      if (open && window.matchMedia('(max-width: 900px)').matches) box.scrollIntoView({ block: 'start' });   // 手機：面板係底部抽屜，3D 窗要喺上面睇到
      return open;
    },
    stats,
    update(dt) {
      if (!cfg) return;
      dt = Math.min(0.1, dt || 0);
      if (hangH() !== builtHang) buildRig();                         // 投影幕高度變咗（或剛知道）→ 燈跟住變
      const P = presetOf(), tr = Math.max(0.05, cfg.rig.transitionSec || 0.5), a = Math.min(1, (dt / tr) * 3);
      const bpm = (getBpm && getBpm()) || 90, beats = ((getTime && getTime()) || 0) * (bpm / 60);
      // 基本光
      const bt = P.base || {};
      for (const k of ['hemi', 'ambient', 'key']) { cur[k] += ((bt[k] ?? 1) - cur[k]) * a; base[k].intensity = b0[k] * cur[k]; }
      // 追光目標：solo → highlight → 後備（主唱）
      const items = (snap && snap.items) || [];
      let tg = items.filter((i) => i.state === 'solo');
      if (!tg.length) tg = items.filter((i) => i.state === 'hl');
      if (!tg.length) tg = items.filter((i) => i.type === cfg.rig.followFallbackType);
      let sumLevel = 0;
      const tint = new THREE.Color(0, 0, 0);
      const aimOf = (id) => {                                       // 追光照住邊度：@solo／某樂手／固定點
        if (id === '@solo') { const t = tg[0]; if (t) return new THREE.Vector3(t.x, 1.1, t.y); }
        const it = items.find((i) => i.id === id);
        if (it) return new THREE.Vector3(it.x, 1.1, it.y);
        const pt = cfg.spots && cfg.spots.points[id] || (cfg.spots && Object.values(cfg.spots.points)[0]);
        return pt ? new THREE.Vector3(pt.x, pt.h ?? 1, pt.y) : new THREE.Vector3(0, 1, 8);
      };
      for (const f of fixtures) {
        let tc, tl, want = null;
        if (f.custom) {
          const s = spotState(), tid = s.targets[f.idx], ang = angleOf(s.width);
          tl = s.on && tid != null ? clampLv(s.strength) / LV() : 0; tc = s.color; want = tid != null ? aimOf(tid) : null;
          if (Math.abs(f.ang - ang) > 1e-4) {
            f.ang = ang;
            const k = Math.tan(ang) / Math.tan(f.g.angle);
            f.beam.scale.set(k, k, 1);
            if (f.spot) f.spot.angle = ang;
          }
        } else {
          const bt0 = baseTarget(f.def, P);
          tc = bt0.color; tl = bt0.level;
          if (P.chase && P.chase.colors && !st.mix && f.def.group !== 'follow') {
            const n = P.chase.colors.length, step = Math.floor(beats / (P.chase.stepBeats || 1));
            tc = P.chase.colors[(((step + f.idx) % n) + n) % n];
          }
          if (f.def.group === 'follow' && tg.length) { const t = tg[f.idx % tg.length]; want = new THREE.Vector3(t.x, 1.1, t.y); }
          if (st.fix[f.def.id] || st.zone[zones().of.get(f.def.id)]) { const ft = fixTarget(f.def, P); tc = ft.color; tl = ft.level; }   // 燈區、單支燈覆蓋組設定
        }
        f.level += (tl - f.level) * a;
        f.color.lerp(new THREE.Color(tc), Math.min(1, a * 2));
        if (want) f.aim.lerp(want, Math.min(1, dt * 6));
        if (f.custom) { f.grp.position.x = Math.max(-cfg.spots.hangXMax, Math.min(cfg.spots.hangXMax, f.aim.x)); if (f.spot) f.spot.position.x = f.grp.position.x; }   // 由前面吊台照住佢
        else if (!f.custom && f.def.group !== 'follow') f.aim.set(f.def.aim[0], f.def.aim[2], f.def.aim[1]);
        f.grp.lookAt(f.aim);
        if (f.spot) {
          const lit = f.level > 0.01;
          if (lit && !f.spot.parent) root.add(f.spot, f.spot.target);
          else if (!lit && f.spot.parent) root.remove(f.spot, f.spot.target);
          f.spot.target.position.copy(f.aim); f.spot.intensity = f.g.peak * f.level; f.spot.color.copy(f.color);
        }
        f.mat.color.copy(f.color);
        if (f.marker) {
          const inZone = !!selZone && zones().of.get(f.def.id) === selZone;
          f.marker.visible = markersOn() || inZone || (fixOpen && f.def.id === selFix);
          f.marker.material.color.set(f.level > 0.03 ? f.color : MARK[f.def.group] || 0x888888);
          f.marker.scale.setScalar(fixOpen && f.def.id === selFix ? 2.2 : inZone ? 1.6 : 1);
        }
        sumLevel += f.level;
        tint.add(f.color.clone().multiplyScalar(f.level));
      }
      if (sumLevel > 0.001) tint.multiplyScalar(1 / sumLevel);
      // 煙霧
      const pp = cfg.fog.particles;
      let hazeTarget = 0;
      machines.forEach((m) => {
        const s = fogState(m.def), pos = cfg.fog.positions[s.pos] || { x: 0, y: 0 };
        if (s.on) hazeTarget += s.strength;
        const target = s.on ? Math.round(pp.maxPuffs * s.strength) : 0, S = s.strength;
        const alive = m.puffs.filter((p) => p.alive);
        for (let k = 0; k < Math.min(pp.spawnPerFrame, target - alive.length); k++) {   // 強度高就多放幾團，煙係冒出嚟再飄開
          const p = m.puffs.find((q) => !q.alive);
          if (!p) break;
          const spread = pp.spreadBase + pp.spreadGain * S,             // 強度高 → 向四周散，唔淨係一個方向
            ang = Math.atan2(7 - pos.y, 0 - pos.x) + (Math.random() - 0.5) * spread,
            sp = pp.drift * (1 + pp.driftGain * S) * (0.6 + Math.random() * 0.6);
          p.alive = true; p.age = 0; p.life = pp.life * (1 + pp.lifeGain * S) * (0.7 + Math.random() * 0.5); p.ph = Math.random() * 6.283; p.o = { x: pos.x, z: pos.y };
          p.v.set(Math.cos(ang) * sp, pp.rise * (1 + pp.riseGain * S) * (0.7 + Math.random() * 0.6), Math.sin(ang) * sp);
          p.sprite.position.set(pos.x + (Math.random() - 0.5) * 0.4, pp.emitHeight, pos.y + (Math.random() - 0.5) * 0.4);
          p.sprite.visible = true;
        }
        let sx = 0, sz = 0, n = 0, reach = 0;
        for (const p of m.puffs) {
          if (!p.alive) continue;
          p.age += dt;
          const t = p.age / p.life;
          if (t >= 1) { p.alive = false; p.sprite.visible = false; continue; }
          const slow = 1 - pp.drag * t, w = pp.turb * (0.3 + S);       // 越飄越慢；加一個慢慢轉嘅亂流令煙到處流
          p.sprite.position.x += (p.v.x + Math.sin(p.age * pp.turbFreq + p.ph) * w) * dt * slow;
          p.sprite.position.z += (p.v.z + Math.cos(p.age * pp.turbFreq * 0.8 + p.ph * 1.3) * w) * dt * slow;
          p.sprite.position.y = Math.min(pp.limit.yMax, p.sprite.position.y + p.v.y * dt * slow);
          const lm = pp.limit;                                          // 喺場內反彈，唔飄出牆
          if (Math.abs(p.sprite.position.x) > lm.x) { p.sprite.position.x = Math.sign(p.sprite.position.x) * lm.x; p.v.x *= -0.6; }
          if (p.sprite.position.z < lm.zMin || p.sprite.position.z > lm.zMax) { p.sprite.position.z = Math.max(lm.zMin, Math.min(lm.zMax, p.sprite.position.z)); p.v.z *= -0.6; }
          const size = pp.size0 + (pp.size1 * (1 + pp.sizeGain * S) - pp.size0) * t;
          p.sprite.scale.set(size, size, 1);
          p.sprite.material.opacity = pp.peakOpacity * (0.35 + 0.65 * S) * Math.pow(Math.sin(Math.PI * t), 0.8);
          p.sprite.material.color.set(0xd5d9de).lerp(tint, Math.min(0.7, sumLevel * 0.35));
          sx += p.sprite.position.x; sz += p.sprite.position.z; n++;
          reach = Math.max(reach, Math.hypot(p.sprite.position.x - p.o.x, p.sprite.position.z - p.o.z));
        }
        m.reach = reach;
        m.cx = n ? sx / n : pos.x; m.cz = n ? sz / n : pos.y; m.n = n; m.pos = pos; m.s = s;
      });
      cur.haze += (Math.min(1, hazeTarget) - cur.haze) * Math.min(1, dt * 1.5);
      fogObj.density = pp.globalDensity * cur.haze;
      const wantFog = fogObj.density > 0.0004;
      if (wantFog && scene.fog !== fogObj) scene.fog = fogObj;
      else if (!wantFog && scene.fog === fogObj) scene.fog = null;
      // 光柱：有煙先清楚
      for (const f of fixtures) {
        f.mat.opacity = f.level * (f.g.beam ?? 0.5) * (0.04 + 0.26 * cur.haze);
        f.grp.visible = f.mat.opacity > 0.003;                        // 透明度近 0 就唔好畫（大面積 additive 好食效能）
      }
      // stats（測試用）
      stats.preset = P.id;
      stats.spot = spotState();
      stats.mix = st.mix ? JSON.parse(JSON.stringify(st.mix)) : null;
      stats.base = { hemi: +base.hemi.intensity.toFixed(3), ambient: +base.ambient.intensity.toFixed(3), key: +base.key.intensity.toFixed(3) };
      stats.fixtures = fixtures.map((f) => ({ marker: !!(f.marker && f.marker.visible), id: f.def.id, group: f.def.group, level: +f.level.toFixed(3), color: '#' + f.color.getHexString(), angle: +f.ang.toFixed(3), h: +f.grp.position.y.toFixed(2), x: +f.grp.position.x.toFixed(2), intensity: f.spot ? +f.spot.intensity.toFixed(1) : 0, beam: +f.mat.opacity.toFixed(3), aim: [+f.aim.x.toFixed(2), +f.aim.z.toFixed(2)] }));
      stats.rods = rods ? rods.geometry.attributes.position.count / 2 : 0;
      stats.fog = { density: +fogObj.density.toFixed(5), haze: +cur.haze.toFixed(3), machines: machines.map((m) => ({ id: m.def.id, on: m.s.on, pos: m.s.pos, x: m.pos.x, z: m.pos.y, strength: m.s.strength, puffs: m.n || 0, reach: +(m.reach || 0).toFixed(2), cx: +m.cx.toFixed(2), cz: +m.cz.toFixed(2) })) };
    },
  };
  return api;
}
