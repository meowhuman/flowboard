// 人物：每位樂手嘅性別（男／女）同服裝（上身／下身／鞋／髮色／款式），由主題色（hex）隨機配衣。
// 資料存 localStorage；3D（stage3d.js）同設定視窗都經呢度讀寫。
(() => {
  const KEY = 'flowboard-people-v1';
  // 預設主題色：示範用 Pantone 19-1650 TCX Biking Red、15-3920 TCX Placid Blue（hex 係近似值，要用確實 hex 就喺視窗改）
  const DEFAULT_PALETTE = ["#7b1e2e","#8fa9d2"];
  const DEFAULT_OUTFIT = null;
  const PEOPLE_HINT = '主題色（hex，用空白或逗號分隔）。預設係你畀嘅 Pantone Biking Red ≈ #7b1e2e、Placid Blue ≈ #8fa9d2（近似值，有確實 hex 就改呢度）。';
  const NEUTRAL_DARK = ['#1b1b1d', '#2b2f3a', '#3a3d44'];
  const NEUTRAL_LIGHT = ['#f2efe8', '#cfd3d8', '#8f9296'];
  const HAIR = ['#1c1512', '#3a2619', '#5a3a24', '#c9b27c'];
  const STYLES = { dress: '連身裙', skirt: '上衣＋裙', trousers: '上衣＋褲' };
  let state = { palette: [...DEFAULT_PALETTE], seed: 1, people: {} };
  let plan = null;
  const listeners = [];

  const load = () => {
    try {
      const s = JSON.parse(localStorage.getItem(KEY));
      if (s && typeof s === 'object') state = { palette: Array.isArray(s.palette) && s.palette.length ? s.palette : [...DEFAULT_PALETTE], seed: s.seed || 1, people: s.people || {} };
    } catch {}
  };
  const save = () => {
    try {
      localStorage.setItem(KEY, JSON.stringify(state));
    } catch {}
  };
  const emit = () => listeners.forEach((f) => f());
  const isHex = (h) => /^#[0-9a-f]{6}$/i.test(h);
  const parseHexes = (txt) => [...new Set((String(txt).match(/#?[0-9a-fA-F]{6}\b/g) || []).map((h) => ('#' + h.replace('#', '')).toLowerCase()))];

  function rng(seed) {                         // mulberry32：同一個 seed 出同一套衣
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const performers = () => (plan ? plan.items.filter((i) => ['piano', 'guitar-e', 'bass', 'drums', 'sax', 'vocal-main', 'vocal-back'].includes(i.type)) : []);
  const defGender = (it) => it.gender || (it.type === 'vocal-main' || it.type === 'vocal-back' ? 'f' : 'm');

  // 按主題色隨機配衣：每個主題色至少用一次；女款有連身裙／裙／褲；男款上衣＋褲；鞋深色；髮色自然色
  function generate(palette, seed) {
    const rand = rng(seed),
      pick = (a) => a[Math.floor(rand() * a.length)],
      P = palette.length ? palette : DEFAULT_PALETTE,
      list = performers(),
      order = list.map((_, i) => i).sort(() => rand() - 0.5);
    const out = {};
    list.forEach((it, k) => {
      const g = (state.people[it.id] && state.people[it.id].gender) || defGender(it),
        base = P[order.indexOf(k) % P.length],                       // 保證每個主題色都出場
        style = g === 'f' ? pick(['dress', 'skirt', 'skirt', 'trousers']) : 'trousers',
        pool = [...P, ...NEUTRAL_DARK, ...NEUTRAL_LIGHT].filter((c) => c !== base);
      const top = (DEFAULT_OUTFIT && DEFAULT_OUTFIT.top) || base,
        bottom = (DEFAULT_OUTFIT && DEFAULT_OUTFIT.bottom) || (style === 'dress' ? base : pick(g === 'f' ? pool : [...NEUTRAL_DARK, ...P.filter((c) => c !== base), ...NEUTRAL_DARK])),
        shoes = (DEFAULT_OUTFIT && DEFAULT_OUTFIT.shoes) || (rand() < 0.75 ? pick(NEUTRAL_DARK) : pick(P)),
        hair = (DEFAULT_OUTFIT && DEFAULT_OUTFIT.hair) || (g === 'f' ? pick(HAIR) : pick(HAIR.slice(0, 3)));
      out[it.id] = { gender: g, outfit: { top, bottom, shoes, hair, style } };
    });
    return out;
  }
  function get(id) {
    const it = plan && plan.items.find((i) => i.id === id),
      p = state.people[id];
    if (p) return { gender: p.gender || (it ? defGender(it) : 'm'), outfit: p.outfit };
    return { gender: it ? defGender(it) : 'm', outfit: null };
  }
  function ensureDefaults() {
    if (!plan) return;
    const missing = performers().some((it) => !state.people[it.id] || !state.people[it.id].outfit);
    if (missing) {
      state.people = { ...generate(state.palette, state.seed), ...Object.fromEntries(Object.entries(state.people).filter(([, v]) => v && v.outfit)) };
      save();
    }
  }
  function openDialog() {
    if (!plan) return;
    ensureDefaults();
    let dlg = document.querySelector('#peopleDlg');
    if (dlg) dlg.remove();
    dlg = document.createElement('dialog');
    dlg.id = 'peopleDlg';
    dlg.className = 'peopledlg';
    const esc = (x) => String(x).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
    const rows = performers().map((it) => {
      const p = get(it.id),
        o = p.outfit || { top: '#888888', bottom: '#444444', shoes: '#1b1b1d', hair: '#1c1512', style: 'trousers' },
        name = String(it.label || it.type).replace(/ ★.*$/, '') + (it.type === 'piano' ? ' + Keyboard' : '');
      return `<tr data-id="${esc(it.id)}"><th>${esc(name)}</th>` +
        `<td><select data-f="gender" aria-label="${esc(name)} 性別"><option value="f"${p.gender === 'f' ? ' selected' : ''}>女 ♀</option><option value="m"${p.gender === 'm' ? ' selected' : ''}>男 ♂</option></select></td>` +
        ['top', 'bottom', 'shoes', 'hair'].map((k) => `<td><input type="color" data-f="${k}" value="${esc(o[k])}" aria-label="${esc(name)} ${k}"></td>`).join('') +
        `<td><select data-f="style" aria-label="${esc(name)} 款式">${Object.entries(STYLES).map(([v, l]) => `<option value="${v}"${o.style === v ? ' selected' : ''}>${l}</option>`).join('')}</select></td></tr>`;
    }).join('');
    dlg.innerHTML =
      '<form method="dialog"><h2>人物／服裝</h2>' +
      `<p class="hint">${esc(PEOPLE_HINT)}</p>` +
      `<div class="pal"><input id="palIn" aria-label="主題色 hex" value="${esc(state.palette.join(' '))}"><span id="palSw">${state.palette.map((c) => `<i style="background:${esc(c)}" title="${esc(c)}"></i>`).join('')}</span></div>` +
      '<div class="pbar"><button type="button" data-a="gen">按主題色隨機配衣</button><button type="button" data-a="again">再抽一次（新 seed）</button><span id="seedTxt">seed ' + state.seed + '</span></div>' +
      '<div class="ptable"><table><thead><tr><th>樂手</th><th>性別</th><th>上身</th><th>下身</th><th>鞋</th><th>髮</th><th>款式</th></tr></thead><tbody>' + rows + '</tbody></table></div>' +
      '<div class="pbar"><button value="close">完成</button></div></form>';
    document.body.append(dlg);
    const apply = () => { save(); emit(); };
    dlg.querySelector('#palIn').onchange = (e) => {
      const hx = parseHexes(e.target.value);
      if (!hx.length) { e.target.value = state.palette.join(' '); return; }
      state.palette = hx; save();
      dlg.querySelector('#palSw').innerHTML = hx.map((c) => `<i style="background:${c}" title="${c}"></i>`).join('');
    };
    const regen = (newSeed) => {
      if (newSeed) state.seed = Math.floor(Math.random() * 1e6) + 1;
      const gen = generate(state.palette, state.seed);
      for (const [id, v] of Object.entries(gen)) state.people[id] = { gender: (state.people[id] && state.people[id].gender) || v.gender, outfit: v.outfit };
      apply();
      openDialog();
    };
    dlg.querySelector('[data-a="gen"]').onclick = () => regen(false);
    dlg.querySelector('[data-a="again"]').onclick = () => regen(true);
    dlg.querySelectorAll('tr[data-id] [data-f]').forEach((el) => {
      el.onchange = el.oninput = () => {
        const id = el.closest('tr').dataset.id,
          cur = state.people[id] || { gender: defGender(plan.items.find((i) => i.id === id)), outfit: get(id).outfit };
        if (el.dataset.f === 'gender') {
          cur.gender = el.value;
          if (cur.gender === 'm' && cur.outfit && cur.outfit.style !== 'trousers') cur.outfit = { ...cur.outfit, style: 'trousers' };
        } else cur.outfit = { ...cur.outfit, [el.dataset.f]: el.value };
        state.people[id] = cur;
        apply();
        if (el.dataset.f === 'gender') openDialog();
      };
    });
    dlg.addEventListener('close', () => dlg.remove());
    dlg.showModal();
  }

  window.People = {
    init(p) { plan = p; load(); ensureDefaults(); },
    get,
    onChange(f) { listeners.push(f); },
    openDialog,
    generate,
    palette: () => [...state.palette],
    export: () => JSON.parse(JSON.stringify(state)),
    import(s) { if (s && typeof s === 'object') { state = { palette: s.palette || state.palette, seed: s.seed || state.seed, people: s.people || state.people }; save(); emit(); } },
    isHex,
    _state: () => state,
  };
})();
