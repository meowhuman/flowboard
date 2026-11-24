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
  const RADIUS = { piano: 1.15, keyboard: 0.7, 'guitar-e': 0.9, bass: 1.0, drums: 0.9, 'vocal-main': 0.65, 'vocal-back': 0.4, 'prop-car': 0.75, chair: 0.5 };
  const ICON_SCALE = { piano: 0.55, keyboard: 0.55, 'guitar-e': 0.44, bass: 0.44, drums: 0.55, 'vocal-main': 0.55, 'vocal-back': 0.55, 'prop-car': 0.55, chair: 0.55 };
  // Base SVG glyph half-extents; +0.1 m safety margin is applied after scaling and rotation.
  const GLYPH_BOUNDS = { piano: [0.95, 0.72], keyboard: [0.8, 0.34], 'guitar-e': [1.28, 0.62], bass: [1.33, 0.58], drums: [0.87, 0.85], 'vocal-main': [0.25, 0.68], 'vocal-back': [0.25, 0.68], 'prop-car': [0.7, 0.15], chair: [0.4, 0.2] };
  // Visible half-extents before ICON_SCALE; compact labels use icon shape bounds, not stage clearance.
  const ICON_BOUNDS = { piano: [0.53, 0.4], keyboard: [0.44, 0.19], 'guitar-e': [0.57, 0.28], bass: [0.6, 0.28], drums: [0.5, 0.3], 'vocal-main': [0.14, 0.38] };
  const INSTRUMENTS = new Set(['piano', 'keyboard', 'guitar-e', 'bass', 'drums']);
  const isProp = (it) => it.type === 'prop-car' || it.type === 'chair';
  const footprint = (it) => {
    const [w, h] = GLYPH_BOUNDS[it.type] || [0.3, 0.3],
      scale = ICON_SCALE[it.type] || 0.55,
      a = itemRot(it) * Math.PI / 180;
    return {
      x: Math.abs(Math.cos(a)) * w * scale + Math.abs(Math.sin(a)) * h * scale + 0.1,
      y: Math.abs(Math.sin(a)) * w * scale + Math.abs(Math.cos(a)) * h * scale + 0.1,
    };
  };
  let data = null,
    base = {},
    store = { planId: null, cues: {}, pos: {}, rot: {}, showOff: false, fit: true },
    editing = false,
    readOnly = false,
    lastCue = null,
    ro = null,
    tlMode = 'song',
    partIdx = {},
    ctx = null,
    selectedRotateId = null;

  const esc = (x) =>
    String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object')
        store = { planId: s.planId || null, cues: s.cues || {}, pos: s.pos || {}, rot: s.rot || {}, showOff: !!s.showOff, fit: s.fit !== false };
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
  const itemRot = (it) => (store.rot[store.planId] || {})[it.id] ?? it.rot ?? 0;

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
    const raw = String(it.label || it.type),
      clean = it.type.startsWith('vocal') ? raw.replace(/\s*[·|]\s*Vocal$/i, '') : raw,
      full = clean + player,
      cut = full.indexOf(' ★'),
      name = cut > 0 ? full.slice(0, cut) : full,
      sub = cut > 0 ? '+ ' + full.slice(cut + 2).trim() : '',
      glyph = st === 'solo' ? '★ ' : st === 'hl' ? '◆ ' : '';
    return sub ? [glyph + name, sub] : [glyph + name];
  }
  function wrapLabelLines(lines, st, font, maxWidth) {
    const wrapped = [];
    for (const line of lines) {
      let current = '';
      for (const word of line.split(/\s+/)) {
        const candidate = current ? current + ' ' + word : word;
        if (current && textWidth(candidate, st, font) > maxWidth) {
          wrapped.push(current);
          current = word;
        } else {
          current = candidate;
        }
        if (textWidth(current, st, font) > maxWidth) {
          let piece = '';
          for (const char of current) {
            if (piece && textWidth(piece + char, st, font) > maxWidth) {
              wrapped.push(piece);
              piece = char;
            } else piece += char;
          }
          current = piece;
        }
      }
      if (current) wrapped.push(current);
    }
    return wrapped;
  }
  // items: [{id, cx, cy, r, lines, tag}] → Map id → {anchor, box, score}
  function placeLabels(items, bounds, extra = [], font = FONT, unit = 1, gapScale = 1) {
    const obstacles = [...extra],
      placed = [],
      out = new Map();
    for (const it of items) {
      const rx = (it.rx || it.r) * K + 2,
        ry = (it.ry || it.r) * K + 2;
      obstacles.push({ x1: it.cx - rx, y1: it.cy - ry, x2: it.cx + rx, y2: it.cy + ry, id: it.id });
    }
    const cxs = items.reduce((a, i) => a + i.cx, 0) / (items.length || 1),
      cys = items.reduce((a, i) => a + i.cy, 0) / (items.length || 1);
    const order = [...items].sort((a, b) => Math.hypot(a.cx - cxs, a.cy - cys) - Math.hypot(b.cx - cxs, b.cy - cys));
    for (let pass = 0; pass < 3; pass++)         // 第 1 輪貪心排位，之後 2 輪逐個重排（睇齊其他標籤），減少死角
    for (const it of order) {
      if (!it.lines.length) continue;
      const itemGapScale = it.gapScale ?? gapScale;
      const itemFont = it.font || font,
        w = Math.max(...it.lines.map((l) => textWidth(l, it.st, itemFont))),
        h = it.compact
          ? it.lines.length * itemFont + (it.lines.length - 1) + 0.5
          : it.lines.length * (itemFont + 3) + 2,
        rx = (it.rx || it.r) * K,
        ry = (it.ry || it.r) * K,
        up = 0;
      const cands = [];
      for (const value of [4, 12, 26, 44, 64, 90, 130]) {
        const gap = value * itemGapScale,
          g = gap * unit,
          dX = rx * 0.6,
          dY = ry * 0.6;
        cands.push(
          { gap, side: 'below', anchor: 'middle', box: { x1: it.cx - w / 2, y1: it.cy + ry + g, x2: it.cx + w / 2, y2: it.cy + ry + g + h } },
          { gap, side: 'above', anchor: 'middle', box: { x1: it.cx - w / 2, y1: it.cy - ry - g - h - up, x2: it.cx + w / 2, y2: it.cy - ry - g - up } },
          { gap, side: 'right', anchor: 'start', box: { x1: it.cx + rx + g, y1: it.cy - h / 2, x2: it.cx + rx + g + w, y2: it.cy + h / 2 } },
          { gap, side: 'left', anchor: 'end', box: { x1: it.cx - rx - g - w, y1: it.cy - h / 2, x2: it.cx - rx - g, y2: it.cy + h / 2 } },
          { gap, side: 'upper-right', anchor: 'start', box: { x1: it.cx + dX + g, y1: it.cy - dY - g - h, x2: it.cx + dX + g + w, y2: it.cy - dY - g } },
          { gap, side: 'upper-left', anchor: 'end', box: { x1: it.cx - dX - g - w, y1: it.cy - dY - g - h, x2: it.cx - dX - g, y2: it.cy - dY - g } },
          { gap, side: 'lower-right', anchor: 'start', box: { x1: it.cx + dX + g, y1: it.cy + dY + g, x2: it.cx + dX + g + w, y2: it.cy + dY + g + h } },
          { gap, side: 'lower-left', anchor: 'end', box: { x1: it.cx - dX - g - w, y1: it.cy + dY + g, x2: it.cx - dX - g, y2: it.cy + dY + g + h } },
        );
      }
      let best = null;
      for (const c of cands) {
        let score = 0;
        for (const o of obstacles) score += overlap(c.box, o) * 3;
        if (it.labelSide && c.side !== it.labelSide) score += it.compact ? 100 : 500;
        // 標籤必須明顯貼近自己嘅器材，唔可以同鄰居一樣近或更近（否則睇落似屬於鄰居）
        const gapTo = (o) => Math.hypot(Math.max(0, o.x1 - c.box.x2, c.box.x1 - o.x2), Math.max(0, o.y1 - c.box.y2, c.box.y1 - o.y2));
        const ownGap = gapTo(obstacles.find((o) => o.id === it.id));
        if (c.gap * unit > 0.9 * Math.max(rx, ry)) {
          // 引線（器材中心 → 標籤最近點）唔可以穿過其他器材
          const ax = Math.min(Math.max(it.cx, c.box.x1), c.box.x2),
            ay = Math.min(Math.max(it.cy, c.box.y1), c.box.y2);
          for (const o of obstacles) {
            if (o.id === it.id || extra.includes(o)) continue;
            for (let k = 1; k <= 24; k++) {
              const x = it.cx + ((ax - it.cx) * k) / 24, y = it.cy + ((ay - it.cy) * k) / 24;
              if (x > o.x1 + 3 && x < o.x2 - 3 && y > o.y1 + 3 && y < o.y2 - 3) { score += 100000; break; }
            }
          }
        }
        if (c.gap * unit <= 0.9 * Math.max(rx, ry)) for (const o of obstacles) if (o.id !== it.id && !extra.includes(o) && gapTo(o) <= ownGap + 6) score += 400;
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
  function shape(type, icon) {
    switch (type) {
      case 'piano':
        return '<path class="shape" d="M-.95.58V-.34Q-.95-.72-.58-.72H.55Q.95-.72.95-.32V.58Z"/><path class="detail" d="M-.82.24H.82M-.68.24V.56M-.44.24V.56M-.2.24V.56M.04.24V.56M.28.24V.56M.52.24V.56M.76.24V.56"/><path class="black-key" d="M-.57.24h.12v.2h-.12zM-.33.24h.12v.2h-.12zM.15.24h.12v.2h-.12zM.39.24h.12v.2h-.12zM.63.24h.12v.2h-.12z"/>';
      case 'keyboard':
        return '<rect class="shape" x="-.8" y="-.34" width="1.6" height=".68" rx=".09"/><path class="detail" d="M-.68-.08H.68M-.62-.08V.28M-.4-.08V.28M-.18-.08V.28M.04-.08V.28M.26-.08V.28M.48-.08V.28M.68-.08V.28"/><path class="black-key" d="M-.52-.08h.11v.2h-.11zM-.3-.08h.11v.2H-.3zM.14-.08h.11v.2H.14zM.36-.08h.11v.2h-.11zM.58-.08h.1v.2h-.1z"/><rect class="panel" x="-.62" y="-.26" width=".42" height=".12" rx=".02"/>';
      case 'guitar-e':
        return '<path class="shape outline" d="M-.04-.13C-.18-.14-.23-.28-.29-.43-.36-.6-.57-.62-.75-.53-.93-.44-1-.22-1 0-1 .25-.88.48-.67.56-.48.63-.29.57-.21.4-.14.25-.2.14-.07.12H.03V-.13Z"/><path class="shape outline" d="M-.04-.13H1.03L1.13-.22H1.28V.22H1.13L1.03.13H-.04Z"/><path class="detail" d="M-.06-.09H1.12M-.06-.03H1.12M-.06.03H1.12M-.06.09H1.12M-.31-.17V.17M-.5-.18V.18M-.69-.16V.16M-.83-.34V.34"/><rect class="shape outline" x="-.4" y="-.105" width=".13" height=".21" rx=".025"/><rect class="shape outline" x="-.59" y="-.105" width=".13" height=".21" rx=".025"/><rect class="shape outline" x="-.78" y="-.105" width=".13" height=".21" rx=".025"/><path class="detail" d="M1.12-.23V.23M1.2-.18V.18"/>';
      case 'bass':
        if (icon === 'upright')
          return '<path class="shape" d="M-.08-.99C-.16-.93-.14-.81-.13-.68L-.12-.2C-.31-.08-.42.13-.48.42-.56.79-.42 1.05-.2 1.08-.09 1.1-.03 1.04 0 .99.03 1.04.09 1.1.2 1.08.42 1.05.56.79.48.42.42.13.31-.08.12-.2L.13-.68C.14-.81.16-.93.08-.99Z"/><path class="shape" d="M-.08-.94H.08V-.18H-.08Z"/><path class="detail" d="M0-1.04V.98M-.28.38C-.19.29-.14.35-.17.45-.19.52-.24.56-.28.59M.28.38C.19.29.14.35.17.45.19.52.24.56.28.59M-.3.76H.3"/><circle class="shape" cx="0" cy="-1.04" r=".1"/>';
        if (icon === 'fender-p')
          return '<path class="shape" d="M-.06-.16C-.2-.17-.28-.29-.34-.43-.4-.57-.57-.58-.72-.48-.88-.38-.93-.17-.91.03-.9.25-.78.47-.57.53-.39.58-.2.5-.11.34-.06.25-.03.17.04.13V-.16Z"/><path class="shape" d="M.01-.14H1.08L1.2-.22H1.33V.22H1.2L1.08.14H.01Z"/><path class="panel" d="M-.35-.35C-.19-.43-.06-.35.01-.2L.11.3C-.12.48-.43.46-.61.31L-.66.02Z"/><rect class="shape" x="-.25" y="-.12" width=".12" height=".1" rx=".02"/><rect class="shape" x="-.25" y=".02" width=".12" height=".1" rx=".02"/><path class="detail" d="M-.05-.09H1.18M-.05-.03H1.18M-.05.03H1.18M-.05.09H1.18M1.17-.23V.23M1.26-.18V.18"/><circle class="detail-dot" cx="-.47" cy=".35" r=".035"/><circle class="detail-dot" cx="-.37" cy=".39" r=".035"/>';
        return '<path class="shape" d="M-.12-.08C-.52-.2-.73-.49-.56-.73-.38-.99-.02-.8.14-.55.42-.77.72-.6.67-.29.64-.1.48.08.38.24.64.52.39.88.02.86-.37.84-.68.58-.54.32-.46.17-.3.02-.12-.08Z"/><path class="shape" d="M.28-.13H1.05V.13H.28Z"/><path class="detail" d="M.4-.15V.15M.55-.15V.15M.7-.15V.15M.85-.15V.15M1-.15V.15M1.05 0H1.24"/><rect class="panel" x="-.1" y="-.2" width=".23" height=".38" rx=".04"/><circle class="detail-dot" cx="-.39" cy="-.42" r=".07"/>';
      case 'drums':
        return '<ellipse class="shape outline" cx="-.62" cy="-.25" rx=".25" ry=".09"/><ellipse class="shape outline" cx=".62" cy="-.25" rx=".25" ry=".09"/><path class="detail" d="M-.62-.16V.28M.62-.16V.28M-.62.24L-.82.45M-.62.24L-.42.45M.62.24L.42.45M.62.24L.82.45"/><circle class="shape outline" cx="-.36" cy="-.02" r=".15"/><circle class="shape outline" cx="0" cy="-.08" r=".16"/><circle class="shape outline" cx=".48" cy=".06" r=".17"/><circle class="shape outline" cx="0" cy=".42" r=".28"/><circle class="detail" cx="0" cy=".42" r=".22"/><path class="shape outline" d="M-.16-.78Q0-.85.16-.78V-.62Q0-.55-.16-.62Z"/><path class="detail" d="M0-.62V-.42M-.07-.49L0-.42L.07-.49"/>';
      case 'chair':
        return '<rect class="shape" x="-.4" y="-.2" width=".8" height=".4" rx=".05"/>';
      case 'prop-car':
        return '<rect class="shape" x="-.7" y="-.15" width="1.4" height=".3" rx=".05"/><circle class="lamp" cx="-.52" cy=".05" r=".09"/><circle class="lamp" cx="-.3" cy=".05" r=".09"/><circle class="lamp" cx=".3" cy=".05" r=".09"/><circle class="lamp" cx=".52" cy=".05" r=".09"/>';
      case 'vocal-main':
        return '<rect class="shape" x="-.15" y="-.68" width=".3" height=".38" rx=".15"/><path class="detail" d="M-.25-.36V-.2A.25.25 0 0 0 .25-.2V-.36M0 .05V.55M-.23.55H.23"/><circle class="detail-dot" cy="-.49" r=".04"/>';
      default:
        return '<circle class="shape" r=".3"/>';
    }
  }
  const visibleItems = (cue) => plan().items.filter((it) => RADIUS[it.type] && (isProp(it) || editing || store.showOff || stateOf(cue, it.id) !== 'off'));
  const performers = () => plan().items.filter((it) => RADIUS[it.type] && !isProp(it));

  // 聚焦：viewBox 貼住器材＋平台（左右 2.2 m、上 2 m 畀標籤、下 2.2 m），畫面唔使浪費喺空舞台
  function viewBoxFor(cue, s) {
    const padding = plan().viewPadding;
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
    if (padding) {
      x0 = Math.min(x0, -s.w / 2) - padding.x;
      x1 = Math.max(x1, s.w / 2) + padding.x;
      y0 = Math.min(y0, 0) - padding.top;
      y1 = Math.max(y1, s.d) + padding.bottom;
    } else {
      x0 -= 3.2; x1 += 3.2; y0 -= 2.4; y1 += 2.6;
    }
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
        bounds = footprint(it),
        hx = bounds.x * K,
        hy = bounds.y * K;
      if (st === 'solo' || st === 'hl')
        spots += `<circle class="spot" cx="${(pos.x + s.w / 2) * K}" cy="${pos.y * K}" r="${2.2 * K}" fill="url(#spot-${st})" pointer-events="none"/>`;
      g +=
        `<g class="perf ${st}" data-id="${esc(it.id)}" data-type="${esc(it.type)}" transform="translate(${(pos.x + s.w / 2) * K} ${pos.y * K})" ` +
        `${editing ? 'tabindex="0" role="button"' : 'role="img"'} aria-label="${esc(it.label || it.type)}：${STATE_LABEL[st]}">` +
        `<rect class="hit" x="${-hx}" y="${-hy}" width="${2 * hx}" height="${2 * hy}" fill="transparent"/>` +
        `<g transform="scale(${K}) rotate(${itemRot(it)}) scale(${ICON_SCALE[it.type] || 0.55})">${shape(it.type, it.icon)}</g>` +
        '</g>';
    }
    const grad = (id, c) => `<radialGradient id="spot-${id}"><stop offset="0%" stop-color="${c}" stop-opacity=".7"/><stop offset="100%" stop-color="${c}" stop-opacity="0"/></radialGradient>`;
    return (
      `<svg class="stage-svg${editing ? ' editing' : ''}" xmlns="${NS}" viewBox="${viewBoxFor(cue, s).join(' ')}" preserveAspectRatio="xMidYMid meet" role="group" aria-label="舞台平面圖">` +
      `<defs>${grad('solo', '#ffc233')}${grad('hl', '#31c6f5')}</defs>` +
      `<rect class="floor" x="0" y="0" width="${s.w * K}" height="${s.d * K}" rx="4"/>` +
      `<rect class="led" x="${((s.w - s.lw) / 2) * K}" y="${s.lo * K}" width="${s.lw * K}" height="${0.3 * K}"/>` +
      `<text class="edge" x="${(s.w / 2) * K}" y="${-0.35 * K}" text-anchor="middle">後牆 / 投影幕</text>` +
      spots +
      g +
      '<g class="labels" pointer-events="none"></g>' +
      `<text class="edge" x="${(s.w / 2) * K}" y="${(s.d + 1.2) * K}" text-anchor="middle">▼ 觀眾席</text></svg>`
    );
  }

  // 平台文字（跟平台旋轉，細字）當固定障礙，標籤唔好壓住
  function platformBoxes(s) {
    const screen = {
      id: 'projection-screen',
      x1: ((s.w - s.lw) / 2) * K,
      y1: s.lo * K,
      x2: ((s.w + s.lw) / 2) * K,
      y2: (s.lo + 0.3) * K,
    };
    return [screen, ...(plan().platforms || []).map((pf) => {
      const a = ((pf.rot || 0) * Math.PI) / 180,
        lx = (-pf.w / 2) * K + 6 + 36,
        ly = (-pf.d / 2) * K + 9,
        cx = (pf.x + s.w / 2) * K + lx * Math.cos(a) - ly * Math.sin(a),
        cy = pf.y * K + lx * Math.sin(a) + ly * Math.cos(a);
      return { x1: cx - 42, y1: cy - 12, x2: cx + 42, y2: cy + 12, id: pf.id + '-text' };
    })];
  }
  // 根據而家嘅器材位置重新排標籤（拖動時都會叫）
  function layoutLabels(svg, cue) {
    const s = plan().stage,
      vb = svg.viewBox.baseVal,
      rect = svg.getBoundingClientRect(),
      sc = rect.width > 0 && rect.height > 0 ? Math.min(rect.width / vb.width, rect.height / vb.height) : 1,
      fu = Math.min(16, Math.max(4, (rect.width < 420 ? 10 : 12) / sc)),
      maxLabelWidth = (rect.width < 420 ? 58 : 180) / sc,
      items = visibleItems(cue).map((it) => {
        const g = svg.querySelector(`.perf[data-id="${CSS.escape(it.id)}"]`),
          m = /translate\(([-\d.]+) ([-\d.]+)\)/.exec(g.getAttribute('transform')),
          st = itemState(cue, it),
          playerSuffix = it.roleOnly ? '' : data.players[it.id] ? ' · ' + data.players[it.id] : '',
          rawLines = it.type === 'chair' ? [] : labelLines(it, playerSuffix, st),
          compact = (plan().compactInstrumentLabels && INSTRUMENTS.has(it.type)) || it.compactLabel === true,
          labelFont = compact ? Math.max(rect.width < 420 ? 6 : 2, fu * (plan().instrumentLabelScale || 0.42)) : fu,
          [baseX, baseY] = compact ? ICON_BOUNDS[it.type] || [RADIUS[it.type], RADIUS[it.type]] : [RADIUS[it.type], RADIUS[it.type]],
          a = (compact ? itemRot(it) : 0) * Math.PI / 180,
          rx = Math.abs(Math.cos(a)) * baseX + Math.abs(Math.sin(a)) * baseY,
          ry = Math.abs(Math.sin(a)) * baseX + Math.abs(Math.cos(a)) * baseY;
        return {
          id: it.id,
          cx: +m[1],
          cy: +m[2],
          r: Math.max(rx, ry),
          rx,
          ry,
          labelSide: compact ? it.labelSide : undefined,
          font: labelFont,
          compact,
          gapScale: compact ? plan().instrumentLabelGapScale || 0.45 : 1,
          lines: wrapLabelLines(rawLines, st, labelFont, maxLabelWidth),
          st,
        };
      }),
      edgePad = fu + 4,
      bounds = { x1: edgePad, y1: 2, x2: s.w * K - edgePad, y2: s.d * K - fu - 4 },
      pos = placeLabels(items, bounds, platformBoxes(s), fu, Math.min(3, Math.max(0.5, 1 / sc))),
      lg = svg.querySelector('.labels');
    svg.querySelectorAll('.platform text').forEach((tx) => (tx.style.fontSize = Math.max(5, fu * 0.8) + 'px'));
    lg.innerHTML = '';
    for (const it of items) {
      const pl = pos.get(it.id);
      if (!pl) continue;
      const x = pl.anchor === 'middle' ? (pl.box.x1 + pl.box.x2) / 2 : pl.anchor === 'start' ? pl.box.x1 + 4 : pl.box.x2 - 4;
      if (plan().leaderLines !== false && pl.gap * Math.min(3, Math.max(0.5, 1 / sc)) > 0.9 * it.r * K) {
        const leader = document.createElementNS(NS, 'line');
        leader.setAttribute('class', 'leader');
        leader.setAttribute('data-for', it.id);
        leader.setAttribute('x1', it.cx);
        leader.setAttribute('y1', it.cy);
        leader.setAttribute('x2', Math.min(Math.max(it.cx, pl.box.x1), pl.box.x2));
        leader.setAttribute('y2', Math.min(Math.max(it.cy, pl.box.y1), pl.box.y2));
        lg.append(leader);
      }
      it.lines.forEach((line, i) => {
        const t = document.createElementNS(NS, 'text');
        t.setAttribute('class', `lbl ${it.st}${i === 0 && it.st !== 'on' && it.st !== 'off' ? ' main' : ''}`);
        t.setAttribute('data-for', it.id);
        t.setAttribute('x', x);
        t.setAttribute('y', pl.box.y1 + it.font + (it.compact ? 0 : 1) + i * (it.font + (it.compact ? 1 : 3)));
        t.style.fontSize = it.font + 'px';
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
  function rotateTools() {
    const items = plan().items.filter((it) => RADIUS[it.type] && !isProp(it));
    if (!items.length) return '';
    if (!items.some((it) => it.id === selectedRotateId)) selectedRotateId = items[0].id;
    const selected = items.find((it) => it.id === selectedRotateId);
    return '<span class="stage-rotate-tools" aria-label="旋轉器材">' +
      '<select data-act="rotate-target" aria-label="選擇要旋轉的器材">' +
      items.map((it) => `<option value="${esc(it.id)}" ${it.id === selectedRotateId ? 'selected' : ''}>${esc(it.label || it.type)}</option>`).join('') +
      `</select><span class="stage-rotation-angle" data-rotation-angle aria-live="polite">${itemRot(selected)}°</span>` +
      '<button class="smallbtn" data-act="rotate-left" aria-label="向左旋轉 15 度" title="向左轉 15 度">↶ 15°</button>' +
      '<button class="smallbtn" data-act="rotate-right" aria-label="向右旋轉 15 度" title="向右轉 15 度">↷ 15°</button></span>';
  }

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
      (editing ? rotateTools() : '') +
      '</div>' +
      `<div class="stagewrap">${svgFor(cue)}</div>` +
      '<div class="docbar partbar" role="group" aria-label="段落">' +
      cues.map((c, i) => `<button class="vchip" data-part="${i}" aria-pressed="${i === idx}">${esc(c.name)}${c.at != null ? ' · ' + fmt(c.at) : ''}</button>`).join('') +
      (editing ? '<button class="smallbtn" data-act="addpart">＋ 段落</button>' : '') +
      '</div>' +
      `<div class="stagesum" aria-live="polite">${esc(s.number + ' ' + s.title)} · ${esc(cue.name)}：台上 ${n.on + n.solo + n.hl}，SOLO ${n.solo}，HIGHLIGHT ${n.hl}${editing ? '。拖動定位；選取器材後用旋轉掣轉向（每次 15°）' : ''}</div>` +
      (editing
        ? '<div class="docbar partedit">' +
          '<button class="smallbtn" data-act="rename">改名</button><button class="smallbtn" data-act="stamp">記低而家時間</button>' +
          '<button class="smallbtn" data-act="clearat">清時間</button><button class="smallbtn" data-act="delpart">刪除段落</button>' +
          '<button class="smallbtn" data-act="resetsong">重設本曲</button><button class="smallbtn" data-act="resetpos">重設位置</button>' +
          '<button class="smallbtn" data-act="save-layout">儲存到 Downloads</button><button class="smallbtn" data-act="import">匯入</button>' +
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
    const rotateTarget = box.querySelector('[data-act="rotate-target"]');
    if (rotateTarget) rotateTarget.onchange = () => {
      selectedRotateId = rotateTarget.value;
      const target = plan().items.find((it) => it.id === selectedRotateId);
      const angle = box.querySelector('[data-rotation-angle]');
      if (target && angle) angle.textContent = itemRot(target) + '°';
    };
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
      clampPos = (it, x, y) => {
        const bounds = footprint(it),
          px = Math.min(st.w / 2 - bounds.x, Math.max(-st.w / 2 + bounds.x, snap(x))),
          py = Math.min(st.d - bounds.y, Math.max(bounds.y, snap(y))),
          sx0 = (st.w - (st.lw || 0)) / 2,
          sx1 = (st.w + (st.lw || 0)) / 2,
          sy0 = st.lo || 0,
          sy1 = sy0 + 0.3,
          screenOverlapX = px + bounds.x > sx0 && px - bounds.x < sx1,
          screenOverlapY = py + bounds.y > sy0 && py - bounds.y < sy1;
        return { x: px, y: screenOverlapX && screenOverlapY ? Math.min(st.d - bounds.y, Math.max(py, sy1 + bounds.y)) : py };
      },
      setPos = (id, x, y) => {
        const it = plan().items.find((item) => item.id === id);
        if (!it) return;
        (store.pos[store.planId] = store.pos[store.planId] || {})[id] = clampPos(it, x, y);
        save();
      },
      turnSelected = (delta) => {
        const it = plan().items.find((item) => item.id === selectedRotateId);
        if (!it) return;
        const current = itemRot(it), next = ((current + delta) % 360 + 360) % 360;
        (store.rot[store.planId] = store.rot[store.planId] || {})[it.id] = next;
        save();
        render();
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
              np = clampPos(it, origin.x + (p.x - p0.x) / K, origin.y + (p.y - p0.y) / K);
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
      resetpos: () => { if (confirm('全部器材位置和方向還原成舞台圖原位？')) { delete store.pos[store.planId]; delete store.rot[store.planId]; save(); render(); } },
      'rotate-left': () => turnSelected(-15),
      'rotate-right': () => turnSelected(15),
      'save-layout': () => {
        save();
        const payload = {
          format: 'show-board-stage-layout-v1',
          planId: store.planId,
          stage: plan().stage,
          items: plan().items.map((it) => ({ ...it, ...itemPos(it), rot: itemRot(it) })),
          cues: store.cues,
          pos: store.pos,
          rot: store.rot,
          people: window.People ? People.export() : undefined,
        };
        const blob = new Blob([JSON.stringify(payload, null, 2) + '\n'], { type: 'application/json' });
        const url = URL.createObjectURL(blob), link = document.createElement('a');
        link.href = url;
        link.download = `${KEY.replace('-show-flow-stage-v2', '')}-stage-layout.json`;
        link.click();
        setTimeout(() => URL.revokeObjectURL(url), 1000);
        ctx.toast('舞台位置和方向已儲存，JSON 已下載 ✓');
      },
      import: () => {
        const raw = prompt('貼上舞台設定 JSON（會取代你本機嘅舞台設定）');
        if (!raw) return;
        try {
          const j = JSON.parse(raw);
          if (!j || typeof j.cues !== 'object') throw Error('shape');
          for (const v of Object.values(j.cues)) if (!Array.isArray(v) || !v.every((c) => c && Array.isArray(c.on) && Array.isArray(c.solo))) throw Error('cue');
          store = { planId: data.plans.some((p) => p.id === j.planId) ? j.planId : store.planId, cues: j.cues, pos: j.pos && typeof j.pos === 'object' ? j.pos : {}, rot: j.rot && typeof j.rot === 'object' ? j.rot : {}, showOff: store.showOff, fit: store.fit };
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
        return { id: it.id, type: it.type, label: it.label, x: pos.x, y: pos.y, rot: itemRot(it), state: itemState(cue, it), w: it.w, d: it.d, h: it.h, elev: it.elev || 0, player: it.player, chair: it.chair, sitWhen: it.sitWhen || null };
      }),
    };
  }
  // ---- 輸出報告用 ----
  // 2D 圖寫入計算後顏色用：只寫同瀏覽器預設唔同嘅屬性，文字另加字體
  const PAINT = ['fill', 'stroke', 'stroke-width', 'stroke-dasharray', 'opacity', 'fill-opacity', 'stroke-opacity', 'stroke-linecap', 'stroke-linejoin'];
  // Standalone text exports avoid the web-only halo stroke that obscures labels in SVG viewers.
  const PAINT_TEXT = ['fill', 'opacity', 'fill-opacity', 'font-size', 'font-family', 'font-weight', 'text-anchor'];
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
  function exportSvg(s, i, widthPx, overrideCue = null) {
    const cues = overrideCue ? [] : cuesOf(s),
      cue = overrideCue || cues[Math.min(Math.max(i || 0, 0), cues.length - 1)],
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
      const vb = svg.viewBox.baseVal;
      const bg = document.createElementNS(NS, 'rect');
      bg.setAttribute('x', vb.x);
      bg.setAttribute('y', vb.y);
      bg.setAttribute('width', vb.width);
      bg.setAttribute('height', vb.height);
      bg.setAttribute('fill', getComputedStyle(host).backgroundColor);
      bg.setAttribute('stroke', 'none');
      svg.prepend(bg);
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
      svg.setAttribute('width', String(widthPx));
      svg.setAttribute('height', String(Math.ceil(widthPx * vb.height / vb.width)));
      svg.setAttribute('style', 'display:block');
      return svg.outerHTML;
    } finally {
      host.remove();
      editing = was;
    }
  }
  function exportPlanSvg(widthPx) {
    const p = plan();
    const cue = {
      name: '舞台平面圖',
      on: p.items.filter((it) => RADIUS[it.type] && !isProp(it)).map((it) => it.id),
      solo: [],
      hl: [],
      note: '',
    };
    return exportSvg({ number: '__stage-plan__', parts: [] }, 0, widthPx, cue);
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
    exportPlanSvg,
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
