// 舞台：按歌曲同段落標示邊個喺台上、邊個 solo／highlight，可拖動位置。
// 資料：stage-plans.json（舞台圖 + 器材位置）、stage-cues.json（可選，預設 cues）、localStorage（個人修改）。
(() => {
  const KEY = 'cuesheet-board-stage-v2';
  const NS = 'http://www.w3.org/2000/svg';
  const K = 24; // 1 m = 24 個 SVG 單位，令文字用正常字體大小
  const FONT = 12; // 標籤字體（SVG 單位）
  const CYCLE = ['off', 'on', 'solo', 'hl'];
  const STATE_LABEL = { off: '休息', on: '台上', solo: 'SOLO', hl: 'HIGHLIGHT', prop: '道具' };
  // 各器材嘅碰撞半徑（米），用嚟避開標籤重疊
  const RADIUS = { piano: 1.15, keyboard: 0.7, 'guitar-e': 0.75, bass: 0.85, drums: 0.9, 'vocal-main': 0.65, 'vocal-back': 0.4, 'prop-car': 0.75, chair: 0.5 };
  const isProp = (it) => it.type === 'prop-car' || it.type === 'chair';
  let data = null,
    base = {},
    store = { planId: null, cues: {}, pos: {}, showOff: false, fit: true },
    editing = false,
    readOnly = false,
    lastCue = null,
    ro = null,
    tlMode = 'song',
    partIdx = {},
    ctx = null;

  const esc = (x) =>
    String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object')
        store = { planId: s.planId || null, cues: s.cues || {}, pos: s.pos || {}, showOff: !!s.showOff, fit: s.fit !== false };
    } catch {}
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(store));
    } catch {}
  };

  // data 要等「全部載入＋localStorage 讀完」先設，否則其他視圖會用預設值畫出錯嘅狀態（慢網絡先見到）
  let initP = null;
  function init() {
    return initP || (initP = (async () => {
      let d;
      try {
        const r = await fetch('stage-plans.json');
        if (!r.ok) throw Error(r.status);
        d = await r.json();
      } catch {
        data = false;
        return data;
      }
      try {
        const r = await fetch('stage-cues.json');
        if (r.ok) {
          const j = await r.json();
          base = j.cues || {};
          if (j.pos && !Object.keys(store.pos).length) store.pos = j.pos;
        }
      } catch {}
      load();
      if (!d.plans.some((p) => p.id === store.planId)) store.planId = d.plans[0].id;
      data = d;
      if (window.People) People.init(plan());
      return data;
    })());
  }

  const plan = () => data.plans.find((p) => p.id === store.planId);
  const itemPos = (it) => (store.pos[store.planId] || {})[it.id] || { x: it.x, y: it.y };

  function defaultCue(song) {
    const types = new Set();
    for (const code of song.parts || []) for (const t of data.partItems[code] || []) types.add(t);
    const on = plan()
      .items.filter((i) => types.has(i.type))
      .filter((i, _, all) => i.type !== 'piano' || all.find((x) => x.type === 'piano') === i)
      .map((i) => i.id);
    return { name: '全曲', on, solo: [], hl: [], note: '' };
  }
  function cuesOf(song) {
    const n = song.number,
      cues = store.cues[n] ? store.cues[n] : base[n] ? clone(base[n]) : [defaultCue(song)];
    cues.forEach((c) => (c.hl = c.hl || []));
    return cues;
  }
  const writeCues = (song, cues) => {
    store.cues[song.number] = cues;
    save();
  };
  const itemState = (cue, it) => (isProp(it) ? 'prop' : stateOf(cue, it.id));
  const stateOf = (cue, id) => (cue.solo.includes(id) ? 'solo' : cue.hl.includes(id) ? 'hl' : cue.on.includes(id) ? 'on' : 'off');
  function setState(cue, id, st) {
    for (const k of ['on', 'solo', 'hl']) cue[k] = cue[k].filter((x) => x !== id);
    if (st !== 'off') cue.on.push(id);
    if (st === 'solo') cue.solo.push(id);
    if (st === 'hl') cue.hl.push(id);
  }

  // ---- 標籤排位：逐個器材揀一個唔撞其他標籤／器材／標記嘅位置 ----
  let measureCtx = null;
  // 量度要同實際渲染一樣字體（標籤行用 mono 粗體、SOLO／HIGHLIGHT 器材標籤粗體），否則會低估闊度而重疊
  function textWidth(str, st, font = FONT) {
    if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
    const cs = getComputedStyle(document.body),
      bold = st === 'solo' || st === 'hl',
      family = cs.fontFamily;
    measureCtx.font = `${bold ? '700 ' : ''}${font}px ${family}`;
    return measureCtx.measureText(str).width * 1.04 + font * 0.8;
  }
  const overlap = (a, b) => Math.max(0, Math.min(a.x2, b.x2) - Math.max(a.x1, b.x1)) * Math.max(0, Math.min(a.y2, b.y2) - Math.max(a.y1, b.y1));
  // 標籤最多兩行：第一行係名（SOLO 前面加 ★、HIGHLIGHT 前面加 ◆，再配顏色同粗體），
  // 第二行係補充（例如「BGV 2 ★ Double Flute」→「+ Double Flute」）。標籤越短越易擺位，唔會跳去遠處。
  function labelLines(it, player, st) {
    const full = String(it.label || it.type) + player,
      cut = full.indexOf(' ★'),
      name = cut > 0 ? full.slice(0, cut) : full,
      sub = cut > 0 ? '+ ' + full.slice(cut + 2).trim() : '',
      glyph = st === 'solo' ? '★ ' : st === 'hl' ? '◆ ' : '';
    return sub ? [glyph + name, sub] : [glyph + name];
  }
  // items: [{id, cx, cy, r, lines, tag}] → Map id → {anchor, box, score}
  function placeLabels(items, bounds, extra = [], font = FONT, unit = 1) {
    const obstacles = [...extra],
      placed = [],
      out = new Map();
    for (const it of items) {
      const rr = it.r * K + 2;
      obstacles.push({ x1: it.cx - rr, y1: it.cy - rr, x2: it.cx + rr, y2: it.cy + rr, id: it.id });
    }
    const cxs = items.reduce((a, i) => a + i.cx, 0) / (items.length || 1),
      cys = items.reduce((a, i) => a + i.cy, 0) / (items.length || 1);
    const order = [...items].sort((a, b) => Math.hypot(a.cx - cxs, a.cy - cys) - Math.hypot(b.cx - cxs, b.cy - cys));
    for (let pass = 0; pass < 3; pass++)         // 第 1 輪貪心排位，之後 2 輪逐個重排（睇齊其他標籤），減少死角
    for (const it of order) {
      if (!it.lines.length) continue;
      const w = Math.max(...it.lines.map((l) => textWidth(l, it.st, font))),
        h = it.lines.length * (font + 3) + 2,
        R = it.r * K,
        up = 0;
      const cands = [];
      for (const gap of [4, 12, 26, 44, 64, 90, 130]) {
        const g = gap * unit,
          d = R * 0.6;
        cands.push(
          { gap, anchor: 'middle', box: { x1: it.cx - w / 2, y1: it.cy + R + g, x2: it.cx + w / 2, y2: it.cy + R + g + h } },
          { gap, anchor: 'middle', box: { x1: it.cx - w / 2, y1: it.cy - R - g - h - up, x2: it.cx + w / 2, y2: it.cy - R - g - up } },
          { gap, anchor: 'start', box: { x1: it.cx + R + g, y1: it.cy - h / 2, x2: it.cx + R + g + w, y2: it.cy + h / 2 } },
          { gap, anchor: 'end', box: { x1: it.cx - R - g - w, y1: it.cy - h / 2, x2: it.cx - R - g, y2: it.cy + h / 2 } },
          { gap, anchor: 'start', box: { x1: it.cx + d + g, y1: it.cy - d - g - h, x2: it.cx + d + g + w, y2: it.cy - d - g } },
          { gap, anchor: 'end', box: { x1: it.cx - d - g - w, y1: it.cy - d - g - h, x2: it.cx - d - g, y2: it.cy - d - g } },
          { gap, anchor: 'start', box: { x1: it.cx + d + g, y1: it.cy + d + g, x2: it.cx + d + g + w, y2: it.cy + d + g + h } },
          { gap, anchor: 'end', box: { x1: it.cx - d - g - w, y1: it.cy + d + g, x2: it.cx - d - g, y2: it.cy + d + g + h } },
        );
      }
      let best = null;
      for (const c of cands) {
        let score = 0;
        for (const o of obstacles) score += overlap(c.box, o) * 3;
        // 標籤必須明顯貼近自己嘅器材，唔可以同鄰居一樣近或更近（否則睇落似屬於鄰居）
        const gapTo = (o) => Math.hypot(Math.max(0, o.x1 - c.box.x2, c.box.x1 - o.x2), Math.max(0, o.y1 - c.box.y2, c.box.y1 - o.y2));
        const ownGap = gapTo(obstacles.find((o) => o.id === it.id));
        if (c.gap * unit > 0.9 * R) {
          // 引線（器材中心 → 標籤最近點）唔可以穿過其他器材
          const ax = Math.min(Math.max(it.cx, c.box.x1), c.box.x2),
            ay = Math.min(Math.max(it.cy, c.box.y1), c.box.y2);
          for (const o of obstacles) {
            if (o.id === it.id || extra.includes(o)) continue;
            for (let k = 1; k <= 24; k++) {
              const x = it.cx + ((ax - it.cx) * k) / 24, y = it.cy + ((ay - it.cy) * k) / 24;
              if (x > o.x1 + 3 && x < o.x2 - 3 && y > o.y1 + 3 && y < o.y2 - 3) { score += 500; break; }
            }
          }
        }
        if (c.gap * unit <= 0.9 * R) for (const o of obstacles) if (o.id !== it.id && !extra.includes(o) && gapTo(o) <= ownGap + 6) score += 400;
        for (const [oid, ov] of out) if (oid !== it.id) score += overlap(c.box, ov.box) * 6;
        const b = c.box;
        score += (Math.max(0, bounds.x1 - b.x1) + Math.max(0, b.x2 - bounds.x2) + Math.max(0, bounds.y1 - b.y1) + Math.max(0, b.y2 - bounds.y2)) * 400;   // 出界要視為硬限制
        score += c.gap * 0.6; // 愈近愈好；距離遠要靠引線
        if (!best || score < best.score - 0.001) best = { ...c, score };
        if (score === 0) break;
      }
      out.set(it.id, best);
    }
    return out;
  }

  // ---- 畫舞台 ----
  function shape(type) {
    switch (type) {
      case 'piano':
        return '<rect class="shape" x="-1" y="-.75" width="2" height="1.5" rx=".35"/><rect class="keys" x="-.9" y=".45" width="1.8" height=".22"/>';
      case 'keyboard':
        return '<rect class="shape" x="-.65" y="-.25" width="1.3" height=".5" rx=".08"/>';
      case 'guitar-e':
        return '<ellipse class="shape" cx="-.25" cy="0" rx=".3" ry=".22"/><rect class="shape" x=".05" y="-.04" width=".8" height=".08"/>';
      case 'bass':
        return '<ellipse class="shape" cx="0" cy=".25" rx=".32" ry=".45"/><rect class="shape" x="-.04" y="-.95" width=".08" height="1"/>';
      case 'drums':
        return '<circle class="shape" r=".8"/><circle class="shape" r=".28" cx="-.35" cy="-.3"/><circle class="shape" r=".28" cx=".4" cy="-.25"/><circle class="shape" r=".22" cx="0" cy=".35"/>';
      case 'chair':
        return '<rect class="shape" x="-.4" y="-.2" width=".8" height=".4" rx=".05"/>';
      case 'prop-car':
        return '<rect class="shape" x="-.7" y="-.15" width="1.4" height=".3" rx=".05"/><circle class="lamp" cx="-.52" cy=".05" r=".09"/><circle class="lamp" cx="-.3" cy=".05" r=".09"/><circle class="lamp" cx=".3" cy=".05" r=".09"/><circle class="lamp" cx=".52" cy=".05" r=".09"/>';
      case 'vocal-main':
        return '<circle class="shape" r=".38"/><circle class="ring" r=".6"/>';
      default:
        return '<circle class="shape" r=".3"/>';
    }
  }
  const visibleItems = (cue) => plan().items.filter((it) => RADIUS[it.type] && (isProp(it) || editing || store.showOff || stateOf(cue, it.id) !== 'off'));
  const performers = () => plan().items.filter((it) => RADIUS[it.type] && !isProp(it));

  // 聚焦：viewBox 貼住器材＋平台（左右 2.2 m、上 2 m 畀標籤、下 2.2 m），畫面唔使浪費喺空舞台
  function viewBoxFor(cue, s) {
    const full = [-K, -1.2 * K, (s.w + 2) * K, (s.d + 3) * K];
    if (store.fit === false) return full;
    let x0 = 1e9, y0 = 1e9, x1 = -1e9, y1 = -1e9;
    const add = (px, py) => { x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px); y1 = Math.max(y1, py); };
    for (const it of visibleItems(cue)) { const p = itemPos(it), r = RADIUS[it.type]; add(p.x - r, p.y - r); add(p.x + r, p.y + r); }
    for (const pf of plan().platforms || []) {
      const a = ((pf.rot || 0) * Math.PI) / 180;
      for (const [cx, cy] of [[-1, -1], [1, -1], [1, 1], [-1, 1]]) add(pf.x + (cx * pf.w / 2) * Math.cos(a) - (cy * pf.d / 2) * Math.sin(a), pf.y + (cx * pf.w / 2) * Math.sin(a) + (cy * pf.d / 2) * Math.cos(a));
    }
    if (x0 > x1) return full;
    x0 -= 3.2; x1 += 3.2; y0 -= 2.4; y1 += 2.6;
    const minW = 10, minH = 7;
    if (x1 - x0 < minW) { const c = (x0 + x1) / 2; x0 = c - minW / 2; x1 = c + minW / 2; }
    if (y1 - y0 < minH) { const c = (y0 + y1) / 2; y0 = c - minH / 2; y1 = c + minH / 2; }
    return [(x0 + s.w / 2) * K, y0 * K, (x1 - x0) * K, (y1 - y0) * K];
  }
  function svgFor(cue) {
    const p = plan(),
      s = p.stage,
      W = (s.w + 2) * K,
      H = (s.d + 3) * K;
    let g = '',
      spots = '';
    for (const pf of p.platforms || [])
      g += `<g class="platform" transform="translate(${(pf.x + s.w / 2) * K} ${pf.y * K}) rotate(${pf.rot || 0})"><rect x="${(-pf.w / 2) * K}" y="${(-pf.d / 2) * K}" width="${pf.w * K}" height="${pf.d * K}" rx="3"/><text x="${(-pf.w / 2) * K + 6}" y="${(-pf.d / 2) * K + 13}">${esc(pf.label || 'Platform')}</text></g>`;
    for (const it of visibleItems(cue)) {
      const st = itemState(cue, it),
        pos = itemPos(it),
        r = RADIUS[it.type] * K;
      if (st === 'solo' || st === 'hl')
        spots += `<circle class="spot" cx="${(pos.x + s.w / 2) * K}" cy="${pos.y * K}" r="${2.2 * K}" fill="url(#spot-${st})" pointer-events="none"/>`;
      g +=
        `<g class="perf ${st}" data-id="${esc(it.id)}" data-type="${esc(it.type)}" transform="translate(${(pos.x + s.w / 2) * K} ${pos.y * K})" ` +
        `${editing ? 'tabindex="0" role="button"' : 'role="img"'} aria-label="${esc(it.label || it.type)}：${STATE_LABEL[st]}">` +
        `<rect class="hit" x="${-r}" y="${-r}" width="${2 * r}" height="${2 * r}" fill="transparent"/>` +
        `<g transform="scale(${K}) rotate(${it.rot || 0})">${shape(it.type)}</g>` +
        '</g>';
    }
    const grad = (id, c) => `<radialGradient id="spot-${id}"><stop offset="0%" stop-color="${c}" stop-opacity=".7"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
    return (
      `<svg class="stage-svg${editing ? ' editing' : ''}" xmlns="${NS}" viewBox="${viewBoxFor(cue, s).join(' ')}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="舞台平面圖">` +
      `<defs>${grad('solo', '#ffc233')}${grad('hl', '#31c6f5')}</defs>` +
      `<rect class="floor" x="0" y="0" width="${s.w * K}" height="${s.d * K}" rx="4"/>` +
      `<rect class="led" x="${((s.w - s.lw) / 2) * K}" y="${s.lo * K}" width="${s.lw * K}" height="${0.3 * K}"/>` +
      `<text class="edge" x="${(s.w / 2) * K}" y="${-0.35 * K}" text-anchor="middle">後牆 / 投影幕</text>` +
      `<line class="centre" x1="${(s.w / 2) * K}" y1="${1.2 * K}" x2="${(s.w / 2) * K}" y2="${s.d * K}"/>` +
      spots +
      g +
      '<g class="labels" pointer-events="none"></g>' +
      `<text class="edge" x="${(s.w / 2) * K}" y="${(s.d + 1.2) * K}" text-anchor="middle">▼ 觀眾席</text></svg>`
    );
  }

  // 平台文字（跟平台旋轉，細字）當固定障礙，標籤唔好壓住
  function platformBoxes(s) {
    return (plan().platforms || []).map((pf) => {
      const a = ((pf.rot || 0) * Math.PI) / 180,
        lx = (-pf.w / 2) * K + 6 + 36,
        ly = (-pf.d / 2) * K + 9,
        cx = (pf.x + s.w / 2) * K + lx * Math.cos(a) - ly * Math.sin(a),
        cy = pf.y * K + lx * Math.sin(a) + ly * Math.cos(a);
      return { x1: cx - 42, y1: cy - 12, x2: cx + 42, y2: cy + 12, id: pf.id + '-text' };
    });
  }
  // 根據而家嘅器材位置重新排標籤（拖動時都會叫）
  function layoutLabels(svg, cue) {
    const s = plan().stage,
      items = visibleItems(cue).map((it) => {
        const g = svg.querySelector(`.perf[data-id="${CSS.escape(it.id)}"]`),
          m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')),
          st = itemState(cue, it);
        return {
          id: it.id,
          cx: +m[1],
          cy: +m[2],
          r: RADIUS[it.type],
          lines: it.type === 'chair' ? [] : labelLines(it, data.players[it.id] ? ' · ' + data.players[it.id] : '', st),   // 琴凳唔標名（一眼睇到），但仍然係障礙
          st,
        };
      }),
      vb = svg.viewBox.baseVal,
      rect = svg.getBoundingClientRect(),
      sc = rect.width > 0 && rect.height > 0 ? Math.min(rect.width / vb.width, rect.height / vb.height) : 1,
      fu = Math.min(16, Math.max(4, (rect.width < 420 ? 10 : 12) / sc)),          // 標籤字體保持約 12px（zoom 入去唔會變巨）
      pos = placeLabels(items, { x1: vb.x + 2, y1: vb.y + 2, x2: vb.x + vb.width - 2, y2: vb.y + vb.height - 2 }, platformBoxes(s), fu, Math.min(3, Math.max(0.5, 1 / sc))),
      lg = svg.querySelector('.labels');
    svg.querySelectorAll('.platform text').forEach((tx) => (tx.style.fontSize = Math.max(5, fu * 0.8) + 'px'));
    lg.innerHTML = '';
    for (const it of items) {
      const pl = pos.get(it.id);
      if (!pl) continue;
      const far = pl.gap * Math.min(3, Math.max(0.5, 1 / sc)) > 0.9 * it.r * K,
        x = pl.anchor === 'middle' ? (pl.box.x1 + pl.box.x2) / 2 : pl.anchor === 'start' ? pl.box.x1 + 4 : pl.box.x2 - 4;
      if (far) {
        // 標籤唔貼住器材時，畫條幼線連返去自己器材，一眼睇到屬於邊個
        const ax = Math.min(Math.max(it.cx, pl.box.x1), pl.box.x2),
          ay = Math.min(Math.max(it.cy, pl.box.y1), pl.box.y2),
          len = Math.hypot(ax - it.cx, ay - it.cy) || 1,
          sx = it.cx + ((ax - it.cx) / len) * it.r * K * 0.7,
          sy = it.cy + ((ay - it.cy) / len) * it.r * K * 0.7,
          ln = document.createElementNS(NS, 'line');
        ln.setAttribute('class', `leader ${it.st}`);
        ln.setAttribute('data-for', it.id);
        ln.setAttribute('x1', sx);
        ln.setAttribute('y1', sy);
        ln.setAttribute('x2', ax);
        ln.setAttribute('y2', ay);
        lg.append(ln);
      }
      it.lines.forEach((line, i) => {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('class', `lbl ${it.st}${i === 0 && it.st !== 'on' && it.st !== 'off' ? ' main' : ''}`);
        t.setAttribute('data-for', it.id);
        t.setAttribute('x', x);
        t.setAttribute('y', pl.box.y1 + fu + 1 + i * (fu + 3));
        t.style.fontSize = fu + 'px';
        t.setAttribute('text-anchor', pl.anchor);
        t.textContent = line;
        lg.append(t);
      });
    }
  }

  // ---- 面板 ----
  // 2D／3D／兩者 切換（2D 同 3D 工具列都有）
  function modeSeg() {
    const m = ctx.getMode ? ctx.getMode() : '';
    return '<span class="modeseg" role="group" aria-label="舞台視圖">' +
      [['2d', '僅 2D'], ['3d', '僅 3D'], ['both', '2D + 3D']].map(([k, l]) => `<button class="smallbtn" data-mode="${k}" aria-pressed="${m === k}">${l}</button>`).join('') + '</span>';
  }
  const fmt = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
  function render() {
    if (!ctx || !data) return;
    const { box, song } = ctx,
      s = song(),
      cues = cuesOf(s),
      idx = Math.min(partIdx[s.number] || 0, cues.length - 1),
      cue = cues[idx];
    partIdx[s.number] = idx;
    const n = { on: cue.on.length - cue.solo.length - cue.hl.length, solo: cue.solo.length, hl: cue.hl.length };
    box.innerHTML =
      '<div class="docbar stagebar">' +
      modeSeg() +
      '<button class="smallbtn" data-act="outfit" title="樂手性別同服裝（主題色隨機配衣）">服裝</button>' +
      `<button class="smallbtn" data-act="fit" aria-pressed="${store.fit !== false}" title="畫面貼住器材放大／顯示成個舞台">聚焦</button>` +
      (data.plans.length > 1 ? data.plans.map((p) => `<button class="vchip" data-plan="${esc(p.id)}" aria-pressed="${p.id === store.planId}">${esc(p.title)}</button>`).join('') : '') +
      '<span class="stagelegend"><i class="sw on"></i>台上 <i class="sw solo"></i>SOLO <i class="sw hl"></i>HIGHLIGHT</span>' +
      `<label class="showoff"><input type="checkbox" data-act="showoff" ${store.showOff ? 'checked' : ''}> 顯示休息樂手</label>` +
      (readOnly ? '' : `<button class="smallbtn" data-act="edit" aria-pressed="${editing}">${editing ? '完成編輯' : '編輯'}</button>`) +
      '</div>' +
      `<div class="stagewrap">${svgFor(cue)}</div>` +
      '<div class="docbar partbar" role="group" aria-label="段落">' +
      cues.map((c, i) => `<button class="vchip" data-part="${i}" aria-pressed="${i === idx}">${esc(c.name)}${c.at != null ? ' · ' + fmt(c.at) : ''}</button>`).join('') +
      (editing ? '<button class="smallbtn" data-act="addpart">＋ 段落</button>' : '') +
      '</div>' +
      `<div class="stagesum" aria-live="polite">${esc(s.number + ' ' + s.title)} · ${esc(cue.name)}：台上 ${n.on + n.solo + n.hl}，SOLO ${n.solo}，HIGHLIGHT ${n.hl}${editing ? '。撳器材循環狀態，拖動改位置（方向鍵微調）' : ''}</div>` +
      (editing
        ? '<div class="docbar partedit">' +
          '<button class="smallbtn" data-act="rename">改名</button><button class="smallbtn" data-act="stamp">記低而家時間</button>' +
          '<button class="smallbtn" data-act="clearat">清時間</button><button class="smallbtn" data-act="delpart">刪除段落</button>' +
          '<button class="smallbtn" data-act="resetsong">重設本曲</button><button class="smallbtn" data-act="resetpos">重設位置</button>' +
          '<button class="smallbtn" data-act="export">匯出</button><button class="smallbtn" data-act="import">匯入</button>' +
          `<input class="stagenote" aria-label="燈光備註" placeholder="燈光／走位備註…" value="${esc(cue.note || '')}"></div>`
        : cue.note
          ? `<div class="stagenote-view">${esc(cue.note)}</div>`
          : '');
    layoutLabels(box.querySelector('.stage-svg'), cue);
    lastCue = cue;
    if (!ro && window.ResizeObserver) {
      let prev = '';
      ro = new ResizeObserver(() => {
        const sv = box.querySelector('.stage-svg');
        if (!sv || !lastCue) return;
        const r = sv.getBoundingClientRect(), k = Math.round(r.width) + 'x' + Math.round(r.height);
        if (k !== prev) { prev = k; layoutLabels(sv, lastCue); }
      });
      ro.observe(box);
    }
    wire(cues, idx);
    notify();
    if (ctx.timelineVisible && ctx.timelineVisible()) renderTimeline();
  }

  function wire(cues, idx) {
    const { box, song, audio } = ctx,
      s = song(),
      cue = cues[idx],
      svg = box.querySelector('.stage-svg'),
      commit = () => {
        writeCues(s, cues);
        render();
      },
      refocus = (id) => {
        const el = box.querySelector(`.perf[data-id="${CSS.escape(id)}"]`);
        if (el) el.focus();
      };
    box.querySelectorAll('[data-mode]').forEach((b) => (b.onclick = () => ctx.setMode(b.dataset.mode)));
    box.querySelectorAll('[data-plan]').forEach((b) => (b.onclick = () => { store.planId = b.dataset.plan; save(); render(); }));
    box.querySelectorAll('[data-part]').forEach((b) => (b.onclick = () => { partIdx[s.number] = +b.dataset.part; render(); }));
    const cycle = (id) => {
      if (isProp(plan().items.find((i) => i.id === id) || {})) return;
      setState(cue, id, CYCLE[(CYCLE.indexOf(stateOf(cue, id)) + 1) % CYCLE.length]);
      commit();
      refocus(id);
    };
    // 拖動／方向鍵改位置（編輯模式）：貼住 0.25 m 格，唔可以出舞台
    const st = plan().stage,
      snap = (v) => Math.round(v * 4) / 4,
      clampPos = (x, y) => ({ x: Math.min(st.w / 2, Math.max(-st.w / 2, snap(x))), y: Math.min(st.d, Math.max(0.5, snap(y))) }),
      setPos = (id, x, y) => {
        (store.pos[store.planId] = store.pos[store.planId] || {})[id] = clampPos(x, y);
        save();
      };
    if (editing)
      box.querySelectorAll('.perf').forEach((g) => {
        const id = g.dataset.id,
          it = plan().items.find((i) => i.id === id);
        g.style.cursor = 'grab';
        g.onpointerdown = (e) => {
          if (e.button) return;
          g.setPointerCapture(e.pointerId);
          const start = { x: e.clientX, y: e.clientY },
            origin = itemPos(it),
            inv = svg.getScreenCTM().inverse(),
            p0 = new DOMPoint(e.clientX, e.clientY).matrixTransform(inv);
          let moved = false;
          g.onpointermove = (ev) => {
            if (!moved && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 4) return;
            moved = true;
            g.style.cursor = 'grabbing';
            const p = new DOMPoint(ev.clientX, ev.clientY).matrixTransform(inv),
              np = clampPos(origin.x + (p.x - p0.x) / K, origin.y + (p.y - p0.y) / K);
            g.setAttribute('transform', `translate(${(np.x + st.w / 2) * K} ${np.y * K})`);
            layoutLabels(svg, cue);
          };
          g.onpointerup = (ev) => {
            g.onpointermove = g.onpointerup = null;
            g.releasePointerCapture(ev.pointerId);
            if (!moved) return cycle(id);
            const m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform'));
            setPos(id, +m[1] / K - st.w / 2, +m[2] / K);
            render();
            refocus(id);
          };
        };
        g.onkeydown = (e) => {
          const step = e.shiftKey ? 1 : 0.25,
            d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
          if (d) {
            e.preventDefault();
            const p = itemPos(it);
            setPos(id, p.x + d[0], p.y + d[1]);
            render();
            refocus(id);
          } else if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault();
            cycle(id);
          }
        };
      });
    const note = box.querySelector('.stagenote');
    if (note) note.onchange = () => { cue.note = note.value; writeCues(s, cues); };
    const so = box.querySelector('[data-act="showoff"]');
    if (so) so.onchange = () => { store.showOff = so.checked; save(); render(); };
    const act = {
      edit: () => { editing = !editing; render(); },
      fit: () => { store.fit = store.fit === false; save(); render(); },
      outfit: () => window.People && People.openDialog(),
      addpart: () => { const c = clone(cue); c.name = '段落 ' + (cues.length + 1); delete c.at; cues.push(c); partIdx[s.number] = cues.length - 1; commit(); },
      rename: () => { const n = prompt('段落名稱', cue.name); if (n && n.trim()) { cue.name = n.trim().slice(0, 30); commit(); } },
      stamp: () => { cue.at = Math.round(audio.currentTime); commit(); },
      clearat: () => { delete cue.at; commit(); },
      delpart: () => {
        if (cues.length < 2) return alert('至少要有一個段落。');
        if (!confirm('刪除段落「' + cue.name + '」？')) return;
        cues.splice(idx, 1);
        partIdx[s.number] = Math.max(0, idx - 1);
        commit();
      },
      resetsong: () => { if (confirm('本曲嘅段落同台位重設為預設？')) { delete store.cues[s.number]; partIdx[s.number] = 0; save(); render(); } },
      resetpos: () => { if (confirm('全部器材位置還原成舞台圖原位？')) { delete store.pos[store.planId]; save(); render(); } },
      export: async () => {
        const text = JSON.stringify({ planId: store.planId, cues: store.cues, pos: store.pos, people: window.People ? People.export() : undefined }, null, 1);
        try { await navigator.clipboard.writeText(text); ctx.toast('已複製舞台設定 JSON ✓'); } catch { prompt('複製舞台設定 JSON：', text); }
      },
      import: () => {
        const raw = prompt('貼上舞台設定 JSON（會取代你本機嘅舞台設定）');
        if (!raw) return;
        try {
          const j = JSON.parse(raw);
          if (!j || typeof j.cues !== 'object') throw Error('shape');
          for (const v of Object.values(j.cues)) if (!Array.isArray(v) || !v.every((c) => c && Array.isArray(c.on) && Array.isArray(c.solo))) throw Error('cue');
          store = { planId: data.plans.some((p) => p.id === j.planId) ? j.planId : store.planId, cues: j.cues, pos: j.pos && typeof j.pos === 'object' ? j.pos : {}, showOff: store.showOff, fit: store.fit };
          save();
          if (j.people && window.People) People.import(j.people);
          render();
          ctx.toast('已匯入舞台設定。');
        } catch { ctx.toast('匯入失敗：JSON 格式不對。'); }
      },
    };
    box.querySelectorAll('[data-act]').forEach((b) => b.dataset.act !== 'showoff' && (b.onclick = act[b.dataset.act]));
  }

  // ---- 時間線：本曲邊個幾時喺台上／solo；全場總表 ----
  const shortName = (it) => {
    const full = String(it.label || it.type),
      cut = full.indexOf(' ★');
    return cut > 0 ? full.slice(0, cut) : full;
  };
  const GLYPH = { on: '●', solo: '★', hl: '◆', off: '' };
  function songDuration(cues) {
    const d = ctx.audio.duration;
    if (Number.isFinite(d) && d > 1) return d;
    return Math.max(60, Math.max(0, ...cues.map((c) => c.at || 0)) + 30);
  }
  function segments(cues, dur) {
    const timed = cues.some((c) => c.at != null);
    return cues.map((c, i) => {
      const t0 = timed ? (i === 0 ? Math.min(c.at ?? 0, dur) : Math.min(c.at ?? dur, dur)) : (dur * i) / cues.length;
      const next = cues[i + 1],
        t1 = timed ? (next ? Math.min(next.at ?? dur, dur) : dur) : (dur * (i + 1)) / cues.length;
      return { i, name: c.name, t0, t1: Math.max(t1, t0), timed };
    });
  }
  function renderTimeline() {
    if (!ctx || !data || !ctx.timelineBox) return;
    const box = ctx.timelineBox,
      s = ctx.song(),
      cues = cuesOf(s),
      dur = songDuration(cues),
      segs = segments(cues, dur),
      items = performers(),
      pct = (t) => ((t / dur) * 100).toFixed(2) + '%';
    let html =
      '<div class="docbar tlbar"><button class="vchip" data-tl="song" aria-pressed="' + (tlMode === 'song') + '">本曲時間線</button>' +
      '<button class="vchip" data-tl="set" aria-pressed="' + (tlMode === 'set') + '">全場總表</button>' +
      '<span class="stagelegend"><i class="sw on"></i>台上 <i class="sw solo"></i>SOLO <i class="sw hl"></i>HIGHLIGHT</span></div>';
    if (tlMode === 'song') {
      const ticks = [];
      for (let t = 0; t <= dur; t += dur > 300 ? 60 : 30) ticks.push(t);
      html +=
        `<div class="tl" data-dur="${dur}"><div class="tlhead">${esc(s.number + ' ' + s.title)}${segs[0].timed ? '' : '（未記時間：段落平均分配）'}</div>` +
        '<div class="tlscroll"><div class="tlbody">' +
        '<div class="tlrow tlruler"><div class="tlname"></div><div class="tltrack">' +
        ticks.map((t) => `<span class="tick" style="left:${pct(t)}">${fmt(t)}</span>`).join('') + '</div></div>' +
        '<div class="tlrow tlparts"><div class="tlname">段落</div><div class="tltrack">' +
        segs.map((g) => `<button class="tlpart" data-part="${g.i}" style="left:${pct(g.t0)};width:calc(${pct(g.t1 - g.t0)} - 2px)" title="${esc(g.name)}">${esc(g.name)}</button>`).join('') + '</div></div>' +
        items.map((it) => {
          const segHtml = segs
            .map((g) => {
              const st = stateOf(cues[g.i], it.id);
              return st === 'off' ? '' : `<span class="seg ${st}" style="left:${pct(g.t0)};width:${pct(g.t1 - g.t0)}" title="${esc(shortName(it))} · ${esc(g.name)} · ${STATE_LABEL[st]}"></span>`;
            })
            .join('');
          return `<div class="tlrow"><div class="tlname">${esc(shortName(it))}</div><div class="tltrack" data-seek>${segHtml}</div></div>`;
        }).join('') +
        '<div class="tlph-wrap"><div class="tlph" style="left:0"></div></div></div></div></div>';
    } else {
      const songs = ctx.songs();
      html +=
        '<div class="tlscroll"><table class="tlmatrix"><thead><tr><th>歌曲</th>' +
        items.map((it) => `<th>${esc(shortName(it))}</th>`).join('') + '<th>SOLO／HIGHLIGHT</th></tr></thead><tbody>' +
        songs.map((sg) => {
          const cs = cuesOf(sg),
            cells = items.map((it) => {
              const sts = cs.map((c) => stateOf(c, it.id)),
                best = sts.includes('solo') ? 'solo' : sts.includes('hl') ? 'hl' : sts.includes('on') ? 'on' : 'off';
              return `<td class="m ${best}" aria-label="${esc(shortName(it))}：${STATE_LABEL[best]}">${GLYPH[best]}</td>`;
            }).join(''),
            ev = [];
          cs.forEach((c) => {
            for (const id of c.solo) ev.push('★ ' + shortName(plan().items.find((i) => i.id === id) || { label: id }) + (c.at != null ? ' ' + fmt(c.at) : ''));
            for (const id of c.hl) ev.push('◆ ' + shortName(plan().items.find((i) => i.id === id) || { label: id }) + (c.at != null ? ' ' + fmt(c.at) : ''));
          });
          return `<tr class="${sg.number === s.number ? 'cur' : ''}" data-song="${esc(sg.number)}" tabindex="0"><th>${esc(sg.number)} ${esc(sg.title)}</th>${cells}<td class="ev">${ev.length ? esc(ev.join('　')) : ''}</td></tr>`;
        }).join('') + '</tbody></table></div>';
    }
    box.innerHTML = html;
    box.querySelectorAll('[data-tl]').forEach((b) => (b.onclick = () => { tlMode = b.dataset.tl; renderTimeline(); }));
    box.querySelectorAll('.tlpart').forEach((b) => (b.onclick = () => { partIdx[s.number] = +b.dataset.part; const g = segs[+b.dataset.part]; if (g.timed) ctx.audio.currentTime = g.t0; renderTimeline(); if (ctx.active()) render(); }));
    box.querySelectorAll('[data-seek]').forEach((tr) => (tr.onclick = (e) => { const r = tr.getBoundingClientRect(); ctx.audio.currentTime = Math.max(0, Math.min(dur, ((e.clientX - r.left) / r.width) * dur)); updatePlayhead(); }));
    box.querySelectorAll('tr[data-song]').forEach((tr) => {
      const go = () => ctx.selectSong(tr.dataset.song);
      tr.onclick = go;
      tr.onkeydown = (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
    });
    updatePlayhead();
  }
  function updatePlayhead() {
    if (!ctx || !ctx.timelineBox) return;
    const tl = ctx.timelineBox.querySelector('.tl'),
      ph = ctx.timelineBox.querySelector('.tlph');
    if (!tl || !ph) return;
    const dur = +tl.dataset.dur || 1;
    ph.style.left = Math.min(100, ((ctx.audio.currentTime || 0) / dur) * 100) + '%';
    const segsEls = tl.querySelectorAll('.tlpart');
    const cues = cuesOf(ctx.song()),
      sg = segments(cues, dur),
      t = ctx.audio.currentTime || 0;
    let cur = 0;
    sg.forEach((g, i) => { if (t >= g.t0) cur = i; });
    segsEls.forEach((el, i) => el.setAttribute('aria-current', String(i === cur)));
  }

  // 播放緊 → 按已記低嘅時間自動跳段落（只喺觀看模式）
  function follow() {
    if (ctx && ctx.timelineVisible && ctx.timelineVisible()) updatePlayhead();
    if (!ctx || !data || editing || !(ctx.active() || (ctx.threeVisible && ctx.threeVisible()))) return;
    const s = ctx.song(),
      cues = cuesOf(s);
    if (!cues.some((c) => c.at != null)) return;
    const t = ctx.audio.currentTime;
    let pick = 0;
    cues.forEach((c, i) => { if (c.at != null && c.at <= t) pick = i; });
    if (pick !== (partIdx[s.number] || 0)) { partIdx[s.number] = pick; if (ctx.active()) render(); else notify(); if (ctx.timelineVisible && ctx.timelineVisible()) renderTimeline(); }
  }

  // ---- 3D 等其他視圖用：而家嘅歌／段落／器材位置同狀態 ----
  const listeners = [];
  function snapshot() {
    if (!ctx || !data) return null;
    const s = ctx.song();
    return snapshotFor(s, partIdx[s.number] || 0);
  }
  function snapshotFor(s, i) {     // 指定歌＋段落（輸出報告用，唔郁而家揀咗嘅歌）
    const cues = cuesOf(s),
      idx = Math.min(Math.max(i || 0, 0), cues.length - 1),
      cue = cues[idx],
      p = plan();
    return {
      stage: p.stage,
      room: p.room || null,
      showOff: store.showOff,
      editing,
      song: { number: s.number, title: s.title, bpm: s.bpm || null },
      motion: data.motion || null,
      stays: (data.staysOnStage && data.staysOnStage.types) || [],
      lighting: data.lighting || null,
      part: cue.name,
      platforms: p.platforms || [],
      items: p.items.filter((it) => RADIUS[it.type]).map((it) => {
        const pos = itemPos(it);
        return { id: it.id, type: it.type, label: it.label, x: pos.x, y: pos.y, rot: it.rot || 0, state: itemState(cue, it), w: it.w, d: it.d, h: it.h, elev: it.elev || 0, player: it.player, chair: it.chair, sitWhen: it.sitWhen || null };
      }),
    };
  }
  // ---- 輸出報告用 ----
  // 2D 圖寫入計算後顏色用：只寫同瀏覽器預設唔同嘅屬性，文字另加字體
  const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin'];
  const PAINT_TEXT = [...PAINT, 'font-size', 'font-family', 'font-weight', 'text-anchor', 'paint-order'];
  const PAINT_DEFAULT = { fill: 'rgb(0, 0, 0)', stroke: 'none', 'stroke-width': '1px', 'stroke-dasharray': 'none', opacity: '1', 'fill-opacity': '1', 'stroke-opacity': '1', 'stroke-linecap': 'butt', 'stroke-linejoin': 'miter', 'font-weight': '400', 'text-anchor': 'start', 'paint-order': 'normal' };
  function exportData() {
    if (!ctx || !data) return null;
    const perf = performers();
    return {
      plan: { id: plan().id, title: plan().title },
      performers: perf.map((it) => ({ id: it.id, name: shortName(it) })),
      songs: ctx.songs().map((s) => ({
        number: s.number,
        cues: cuesOf(s).map((c) => ({ name: c.name, at: c.at ?? null, note: c.note || '', states: Object.fromEntries(perf.map((it) => [it.id, stateOf(c, it.id)])) })),
      })),
    };
  }
  // 2D 舞台圖：喺螢幕外畫一次、排好標籤，再將計算後嘅顏色寫入每個元素，變成獨立 SVG（唔靠網頁 CSS）
  function exportSvg(s, i, widthPx) {
    const cues = cuesOf(s),
      cue = cues[Math.min(Math.max(i || 0, 0), cues.length - 1)],
      was = editing;
    editing = false;
    const host = document.createElement('div');
    host.className = 'stagewrap';
    host.style.cssText = `position:fixed;left:-99999px;top:0;width:${widthPx}px;visibility:hidden`;
    host.innerHTML = svgFor(cue);
    document.body.append(host);
    try {
      const svg = host.querySelector('svg');
      layoutLabels(svg, cue);
      // 先全部量好再清 class（svg 根 class 係 .stage-svg 選擇器嘅前提，一清就量唔到）
      const painted = [...svg.querySelectorAll('*')]
        .filter((el) => !el.closest('defs'))
        .map((el) => {
          const cs = getComputedStyle(el), tag = el.tagName.toLowerCase();
          const keys = tag === 'text' || tag === 'tspan' ? PAINT_TEXT : tag === 'g' ? ['opacity'] : PAINT;
          return [el, keys.filter((k) => /^font-(size|family)$/.test(k) || cs.getPropertyValue(k) !== PAINT_DEFAULT[k]).map((k) => `${k}:${cs.getPropertyValue(k)}`).join(';')];
        });
      for (const [el, st] of painted) st ? el.setAttribute('style', st) : el.removeAttribute('style');
      for (const el of [svg, ...svg.querySelectorAll('*')]) {
        el.removeAttribute('class');
        el.removeAttribute('tabindex');
      }
      svg.setAttribute('style', 'width:100%;height:auto;display:block');
      return svg.outerHTML;
    } finally {
      host.remove();
      editing = was;
    }
  }
  function notify() {
    const snap = snapshot();
    if (snap) listeners.forEach((f) => f(snap));
  }

  window.StageView = {
    onChange(f) { listeners.push(f); },
    getVideo: () => ctx && ctx.video,
    getMode: () => (ctx && ctx.getMode ? ctx.getMode() : ''),
    setMode: (m) => ctx && ctx.setMode && ctx.setMode(m),
    notify,
    snapshotFor,
    exportData,
    exportSvg,
    ready: init,
    available: () => !!data,
    mount(c) {
      ctx = c;
      ctx.audio.addEventListener('timeupdate', follow);
      ctx.audio.addEventListener('loadedmetadata', () => ctx.timelineVisible && ctx.timelineVisible() && renderTimeline());
    },
    render,
    renderTimeline,
    setReadOnly(v) { readOnly = !!v; if (v) editing = false; },
    placeLabels,
  };
})();
