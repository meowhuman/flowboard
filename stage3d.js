// 3D 舞台（Black box）：器材位置、台上／SOLO／HIGHLIGHT 全部跟 2D 舞台（stage.js 嘅 snapshot）。
// 撳「3D」開關先會載入（動態 import），three.js 同 Draco 解碼器都喺站內 vendor/ 入面。
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { DRACOLoader } from 'three/addons/loaders/DRACOLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { createLighting } from './lighting.js';

const MODELS = 'media/3d';
// v2 人形（TRELLIS 圖生 3D）正面係 +Z，唔係 −Z：由觀眾側近鏡睇到背面（2026-11-07 實測）。
// 值 = 模型正面相對 −Z 轉咗幾多弧度；換人形模型時要重新量（qa/stage3d.mjs 有朝向檢查）。
const FIGURE_FRONT_YAW = Math.PI;
// 2D item type → 器材模型；人形站／坐；人形喺器材「前面」（朝觀眾方向）嘅偏移（米）
const MODEL_OF = { piano: 'piano', keyboard: 'keyboard', 'guitar-e': 'guitar-e', bass: 'bass', drums: 'drums', 'vocal-main': 'mic-stand', 'vocal-back': 'mic-stand' };
const SEATED = new Set(['piano', 'keyboard', 'drums']);
const SEATED_MODEL_SEAT = 0.46;   // musician-seated 模型嘅坐面高度（m），同琴凳一樣；坐高凳就按差額抬高
// 擺位（2D 器材位置係準，3D 唔移器材）。v2 器材模型正面（琴鍵面／大鼓面／結他面板）係 +Z，
// flip＝轉 180° 令正面朝 2D 嘅 front 方向（item.rot）；behind＝樂手企喺器材後面幾多米（器材喺樂手前面，朝觀眾）。
// 鋼琴：椅（c1）喺鋼琴 front 側，琴鍵要朝椅 → flip。Keyboard：椅喺佢背面，琴鍵朝椅 → 唔 flip。
const PLAY = {
  // pitch：模型自己琴蓋向琴鍵端低（TRELLIS 生成歪咗，實測回歸 −6.9°，只有中間兩腳著地），要抬高琴鍵端幾多度先水平
  piano: { flip: true, behind: 1.35, pitch: 6.9 },
  keyboard: { flip: false, behind: 0.75 },
  // hold：樂手拎住器材（器材同人一齊搖）。pivotY＝器材模型本地琴身中心高度；raiseTo＝拎喺幾高（m）；roll＝琴頸斜幾度；cutBelow＝切走腳架（模型本地 y 以下）
  'guitar-e': { flip: true, behind: 0.22, hold: { pivotY: 0.32, raiseTo: 0.95, roll: 40, cutBelow: 0.12 } },
  bass: { flip: true, behind: 0.3, hold: {} },
  drums: { flip: true, behind: 0.3 },
  'vocal-main': { flip: true, behind: 0.4 },
  'vocal-back': { flip: true, behind: 0.4 },
};
const COLORS = { on: '#d7ddd5', solo: '#ffc233', hl: '#31c6f5', prop: '#e8a39b' };
const PROP = new Set(['prop-car', 'chair']);
const PIANIST_TURN = Math.PI;   // 坐喺琴凳嘅樂手要面向鋼琴（模型正面 -Z 係琴鍵一邊，所以轉 180°）
const TAG_H = { 'prop-car': 1.1, chair: 0.8, piano: 1.9, keyboard: 2.0, 'guitar-e': 2.1, bass: 2.35, drums: 2.0, 'vocal-main': 2.15, 'vocal-back': 2.15 };

