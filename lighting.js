// 3D 舞台燈光 preset ＋ 煙霧機。純視覺預覽（試吓感覺），唔係燈光師 cue。
// 全部參數喺 stage-plans.json 嘅 lighting；使用者揀嘅 preset／煙霧設定存 localStorage。
const KEY = 'cuesheet-board-light-v1';

export function createLighting({ THREE, scene, box, base, getBpm, getTime, getHang }) {
  let cfg = null, cfgKey = '', snap = null, panel = null, lightBtn = null;
  let st = { preset: null, mix: null, spot: null, fog: {} };
  const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
  try {
    const s = JSON.parse(localStorage.getItem(KEY));
    if (isObj(s)) st = { preset: s.preset || null, mix: isObj(s.mix) ? s.mix : null, spot: isObj(s.spot) ? s.spot : null, fog: isObj(s.fog) ? s.fog : {} };
  } catch {}
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };

  const root = new THREE.Group();
  scene.add(root);
  const b0 = { hemi: base.hemi.intensity, ambient: base.ambient.intensity, key: base.key.intensity };
  const fogObj = new THREE.FogExp2(0x0b0d0c, 0);               // density > 0 先掛上 scene（冇煙時 shader 同原本一樣）
  let fixtures = [], machines = [];
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

  const presetOf = () => (cfg && (cfg.presets.find((p) => p.id === st.preset) || cfg.presets.find((p) => p.id === cfg.default) || cfg.presets[0])) || null;
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
    for (const f of fixtures) { root.remove(f.grp); if (f.spot) root.remove(f.spot, f.spot.target); f.beam.geometry.dispose(); f.mat.dispose(); }
    for (const m of machines) for (const p of m.puffs) { root.remove(p.sprite); p.sprite.material.dispose(); }
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
      fixtures.push({ def, g, grp, spot, beam, mat, aim, custom, ang: g.angle, level: 0, color: new THREE.Color('#ffffff'), idx: fixtures.filter((f) => f.def.group === def.group).length });
    };
    cfg.rig.fixtures.forEach((def) => { const g = groups[def.group]; if (g) addFixture(def, g, 0, false); });
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
      '<div class="lp-sec"><div class="lp-title">燈光 preset（揀咗會載入對應顏色同強度）</div><div class="lp-presets">' +
      cfg.presets.map((p) => `<button class="smallbtn" data-preset="${esc(p.id)}" title="${esc(p.hint || '')}" aria-pressed="${P && P.id === p.id}">${esc(p.name)}</button>`).join('') +
      '</div><div class="lp-hint" data-lp="hint"></div></div>' +
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
      cfgKey = k; cfg = c;
      buildRig();
      buildPanel();
      if (lightBtn) lightBtn.hidden = false;
    },
    setSnap(s) { snap = s; refreshTargets(); },
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
          const gp = effGroup(P, f.def.group);
          tc = gp.color; tl = gp.level || 0;
          if (P.chase && P.chase.colors && !st.mix && f.def.group !== 'follow') {
            const n = P.chase.colors.length, step = Math.floor(beats / (P.chase.stepBeats || 1));
            tc = P.chase.colors[(((step + f.idx) % n) + n) % n];
          }
          if (f.def.group === 'follow' && tg.length) { const t = tg[f.idx % tg.length]; want = new THREE.Vector3(t.x, 1.1, t.y); }
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
      stats.fixtures = fixtures.map((f) => ({ id: f.def.id, group: f.def.group, level: +f.level.toFixed(3), color: '#' + f.color.getHexString(), angle: +f.ang.toFixed(3), h: +f.grp.position.y.toFixed(2), x: +f.grp.position.x.toFixed(2), intensity: f.spot ? +f.spot.intensity.toFixed(1) : 0, beam: +f.mat.opacity.toFixed(3), aim: [+f.aim.x.toFixed(2), +f.aim.z.toFixed(2)] }));
      stats.fog = { density: +fogObj.density.toFixed(5), haze: +cur.haze.toFixed(3), machines: machines.map((m) => ({ id: m.def.id, on: m.s.on, pos: m.s.pos, x: m.pos.x, z: m.pos.y, strength: m.s.strength, puffs: m.n || 0, reach: +(m.reach || 0).toFixed(2), cx: +m.cx.toFixed(2), cz: +m.cz.toFixed(2) })) };
    },
  };
  return api;
}