export async function mount(box, api) {
  const probe = document.createElement('canvas');
  if (!(probe.getContext('webgl2') || probe.getContext('webgl'))) throw new Error('瀏覽器唔支援 WebGL');
  box.innerHTML = '';
  const canvas = document.createElement('canvas');
  const bar = document.createElement('div');
  bar.className = 'threebar';
  bar.innerHTML = '<span class="modeseg" role="group" aria-label="舞台視圖"><button data-mode="2d" class="smallbtn">僅 2D</button><button data-mode="3d" class="smallbtn">僅 3D</button><button data-mode="both" class="smallbtn">2D + 3D</button><button data-mode="off" class="smallbtn">關閉舞台</button></span><span class="camseg"><button data-cam="aud" class="smallbtn">觀眾席</button><button data-cam="top" class="smallbtn">俯視</button><button data-cam="seat" class="smallbtn">座位視角</button><button data-cam="side" class="smallbtn">側面</button></span><button data-labels="1" class="smallbtn" aria-pressed="true">名牌</button><button data-outfit="1" class="smallbtn" title="樂手性別同服裝">服裝</button><button data-light="1" class="smallbtn" aria-pressed="false" title="燈光 preset 同煙霧機（試吓感覺）" hidden>燈光</button>';
  const note = document.createElement('div');
  note.className = 'threenote';
  note.textContent = '載入模型中…';
  box.append(canvas, bar, note);

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 2));
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0d0c);
  const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 200);
  const controls = new OrbitControls(camera, canvas);
  controls.maxPolarAngle = Math.PI * 0.49;
  controls.minDistance = 3;
  controls.maxDistance = 70;

  // 燈光：夠亮睇得清器材，SOLO／HIGHLIGHT 先用聚光突出
  const hemi = new THREE.HemisphereLight(0xc8d0e0, 0x30363a, 1.1),
    ambient = new THREE.AmbientLight(0xffffff, 0.45),
    key = new THREE.DirectionalLight(0xffffff, 1.0);
  key.position.set(-6, 14, 20);
  scene.add(hemi, ambient, key);
  // 燈光 preset ＋ 煙霧機（lighting.js；設定喺 stage-plans.json 嘅 lighting）。冇播放時用牆鐘做節拍，咁睇到顏色循環
  const light = createLighting({
    THREE, scene, box, base: { hemi, ambient, key },
    getHang: () => screenTop,                                      // 燈吊喺投影幕頂嘅高度
    getBpm: () => curBpm || (curMotion && curMotion.defaultBpm) || 90,
    getTime: () => {
      const a = document.getElementById('audio');
      return stats.forceClock != null ? stats.forceClock : a && !a.paused ? a.currentTime : performance.now() / 1000;
    },
  });
  light.bindButton(bar.querySelector('[data-light]'));
  // 場地選單：stage-plans.json 有多張舞台圖（各自 venue／stage／room／燈位）就出現，揀咗即換 3D 場地同 2D 圖
  const venueSel = document.createElement('select');
  venueSel.className = 'smallbtn venuesel';
  venueSel.setAttribute('aria-label', '選擇場地');
  venueSel.title = '選擇場地／舞台方案';
  venueSel.hidden = true;
  bar.append(venueSel);
  venueSel.onchange = () => api.setPlan && api.setPlan(venueSel.value);
  function syncVenue() {
    const ps = api.plans ? api.plans() : [];
    venueSel.hidden = ps.length === 0;
    if (!ps.length) return;
    const sig = ps.map((p) => p.id + p.title).join('|');
    if (venueSel.dataset.sig !== sig) {
      venueSel.dataset.sig = sig;
      venueSel.innerHTML = ps.map((p) => `<option value="${p.id}">${p.title.replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c])}</option>`).join('');
    }
    venueSel.value = api.planId();
  }
  syncVenue();
  api.onChange(syncVenue);

  const loader = new GLTFLoader();
  const draco = new DRACOLoader();
  draco.setDecoderPath('vendor/three/examples/jsm/libs/draco/gltf/');
  loader.setDRACOLoader(draco);
  const cache = new Map();
  const load = (id) => cache.get(id) || cache.set(id, loader.loadAsync(`${MODELS}/${id}.glb`).then((g) => g.scene)).get(id);

  // 車頭道具（約 140×52×30 cm，紅身、銀 bumper、4 個車燈）：程序化，正面朝 -Z（同其他模型一致）
  function carFront(w = 1.4, d = 0.3, h = 0.52) {
    const g = new THREE.Group(),
      red = new THREE.MeshStandardMaterial({ color: 0xb0382c, roughness: 0.45, metalness: 0.3 }),
      chrome = new THREE.MeshStandardMaterial({ color: 0xc8ccd0, roughness: 0.25, metalness: 0.9 }),
      dark = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.8 }),
      lamp = new THREE.MeshStandardMaterial({ color: 0xfff6d8, emissive: 0xfff6d8, emissiveIntensity: 0.6 });
    const body = new THREE.Mesh(new THREE.BoxGeometry(w, h * 0.45, d), red);
    body.position.set(0, h * 0.78, 0);
    const grille = new THREE.Mesh(new THREE.BoxGeometry(w * 0.62, h * 0.32, d * 0.9), dark);
    grille.position.set(0, h * 0.4, -d * 0.04);
    const bumper = new THREE.Mesh(new THREE.BoxGeometry(w * 1.03, h * 0.14, d * 1.1), chrome);
    bumper.position.set(0, h * 0.11, -d * 0.05);
    g.add(body, grille, bumper);
    for (const sx of [-0.4, -0.25, 0.25, 0.4]) {
      const l = new THREE.Mesh(new THREE.SphereGeometry(0.06, 12, 8), lamp);
      l.position.set(sx * w, h * 0.46, -d * 0.52);
      g.add(l);
    }
    return g;
  }
  // 琴凳：黑色長凳（約 80×40 cm，高 46 cm）
  function chairModel(w = 0.8, d = 0.4, h = 0.46) {
    const g = new THREE.Group(),
      seat = new THREE.MeshStandardMaterial({ color: 0x15171a, roughness: 0.4, metalness: 0.2 }),
      leg = new THREE.MeshStandardMaterial({ color: 0x2a2d31, roughness: 0.6 });
    const top = new THREE.Mesh(new THREE.BoxGeometry(w, 0.07, d), seat);
    top.position.y = h - 0.035;
    g.add(top);
    for (const sx of [-1, 1])
      for (const sz of [-1, 1]) {
        const l = new THREE.Mesh(new THREE.BoxGeometry(0.04, h - 0.07, 0.04), leg);
        l.position.set(sx * (w / 2 - 0.05), (h - 0.07) / 2, sz * (d / 2 - 0.05));
        g.add(l);
      }
    return g;
  }
  let platKey = '';
  const platGroup = new THREE.Group();
  scene.add(platGroup);
  function buildPlatforms(s) {
    const key3 = JSON.stringify(s.platforms || []);
    if (key3 === platKey) return;
    platKey = key3;
    platGroup.clear();
    const mat = new THREE.MeshStandardMaterial({ color: 0x3a423c, roughness: 0.95 });
    for (const pf of s.platforms || []) {
      const m = new THREE.Mesh(new THREE.BoxGeometry(pf.w, pf.h, pf.d), mat);
      m.position.set(pf.x, pf.h / 2, pf.y);
      m.rotation.y = (-(pf.rot || 0) * Math.PI) / 180;
      const edges = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: 0x7d8a70 }));
      m.add(edges);
      platGroup.add(m);
    }
  }
  // 器材喺邊個平台上（旋轉矩形內），就抬高平台高度
  function elevation(it, platforms) {
    for (const pf of platforms || []) {
      const a = ((pf.rot || 0) * Math.PI) / 180,
        dx = it.x - pf.x,
        dz = it.y - pf.y,
        lx = dx * Math.cos(a) + dz * Math.sin(a),
        lz = -dx * Math.sin(a) + dz * Math.cos(a);
      if (Math.abs(lx) <= pf.w / 2 && Math.abs(lz) <= pf.d / 2) return pf.h;
    }
    return 0;
  }

  let stageKey = '',
    showLabels = true;
  const nodes = new Map();
  const staticGroup = new THREE.Group();
  scene.add(staticGroup);
  const stats = { frames: 0, bounds: {}, items: {} };
  window.__stage3d = stats;
  stats.lighting = light.stats;
  // 測試用：每個可見人形嘅「真實」朝向。腳掌／大腿重心相對身體重心，沿模型自己正面軸（+Z）嘅偏移 > 0 ＝ 模型正面慣例啱（唔論樂手面向邊）。
  // 唔靠旋轉數學，直接量世界座標頂點，所以換模型或轉錯方向都會被抓到。
  stats.facing = () => {
    const out = {}, v = new THREE.Vector3();
    for (const f of figs) {
      if (!f.root.visible) continue;
      let feet = [0, 0], body = [0, 0], base = Infinity;
      f.root.updateWorldMatrix(true, true);
      const fd = f.root.getWorldDirection(new THREE.Vector3());
      f.root.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); base = Math.min(base, v.y); }
      });
      f.root.traverse((o) => {
        if (!o.isMesh || !o.geometry.attributes.position) return;
        const p = o.geometry.attributes.position;
        for (let i = 0; i < p.count; i++) {
          v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld);
          const h = v.y - base;
          const along = v.x * fd.x + v.z * fd.z;
          if (h < 0.1) { feet[0] += along; feet[1]++; } else if (h > 0.3 && h < 1.5) { body[0] += along; body[1]++; }
        }
      });
      out[f.itemId + ':' + f.kind] = feet[1] && body[1] ? +(feet[0] / feet[1] - body[0] / body[1]).toFixed(3) : null;
    }
    return out;
  };
  // 測試用：每個可見人形嘅「模型 +Z 軸」喺世界座標嘅 z 分量（1 ＝ 正面向觀眾）。
  // 測試用：每件器材同其樂手嘅世界座標＋正面方向（x,z 單位向量）。
  // 測試／量度用：器材模型喺自己本地座標嘅高度分帶（每 0.1 m 一帶：x、z 範圍），用嚟決定點擺先似「拎住」。
  // 測試用：器材上半部（模型本地高過 0.6 m）嘅世界高度對前進方向回歸斜率（0＝水平）同最低點
  stats.tilt = (id) => {
    const n = nodes.get(id), inst = n && flagged(n.group, 'isInst');
    if (!inst) return null;
    inst.updateWorldMatrix(true, true);
    const f = inst.getWorldDirection(new THREE.Vector3()), v = new THREE.Vector3(), pts = [];
    let ymin = Infinity;
    inst.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const p = o.geometry.attributes.position;
      for (let i = 0; i < p.count; i++) { v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld); ymin = Math.min(ymin, v.y); if (p.getY(i) > 0.6) pts.push([v.x * f.x + v.z * f.z, v.y]); }   // 用模型本地高度揀同一批頂點（琴蓋），唔受校正後高度變化影響
    });
    const m = (k) => pts.reduce((a, q) => a + q[k], 0) / pts.length, mx = m(0), my = m(1);
    let sxy = 0, sxx = 0;
    for (const q of pts) { sxy += (q[0] - mx) * (q[1] - my); sxx += (q[0] - mx) ** 2; }
    return { slope: +(sxy / sxx).toFixed(4), ymin: +ymin.toFixed(3) };
  };
  stats.shape = (id) => {
    const n = nodes.get(id), inst = n && flagged(n.group, 'isInst');
    if (!inst) return null;
    inst.updateWorldMatrix(true, true);
    const inv = inst.matrixWorld.clone().invert(), v = new THREE.Vector3(), bands = {};
    inst.traverse((o) => {
      if (!o.isMesh || !o.geometry.attributes.position) return;
      const p = o.geometry.attributes.position, ix = o.geometry.index ? o.geometry.index.array : null, used = ix ? new Set(ix) : null;
      for (let i = 0; i < p.count; i++) {
        if (used && !used.has(i)) continue;                          // 被切走嘅頂點唔計
        v.fromBufferAttribute(p, i).applyMatrix4(o.matrixWorld).applyMatrix4(inv);
        const k = Math.floor(v.y * 10) / 10, b = bands[k] || (bands[k] = { x0: 9, x1: -9, z0: 9, z1: -9, n: 0 });
        b.x0 = Math.min(b.x0, v.x); b.x1 = Math.max(b.x1, v.x); b.z0 = Math.min(b.z0, v.z); b.z1 = Math.max(b.z1, v.z); b.n++;
      }
    });
    return Object.fromEntries(Object.entries(bands).sort((a, b) => a[0] - b[0]).map(([k, b]) => [k, `x[${b.x0.toFixed(2)},${b.x1.toFixed(2)}] z[${b.z0.toFixed(2)},${b.z1.toFixed(2)}] n=${b.n}`]));
  };
  stats.layout = () => {
    const out = {}, d = new THREE.Vector3(), p = new THREE.Vector3();
    for (const [id, n] of nodes) {
      const inst = flagged(n.group, 'isInst'), fig = flagged(n.group, 'facing');
      if (!inst) continue;
      const dir = (o) => { o.getWorldDirection(d); return { x: +d.x.toFixed(3), z: +d.z.toFixed(3) }; };
      out[id] = { type: n.group.userData.type, inst: { x: n.group.position.x, z: n.group.position.z, front: dir(inst) } };
      if (fig) { fig.getWorldPosition(p); out[id].person = { x: +p.x.toFixed(3), z: +p.z.toFixed(3), front: dir(fig) }; }
    }
    return out;
  };
  stats.frontZ = () => {
    const out = {}, d = new THREE.Vector3();
    for (const f of figs) if (f.root.visible) out[f.itemId + ':' + f.kind] = +f.root.getWorldDirection(d).z.toFixed(3);
    return out;
  };
  stats.personAt = (id) => {                                         // 測試用：而家可見嗰個人（企／坐）嘅世界座標
    const n = nodes.get(id), v = n && n.persons.find((q) => q.visible && n.group.visible);
    if (!v) return null;
    const p = new THREE.Vector3();
    v.updateWorldMatrix(true, false);
    v.getWorldPosition(p);
    return { x: +p.x.toFixed(3), y: +p.y.toFixed(3), z: +p.z.toFixed(3), pose: v.userData.pose };
  };
  stats.focus = (x, z, dist = 6, elev = 8) => { touched = true; camera.position.set(x, elev, z + dist); controls.target.set(x, 0.5, z); controls.update(); };

  // ---- 投影幕：用 board 嘅影片（loop proxy）做貼圖，同影片窗同步；冇影片就顯示提示 ----
  let screenMesh = null,
    screenTop = null,
    screenDims = '';
  const vid = api.getVideo && api.getVideo();
  const vtex = vid ? new THREE.VideoTexture(vid) : null;
  if (vtex) vtex.colorSpace = THREE.SRGBColorSpace;
  let ptex = null,
    ptexKey = '';
  function placeholder() {
    if (ptexKey === screenDims && ptex) return ptex;
    const c = document.createElement('canvas');
    c.width = 1024; c.height = 598;
    const x = c.getContext('2d');
    x.fillStyle = '#16283a'; x.fillRect(0, 0, c.width, c.height);
    x.strokeStyle = '#2d5d8a'; x.lineWidth = 6; x.strokeRect(10, 10, c.width - 20, c.height - 20);
    x.fillStyle = '#9fc4e6'; x.font = '700 44px system-ui, sans-serif'; x.textAlign = 'center';
    x.fillText('投影幕 ' + screenDims, c.width / 2, c.height / 2 - 10);
    x.font = '30px system-ui, sans-serif'; x.fillStyle = '#7ba3c8';
    x.fillText('揀影片或播放歌曲，呢度會顯示投影內容', c.width / 2, c.height / 2 + 44);
    ptex = new THREE.CanvasTexture(c); ptex.colorSpace = THREE.SRGBColorSpace; ptexKey = screenDims;
    return ptex;
  }
  let lastTextured = null;
  function syncScreen(force) {
    if (!screenMesh) return;
    const ready = !!(vid && vid.getAttribute('src') && vid.readyState >= 2 && vid.videoWidth > 0);
    if (!force && ready === lastTextured) return;
    lastTextured = ready;
    screenMesh.material.map = ready ? vtex : placeholder();
    screenMesh.material.needsUpdate = true;
    stats.screen = { textured: ready, w: vid ? vid.videoWidth : 0, h: vid ? vid.videoHeight : 0, dims: screenDims };
  }
  if (vid) for (const ev of ['loadeddata', 'emptied', 'playing', 'error']) vid.addEventListener(ev, () => syncScreen());

  // ---- Black box：黑箱（官方 Wall-to-Wall 19.9×33 m、高 10.24 m）＋ 官方座位圖 465 座（AA–T，I／O 行無）----
  let seatInfo = null;
  const seatRows = [];
  const walls = [];                       // 睇落去由牆外望入嚟時要透明，唔好擋視線
  function addWall(mesh, inward) {
    mesh.material = mesh.material.clone();
    mesh.userData.inward = inward.clone().normalize();
    walls.push(mesh);
    staticGroup.add(mesh);
  }
  const _v = new THREE.Vector3();
  function updateWalls() {
    for (const w of walls) {
      const outside = _v.copy(camera.position).sub(w.position).dot(w.userData.inward) < 0;
      w.material.transparent = true;
      w.material.opacity = outside ? 0.04 : 1;
      w.material.depthWrite = !outside;
    }
    stats.walls = walls.map((w) => +w.material.opacity.toFixed(2));
    // 座位：行比鏡頭更近舞台（喺鏡頭同舞台之間）＝擋住視線，變透明
    for (const r of seatRows) {
      const block = r.z < camera.position.z - 0.3;
      for (const mat of r.mats) {
        mat.transparent = true;
        mat.opacity = block ? 0.08 : 1;
        mat.depthWrite = !block;
      }
    }
    stats.seatOpacity = seatRows.map((r) => +r.mats[0].opacity.toFixed(2));
  }
  function buildRoom(s, room) {
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x111413, roughness: 1, side: THREE.DoubleSide }),
      floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1d1b, roughness: 0.95 }),
      H = room.h || 10;
    const big = new THREE.Mesh(new THREE.PlaneGeometry(room.w, room.l), floorMat);
    big.rotation.x = -Math.PI / 2;
    big.position.set(0, -0.02, room.l / 2);
    staticGroup.add(big);
    for (const sx of [-1, 1]) {
      const w = new THREE.Mesh(new THREE.PlaneGeometry(room.l, H), wallMat);
      w.rotation.y = -sx * Math.PI / 2;
      w.position.set(sx * (room.w / 2), H / 2, room.l / 2);
      addWall(w, new THREE.Vector3(-sx, 0, 0));
    }
    const rear = new THREE.Mesh(new THREE.PlaneGeometry(room.w, H), wallMat);
    rear.position.set(0, H / 2, room.l);
    addWall(rear, new THREE.Vector3(0, 0, -1));
    const st = room.seats, rows = room.seatRows;
    if (!st || !rows) return;
    const n = rows.reduce((a, r) => a + (r.from - r.to + 1), 0),
      seatGeo = new THREE.BoxGeometry(0.46, 0.08, 0.46),
      backGeo = new THREE.BoxGeometry(0.46, 0.42, 0.07),
      m = new THREE.Matrix4();
    seatRows.length = 0;
    let tier = 0;
    rows.forEach((row, k) => {
      const isFloor = (st.floorRows || []).includes(row.r),
        h = isFloor ? st.baseLevel : st.baseLevel + tier * st.rake;
      if (!isFloor) tier++;
      const z = s.d + st.gap + k * st.rowDepth,
        count = row.from - row.to + 1,
        cx = ((row.from + row.to) / 2 - st.colMid) * -st.pitch;   // 座號大＝觀眾右手邊（+x）
      // 每行自己一組物料：鏡頭喺佢後面（行比鏡頭近舞台）就變透明，唔擋視線
      const seatMat = new THREE.MeshStandardMaterial({ color: 0x2a3038, roughness: 0.85 }),
        riserMat = new THREE.MeshStandardMaterial({ color: 0x161917, roughness: 1 }),
        riser = new THREE.Mesh(new THREE.BoxGeometry(count * st.pitch + 0.3, h, st.rowDepth), riserMat),
        seats = new THREE.InstancedMesh(seatGeo, seatMat, count),
        backs = new THREE.InstancedMesh(backGeo, seatMat, count);
      riser.position.set(cx, h / 2, z);
      let i = 0;
      for (let nseat = row.from; nseat >= row.to; nseat--) {
        const x = (nseat - st.colMid) * st.pitch;
        m.makeTranslation(x, h + 0.45, z);
        seats.setMatrixAt(i, m);
        m.makeTranslation(x, h + 0.45 + 0.25, z + st.rowDepth * 0.36);
        backs.setMatrixAt(i, m);
        i++;
      }
      staticGroup.add(riser, seats, backs);
      seatRows.push({ z, mats: [seatMat, riserMat] });
    });
    const rowZ = (k) => s.d + st.gap + k * st.rowDepth, tierOf = (k) => (rows[k] && (st.floorRows || []).includes(rows[k].r) ? st.baseLevel : st.baseLevel + (k - (st.floorRows || []).length) * st.rake);
    seatInfo = { count: n, rows: rows.length, rowZ, tierOf, eyeRow: Math.min(9, rows.length - 1) };
    stats.seats = { count: n, rows: rows.length, last: { row: rows[rows.length - 1].r, z: rowZ(rows.length - 1) } };
  }

  function buildStage(s, room) {
    const key2 = `${s.w}x${s.d}x${s.lw}x${s.lo}x${s.sh}x${s.sy}|${JSON.stringify(room || null)}`;
    if (key2 === stageKey) return;
    stageKey = key2;
    staticGroup.clear();
    walls.length = 0;
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(s.w, s.d), new THREE.MeshStandardMaterial({ color: 0x252c27, roughness: 0.9 }));
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(0, 0, s.d / 2);
    const grid = new THREE.GridHelper(Math.max(s.w, s.d), Math.max(s.w, s.d) * 2, 0x3a423c, 0x2b322d);
    grid.position.set(0, 0.01, s.d / 2);
    const wallMat = new THREE.MeshStandardMaterial({ color: 0x111413, roughness: 1, side: THREE.DoubleSide });
    const H = (room && room.h) || 10;
    const back = new THREE.Mesh(new THREE.PlaneGeometry(s.w + 6, H), wallMat);
    back.position.set(0, H / 2, -0.02);
    addWall(back, new THREE.Vector3(0, 0, 1));
    staticGroup.add(floor, grid);
    const sh = s.sh || 5, sy = s.sy || 0.7;
    screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(s.lw, sh), new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false }));
    screenMesh.position.set(0, sy + sh / 2, s.lo + 0.02);
    screenDims = `${s.lw} × ${sh} m`;
    screenTop = sy + sh;
    syncScreen(true);
    staticGroup.add(screenMesh);
    if (room) buildRoom(s, room);
    setCam('aud', s);
  }
  // 鏡頭按窗口比例拉遠／拉近，窄格都睇到成個舞台闊度
  function setCam(kind, s = lastStage) {
    if (!s) return;
    const t = new THREE.Vector3(0, kind === 'aud' ? 2.4 : 0.8, s.d * 0.45),
      vf = THREE.MathUtils.degToRad(camera.fov),
      hf = 2 * Math.atan(Math.tan(vf / 2) * Math.max(camera.aspect, 0.3)),
      need = (s.w / 2 + 2) / Math.tan(hf / 2);                   // 要睇晒舞台闊度所需距離
    if (kind === 'seat' && seatInfo) {
      const k = seatInfo.eyeRow;
      camera.position.set(0, seatInfo.tierOf(k) + 0.45 + 0.75, seatInfo.rowZ(k));
      // 座位視角：鏡頭位置固定（坐喺該排），所以按投影幕頂同台面調上下仰角，保證幕頂唔會切走
      const camY = camera.position.y,
        dzScreen = Math.max(Math.abs((s.lo || 0) - camera.position.z), 1),
        dzStage = Math.max(Math.abs(s.d * 0.45 - camera.position.z), 1),
        aTop = Math.atan2((screenTop == null ? 3 : screenTop) - camY, dzScreen),
        aFeet = Math.atan2(0.2 - camY, dzStage),
        c = aTop - aFeet <= vf * 0.88 ? (aTop + aFeet) / 2 : aTop - (vf / 2) * 0.88;
      controls.target.set(0, camY + Math.tan(c) * dzStage, s.d * 0.45);
      controls.update();
      camKind = kind;
      syncCamBtns();
      return;
    }
    if (kind === 'top') camera.position.set(0, Math.max(s.d * 1.9, need * 0.95), s.d * 0.55);
    else if (kind === 'side') camera.position.set(Math.max(s.w * 1.1, need * 0.8), 6, s.d * 0.5);
    else camera.position.set(0, Math.max(10, need * 0.42), Math.max(s.d + 9, t.z + need * 0.8));
    controls.target.copy(t);
    controls.update();
    camKind = kind;
    syncCamBtns();
  }
  let camKind = 'aud',
    touched = false;
  controls.addEventListener('start', () => (touched = true));
  let lastStage = null;
  const syncModeBtns = () => bar.querySelectorAll('[data-mode]').forEach((b) => b.setAttribute('aria-pressed', String(b.dataset.mode === 'off' ? !api.getMode() : api.getMode() === b.dataset.mode)));
  const syncCamBtns = () => bar.querySelectorAll('[data-cam]').forEach((b) => b.setAttribute('aria-pressed', String(camKind === b.dataset.cam)));
  syncCamBtns();
  bar.onclick = (e) => {
    const d = e.target.dataset || {};
    if (d.cam) { touched = false; setCam(d.cam); }
    if (d.mode) api.setMode(d.mode);
    if (d.outfit && window.People) People.openDialog();
    if (d.light) light.toggle();
    if (d.labels) {
      showLabels = !showLabels;
      e.target.setAttribute('aria-pressed', String(showLabels));
      for (const n of nodes.values()) n.sprite.visible = showLabels && n.group.userData.type !== 'chair';
      stats.labels = showLabels;
    }
  };

  function tag(text, color) {
    const c = document.createElement('canvas');
    c.width = 320; c.height = 72;
    const x = c.getContext('2d');
    x.font = '700 34px system-ui, sans-serif';
    x.textAlign = 'center'; x.textBaseline = 'middle';
    x.lineWidth = 8; x.strokeStyle = '#0b0d0c'; x.strokeText(text, 160, 38);
    x.fillStyle = color; x.fillText(text, 160, 38);
    return c;
  }
  const shortName = (label) => { const i = String(label).indexOf(' ★'); return i > 0 ? label.slice(0, i) : label; };

  async function ensure(it) {
    if (nodes.has(it.id)) return nodes.get(it.id);
    const group = new THREE.Group();
    let body = null;
    group.userData.id = it.id;
    if (it.type === 'prop-car') {
      const car = carFront(it.w, it.d, it.h);
      if (it.elev > 0) {
        const plinth = new THREE.Mesh(new THREE.BoxGeometry((it.w || 1.4) + 0.1, it.elev, (it.d || 0.3) + 0.1), new THREE.MeshStandardMaterial({ color: 0xe9e6df, roughness: 0.8 }));
        plinth.position.y = it.elev / 2;
        car.position.y = it.elev;
        group.add(plinth);
      }
      group.add(car);
    } else if (it.type === 'chair') group.add(chairModel(it.w, it.d, it.h));
    else try {
      const inst = (await load(MODEL_OF[it.type])).clone(true),
        play = PLAY[it.type] || { flip: false, behind: 0.6 };
      inst.rotation.y = play.flip ? Math.PI : 0;
      inst.userData.isInst = true;
      body = new THREE.Group();                                      // 人（同拎住嘅器材）一齊搖擺嘅容器
      body.rotation.order = 'YXZ';
      group.add(body);
      if (play.hold) {
        const h = play.hold;
        if (h.cutBelow) cutLow(inst, h.cutBelow);
        const pivot = new THREE.Group();
        pivot.position.y = h.raiseTo || 0;
        pivot.rotation.z = ((h.roll || 0) * Math.PI) / 180;
        inst.position.y = -(h.pivotY || 0);
        pivot.add(inst);
        body.add(pivot);
      } else group.add(inst);
      if (play.pitch) {                                              // 校正歪咗嘅模型：繞器材本地 X 軸抬高琴鍵端，再貼返地
        inst.rotation.order = 'YXZ';
        inst.rotation.x = (-play.pitch * Math.PI) / 180;
        group.updateMatrixWorld(true);
        inst.position.y -= new THREE.Box3().setFromObject(inst, true).min.y;       // true＝按頂點量（唔用外框，旋轉後外框會偏低）
      }
      if (!it.player) {                                              // 共用樂手（例如鋼琴＋Keyboard）喺 players 處理
        const person = (await load(SEATED.has(it.type) ? 'musician-seated' : 'musician-standing')).clone(true);
        person.position.set(0, 0, play.behind);                      // 本地 +z ＝ 器材 front 嘅反方向：人企喺器材後面，器材喺人前面
        person.rotation.y = -FIGURE_FRONT_YAW;                       // 樂手面向器材 front 方向（rot 0 ＝ 觀眾）
        person.userData.facing = true;
        person.userData.pose = SEATED.has(it.type) ? 'seated' : 'standing';
        body.add(person);
        if (it.chair && it.sitWhen) {                                // 有凳（例如結他嘅高凳）：另外有一個坐姿，指定狀態（例如 solo）先坐
          const sp = (await load('musician-seated')).clone(true);
          sp.position.set(0, 0, play.behind);
          sp.rotation.y = -FIGURE_FRONT_YAW;
          sp.userData.facing = true;
          sp.userData.pose = 'seated';
          sp.visible = false;
          body.add(sp);
        }
      }
    } catch (e) { note.textContent = '模型載入失敗：' + e.message; }
    // 每個 mesh 只 clone 一次物料，之後只改 emissive
    group.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.hasEmissive = 'emissive' in o.material; } });
    const persons = [];
    group.traverse((o) => { if (o.userData.facing) persons.push(o); });
    for (const fig of persons) { const f = { root: fig, kind: fig.userData.pose || (SEATED.has(it.type) ? 'seated' : 'standing'), itemId: it.id }; figs.push(f); dressFigure(f); }
    const spot = new THREE.SpotLight(0xffffff, 0, 10, 0.5, 0.5, 1);
    spot.position.set(0, 6.5, 0);
    spot.target = group;
    group.add(spot);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(tag('', '#fff')), depthTest: false, transparent: true }));
    sprite.scale.set(1.9, 0.43, 1);
    sprite.position.set(0, TAG_H[it.type] || 2.1, 0);
    group.userData.type = it.type;
    sprite.visible = showLabels && it.type !== 'chair';
    sprite.renderOrder = 10;
    group.add(sprite);
    scene.add(group);
    const n = { group, spot, sprite, lastLabel: '', body, persons, behind: (PLAY[it.type] || {}).behind || 0, state: 'off' };
    nodes.set(it.id, n);
    return n;
  }

  // ---- 人物：性別（女＝較矮、長髮、可着裙）同服裝（按身體高度分帶上色）----
  const figs = [];
  const SKIN = new THREE.Color('#cfc9c0');
  const flagged = (root, key) => { let r = null; root.traverse((o) => { if (!r && o.userData[key]) r = o; }); return r; };
  // 拎住嘅器材：切走模型本地 y < cut 嘅三角形（腳架）。geometry 係 cache 共用，所以先 clone
  function cutLow(inst, cut) {
    inst.updateMatrixWorld(true);
    const v = new THREE.Vector3();
    inst.traverse((o) => {
      if (!o.isMesh || !o.geometry.index) return;
      const g = o.geometry.clone(), pos = g.attributes.position, idx = g.index.array, keep = [];
      for (let i = 0; i < idx.length; i += 3) {
        let hi = false;
        for (let k = 0; k < 3; k++) { v.fromBufferAttribute(pos, idx[i + k]).applyMatrix4(o.matrixWorld); if (v.y >= cut) hi = true; }
        if (hi) keep.push(idx[i], idx[i + 1], idx[i + 2]);
      }
      g.setIndex(keep);
      o.geometry = g;
    });
  }
  function dressFigure(f) {
    const P = window.People && People.get(f.itemId);
    if (!P || !P.outfit) return;
    const { gender, outfit } = P,
      root = f.root,
      seated = f.kind === 'seated';
    if (!f.prep) {
      root.updateMatrixWorld(true);
      const inv = new THREE.Matrix4().copy(root.matrixWorld).invert(),
        meshes = [],
        v = new THREE.Vector3();
      let ymin = 1e9, ymax = -1e9, sx = 0, sz = 0, n = 0;
      root.traverse((o) => {
        if (!o.isMesh || o.userData.extra) return;
        o.geometry = o.geometry.clone();
        const rel = new THREE.Matrix4().multiplyMatrices(inv, o.matrixWorld),
          pos = o.geometry.attributes.position,
          pts = new Float32Array(pos.count * 3);
        for (let i = 0; i < pos.count; i++) {
          v.fromBufferAttribute(pos, i).applyMatrix4(rel);
          pts[i * 3] = v.x; pts[i * 3 + 1] = v.y; pts[i * 3 + 2] = v.z;
          ymin = Math.min(ymin, v.y); ymax = Math.max(ymax, v.y); sx += v.x; sz += v.z; n++;
        }
        meshes.push({ o, pts });
      });
      const H = Math.max(ymax - ymin, 0.1);
      // 頭部範圍（t > 0.86）：用嚟擺長髮
      let hx0 = 1e9, hx1 = -1e9, hz0 = 1e9, hz1 = -1e9, hy1 = -1e9;
      for (const { pts } of meshes) for (let i = 0; i < pts.length; i += 3) if ((pts[i + 1] - ymin) / H > 0.86) { hx0 = Math.min(hx0, pts[i]); hx1 = Math.max(hx1, pts[i]); hz0 = Math.min(hz0, pts[i + 2]); hz1 = Math.max(hz1, pts[i + 2]); hy1 = Math.max(hy1, pts[i + 1]); }
      f.prep = { meshes, ymin, H, cx: sx / n, cz: sz / n, head: { cx: (hx0 + hx1) / 2, cz: (hz0 + hz1) / 2, r: Math.max((hx1 - hx0) / 2, 0.05), top: hy1 } };
      const mk = (geo) => { const m = new THREE.Mesh(geo, new THREE.MeshStandardMaterial({ color: 0x888888, roughness: 0.8, side: THREE.DoubleSide })); m.userData.extra = true; m.userData.hasEmissive = true; root.add(m); return m; };
      f.hair = mk(new THREE.SphereGeometry(1, 14, 10));
      f.skirt = mk(new THREE.CylinderGeometry(1, 1, 1, 18, 1, true));
    }
    const { meshes, ymin, H, cx, head } = f.prep,
      col = (hex) => new THREE.Color(hex).multiplyScalar(1.25),
      cTop = col(outfit.top), cBot = col(outfit.bottom), cShoe = col(outfit.shoes), cHair = col(outfit.hair),
      bare = gender === 'f' && (outfit.style === 'skirt' || outfit.style === 'dress'),
      dress = gender === 'f' && outfit.style === 'dress';
    let vcTop = null;
    for (const { o, pts } of meshes) {
      const count = pts.length / 3,
        arr = new Float32Array(count * 3);
      for (let i = 0; i < count; i++) {
        const x = pts[i * 3], t = (pts[i * 3 + 1] - ymin) / H;
        let c = SKIN;
        if (seated) {
          if (t < 0.07) c = cShoe;
          else if (t < 0.58) c = cBot;
          else if (t < 0.84) { c = cTop; if (vcTop === null) vcTop = c; }
          else if (t > 0.955) c = cHair;
        } else if (t < 0.055) c = cShoe;
        else if (t < 0.5) c = t > 0.4 && Math.abs(x - cx) > 0.12 * H ? SKIN : bare && t < 0.3 ? SKIN : dress ? cTop : cBot;
        else if (t < 0.83) { c = cTop; if (vcTop === null) vcTop = c; }
        else if (t > 0.945) c = cHair;
        arr[i * 3] = Math.min(1, c.r); arr[i * 3 + 1] = Math.min(1, c.g); arr[i * 3 + 2] = Math.min(1, c.b);
      }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(arr, 3));
      o.material.vertexColors = true;
      o.material.needsUpdate = true;
    }
    root.scale.setScalar(gender === 'f' ? 0.95 : 1);
    const hd = f.prep.head;
    f.hair.visible = gender === 'f';
    f.hair.material.color.set(outfit.hair);
    f.hair.scale.set(hd.r * 1.08, hd.r * 1.55, hd.r * 1.0);
    f.hair.position.set(hd.cx, hd.top - hd.r * 1.35, hd.cz + hd.r * 0.5);
    f.skirt.visible = !seated && bare;
    f.skirt.material.color.set(outfit.bottom);
    const sh = 0.22 * H;
    f.skirt.scale.set(0.095 * H * 2, sh, 0.095 * H * 2);
    f.skirt.geometry.dispose();
    f.skirt.geometry = new THREE.CylinderGeometry(0.5, 0.5 * 1.7, 1, 18, 1, true);
    f.skirt.position.set(cx, ymin + 0.5 * H - sh / 2, f.prep.cz);
    stats.figures = stats.figures || {};
    stats.figures[f.itemId + ':' + f.kind] = { gender, hair: f.hair.visible, skirt: f.skirt.visible, scale: root.scale.x, style: outfit.style, top: outfit.top, vcTop: vcTop ? '#' + vcTop.clone().multiplyScalar(1 / 1.25).getHexString() : null };
  }
  const dressAll = () => figs.forEach(dressFigure);
  if (window.People) People.onChange(dressAll);

  // 共用樂手：同一個人彈鋼琴同 Keyboard。邊件樂器狀態最「突出」（SOLO > HIGHLIGHT > 台上）佢就喺邊度；打平就鋼琴
  const players = new Map();
  async function ensurePlayer(pid, itemId) {
    if (players.has(pid)) return players.get(pid);
    const mk = async (id) => {
      const m = (await load(id)).clone(true);
      m.rotation.order = 'YXZ';                                      // 先轉向再傾側，搖擺軸跟住面向
      m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.userData.hasEmissive = 'emissive' in o.material; } });
      scene.add(m);
      return m;
    };
    const n = { seat: await mk('musician-seated'), stand: await mk('musician-standing') };
    players.set(pid, n);
    for (const [root, kind] of [[n.seat, 'seated'], [n.stand, 'standing']]) { const f = { root, kind, itemId }; figs.push(f); dressFigure(f); }
    return n;
  }
  const PRI = { off: 0, on: 1, hl: 2, solo: 3 };
  async function updatePlayers(s) {
    const ids = [...new Set(s.items.filter((i) => i.player).map((i) => i.player))];
    for (const pid of ids) {
      const mine = s.items.filter((i) => i.player === pid);
      let best = mine[0];
      for (const it of mine) if (PRI[it.state] > PRI[best.state]) best = it;
      const n = await ensurePlayer(pid, mine[0].id),
        active = PRI[best.state] > 0,
        show = active || s.showOff || s.editing,
        rotY = Math.PI - (best.rot * Math.PI) / 180;
      const chair = best.chair && s.items.find((i) => i.id === best.chair);
      n.seat.visible = show && !!chair;
      n.stand.visible = show && !chair;
      const faceTo = (obj, px, pz) => {                                // 面向而家彈緊嗰件器材（鋼琴手面向鋼琴）
        let vx = best.x - px, vz = best.y - pz;
        if (Math.hypot(vx, vz) < 0.2) { vx = 0; vz = 1; }
        obj.rotation.y = Math.atan2(-vx, -vz) - FIGURE_FRONT_YAW;
      };
      if (chair) {
        n.seat.position.set(chair.x, 0, chair.y);
        faceTo(n.seat, chair.x, chair.y);
      } else {
        const pl = PLAY[best.type] || { flip: false, behind: 0.7 },
          off = pl.flip ? -pl.behind : pl.behind;                    // 企喺琴鍵面一邊：flip 嘅琴鍵朝 front（+d）
        n.stand.position.set(best.x + off * Math.sin(rotY), elevation(best, s.platforms), best.y + off * Math.cos(rotY));
        faceTo(n.stand, n.stand.position.x, n.stand.position.z);
      }
      const col = best.state === 'solo' ? 0xffc233 : best.state === 'hl' ? 0x31c6f5 : 0;
      for (const m of [n.seat, n.stand])
        m.traverse((o) => { if (o.isMesh && o.userData.hasEmissive) { o.material.emissive.setHex(col); o.material.emissiveIntensity = col ? 0.5 : 0; } });
      stats.players = stats.players || {};
      const cur = chair ? n.seat : n.stand, dv = new THREE.Vector3();
      cur.updateMatrixWorld(true);
      cur.getWorldDirection(dv);
      stats.players[pid] = { front: { x: +dv.x.toFixed(3), z: +dv.z.toFixed(3) }, at: best.id, state: best.state, seated: n.seat.visible, standing: n.stand.visible, x: (chair ? n.seat : n.stand).position.x, z: (chair ? n.seat : n.stand).position.z };
    }
  }

  let pending = null, busy = false;
  let curBpm = null, curMotion = null;
  async function update(snap) {
    pending = snap;
    curBpm = (snap.song && snap.song.bpm) || null;
    curMotion = snap.motion || null;
    light.setConfig(snap.lighting);
    light.setSnap(snap);
    if (busy) return;
    busy = true;
    while (pending) {
      const s = pending; pending = null;
      lastStage = s.stage;
      buildStage(s.stage, s.room);
      buildPlatforms(s);
      for (const it of s.items) {
        const n = await ensure(it);
        n.group.position.set(it.x, PROP.has(it.type) ? 0 : elevation(it, s.platforms), it.y);
        n.group.rotation.y = Math.PI - (it.rot * Math.PI) / 180;
        for (const fg of n.persons) fg.rotation.y = -FIGURE_FRONT_YAW;
        n.state = it.state;
        const st = it.state, active = s.showOff || s.editing || st !== 'off',
          stays = PROP.has(it.type) || (s.stays || []).includes(it.type),
          show = stays || active;
        n.group.visible = show;
        // 器材成場留喺台上；樂手（同拎住嘅器材）唔喺度就收埋人。有凳嘅樂手只喺指定狀態先坐（行去凳、換坐姿、抬高），其餘企
        const stool = it.chair && it.sitWhen && s.items.find((i) => i.id === it.chair),
          sit = !!stool && it.sitWhen.includes(st) && active;
        for (const fg of n.persons) fg.visible = n.persons.length === 2 ? active && (fg.userData.pose === 'seated') === sit : active;
        if (n.body) {
          if (sit) {
            const th = Math.PI - (it.rot * Math.PI) / 180, dx = stool.x - it.x, dz = stool.y - it.y;   // 凳位置轉返器材本地座標
            n.body.position.set(dx * Math.cos(th) - dz * Math.sin(th), 0, dx * Math.sin(th) + dz * Math.cos(th) - n.behind);
            for (const fg of n.persons) if (fg.userData.pose === 'seated') fg.position.y = Math.max(0, (stool.h || SEATED_MODEL_SEAT) - SEATED_MODEL_SEAT);
          } else n.body.position.set(0, 0, 0);
        }
        const col = st === 'solo' ? 0xffc233 : st === 'hl' ? 0x31c6f5 : 0;
        n.group.traverse((o) => {
          if (PROP.has(it.type) || !o.isMesh || !o.userData.hasEmissive) return;
          o.material.emissive.setHex(col);
          o.material.emissiveIntensity = col ? 0.5 : 0;
        });
        n.spot.intensity = st === 'solo' || st === 'hl' ? 100 : 0;
        n.spot.color.setHex(st === 'hl' ? 0x31c6f5 : 0xffc233);
        const text = (st === 'solo' ? '★ ' : st === 'hl' ? '◆ ' : '') + shortName(it.label || it.type);
        if (n.lastLabel !== text + st) {
          n.lastLabel = text + st;
          n.sprite.material.map.image = tag(text, COLORS[st] || '#9aa19b');
          n.sprite.material.map.needsUpdate = true;
        }
        stats.items[it.id] = { state: st, visible: show, person: n.persons.length ? n.persons.some((q) => q.visible) : null, sitting: sit, x: it.x, z: it.y, y: n.group.position.y, elev: it.elev || 0, label: text };
      }
      await updatePlayers(s);
      syncModeBtns();
      note.textContent = `${s.song.number} ${s.song.title} · ${s.part}`;
      for (const id of ['piano', 'keyboard', 'guitar-e', 'bass', 'drums', 'mic-stand', 'musician-standing', 'musician-seated'])
        if (cache.has(id) && !stats.bounds[id]) {
          const b = new THREE.Box3().setFromObject(await cache.get(id)), sz = b.getSize(new THREE.Vector3());
          stats.bounds[id] = { size: [sz.x, sz.y, sz.z].map((v) => +v.toFixed(2)), ymin: +b.min.y.toFixed(3) };
        }
    }
    busy = false;
  }

  function resize() {
    const w = box.clientWidth, h = box.clientHeight;
    if (!w || !h) return;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    if (!touched && lastStage) setCam(camKind);
  }
  new ResizeObserver(resize).observe(box);

  // ---- 按 BPM 搖擺：roll 每兩拍一個來回、nod 每拍一次；幅度按狀態（stage-plans.json motion）；只喺播放中先郁 ----
  const swayAt = (t, bpm, st, phase, m) => {
    const a = m && m[st];
    if (!a || !bpm) return { roll: 0, nod: 0 };
    const beat = bpm / 60;
    return { roll: a.roll * Math.sin(Math.PI * beat * t + phase), nod: a.nod * Math.sin(2 * Math.PI * beat * t + phase * 0.5) };
  };
  stats.swayAt = swayAt;
  const phaseOf = (id) => [...String(id)].reduce((a, c) => a + c.charCodeAt(0), 0) * 0.7;
  const gains = new Map();
  let lastMs = 0, motionT = 0;
  function applyMotion() {
    const now = performance.now(), dt = Math.min(0.1, (now - lastMs) / 1000 || 0);
    lastMs = now;
    const audio = document.getElementById('audio');
    const playing = stats.forcePlaying != null ? stats.forcePlaying : !!(audio && !audio.paused && !audio.ended);
    if (stats.forceClock != null) motionT = stats.forceClock;
    else if (playing && audio) motionT = audio.currentTime;
    const bpm = curBpm || (curMotion && curMotion.defaultBpm) || 0, ease = (curMotion && curMotion.easePerSec) || 4;
    stats.motion = { bpm, source: curBpm ? 'song' : curMotion ? 'default' : 'none', playing, t: +motionT.toFixed(2) };
    const targets = [];
    for (const [id, n] of nodes) if (n.body && n.group.visible) targets.push([id, n.body, n.state]);
    for (const [pid, n] of players) {
      const st = (stats.players && stats.players[pid] && stats.players[pid].state) || 'on';
      for (const m of [n.seat, n.stand]) if (m.visible) targets.push([pid + ':' + (m === n.seat ? 's' : 't'), m, st]);
    }
    for (const [id, obj, st] of targets) {
      const g0 = gains.get(id) || 0, g = g0 + ((playing ? 1 : 0) - g0) * Math.min(1, dt * ease);
      gains.set(id, g);
      const w = swayAt(motionT, bpm, st, phaseOf(id), curMotion);
      obj.rotation.z = (g * w.roll * Math.PI) / 180;
      obj.rotation.x = (g * w.nod * Math.PI) / 180;
      if (stats.sway) stats.sway[id] = { roll: +(g * w.roll).toFixed(3), nod: +(g * w.nod).toFixed(3), state: st };
    }
  }
  stats.sway = {};

  let raf = 0, visible = false, lastLight = performance.now();
  function loop() {
    if (!visible) return;
    controls.update();
    updateWalls();
    syncScreen();
    applyMotion();
    { const nl = performance.now(); light.update((nl - lastLight) / 1000); lastLight = nl; }
    if (stats.screen) stats.screen.playing = !!(vid && !vid.paused);
    renderer.render(scene, camera);
    stats.frames++;
    raf = requestAnimationFrame(loop);
  }
  function setVisible(v) {
    if (v === visible) return;
    visible = v;
    cancelAnimationFrame(raf);
    if (v) { resize(); loop(); }
  }
  // 輸出報告用：按指定歌／段落嘅 snapshot 畫圖，用固定尺寸同鏡頭出圖，之後還原（唔影響用家睇緊嘅畫面）。
  async function capture(snap, cams, { width, height, quality, settleSteps, settleDt }) {
    await update(snap);
    while (busy) await new Promise((r) => setTimeout(r, 30));
    for (let i = 0; i < settleSteps; i++) light.update(settleDt);          // 燈光／煙霧快轉到穩定，唔使真係等
    const size = renderer.getSize(new THREE.Vector2()), pr = renderer.getPixelRatio();
    const keep = { pos: camera.position.clone(), tgt: controls.target.clone(), aspect: camera.aspect, kind: camKind, touched };
    renderer.setPixelRatio(1);
    renderer.setSize(width, height, false);
    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    const out = [];
    try {
      for (const c of cams) {
        setCam(c);
        updateWalls();
        syncScreen();
        renderer.render(scene, camera);
        out.push({ id: c, url: canvas.toDataURL('image/jpeg', quality) });   // 同一個 task 入面讀，唔使 preserveDrawingBuffer
      }
    } finally {
      camera.position.copy(keep.pos);
      controls.target.copy(keep.tgt);
      camera.aspect = keep.aspect;
      camera.updateProjectionMatrix();
      controls.update();
      camKind = keep.kind;
      touched = keep.touched;
      renderer.setPixelRatio(pr);
      renderer.setSize(size.x, size.y, false);
    }
    return out;
  }
  api.onChange(update);
  return { update, setVisible, stats, capture, describeLight: () => light.describe() };
}
