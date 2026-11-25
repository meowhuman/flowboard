// 輸出：揀要輸出乜（歌單、2D 舞台圖、3D 畫面、燈光設定…）→ 產生一份自包含 HTML 報告（可下載，或列印／存成 PDF）。
// 尺寸、鏡頭、出圖品質喺 stage-plans.json 嘅 export；揀咗乜記喺 localStorage。
const KEY = 'flowboard-export-v1';
const SECTIONS = [
  { id: 'order', label: '歌單與次序', hint: '次序、段落、BPM、配咗嘅 loop', def: true },
  { id: 'matrix', label: '全場總表', hint: '每首歌邊個上台／SOLO／HIGHLIGHT', def: true },
  { id: 'stage2d', label: '2D 舞台圖', hint: '每首歌每個段落一張', def: true },
  { id: 'three', label: '3D 畫面', hint: '連燈光、煙霧；鏡頭喺下面揀', def: true },
  { id: 'timeline', label: '段落時間表', hint: '時間、台上、SOLO、燈光備註', def: true },
  { id: 'light', label: '燈光設定', hint: '面光／逆光／追光顏色強度、追光名單、煙霧', def: true },
  { id: 'people', label: '服裝', hint: '每位樂手性別同衣服顏色', def: false },
];
const STATE_LABEL = { solo: 'SOLO', hl: 'HIGHLIGHT', on: '台上' };
const GLYPH = { on: '●', solo: '★', hl: '◆', off: '' };
const esc = (x) => String(x ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
const fmt = (t) => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
const pad = (n) => String(n).padStart(2, '0');
const stamp = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
const fileStamp = (d) => `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}`;
const loadPrefs = () => { try { const s = JSON.parse(localStorage.getItem(KEY)); return s && typeof s === 'object' ? s : {}; } catch { return {}; } };
const savePrefs = (p) => { try { localStorage.setItem(KEY, JSON.stringify(p)); } catch {} };

// ---------------- 報告 HTML ----------------
const REPORT_CSS = `
:root{color-scheme:light}*{box-sizing:border-box}
body{margin:0;background:#fff;color:#1b1d1b;font:14px/1.55 system-ui,-apple-system,'PingFang TC','Noto Sans TC',sans-serif}
main{max-width:1100px;margin:0 auto;padding:20px 16px 40px}
h1{font:700 26px Georgia,'Noto Serif TC',serif;margin:0 0 2px}h2{font-size:19px;margin:0 0 6px}h3{font-size:15px;margin:14px 0 4px}
.sub{color:#5b605b;margin:0 0 14px;font-size:13px}.sec{margin:26px 0 0}.sec>h2{border-bottom:2px solid #c76543;padding-bottom:3px}
table{border-collapse:collapse;width:100%;font-size:13px}th,td{border:1px solid #cfd3cd;padding:4px 7px;text-align:left;vertical-align:top}
th{background:#f1f2ee;font-weight:600}.scroll{overflow-x:auto}td.m{text-align:center;font-size:15px;min-width:34px}
td.solo{background:#ffe9a8}td.hl{background:#c9effb}td.on{background:#e4e8e2}.n{white-space:nowrap}
.song{margin-top:28px;break-before:page}.song>h2{font-size:21px}.song>h2 .no{color:#c76543;margin-right:6px}.song small,.cue small{color:#5b605b;font-weight:400;font-size:12px}
.figs{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,340px),1fr));gap:10px;margin:6px 0}
.fig{margin:0;break-inside:avoid}.fig>div,.fig>img{display:block;width:100%;border-radius:6px;border:1px solid #cfd3cd}.fig figcaption{font-size:12px;color:#5b605b;margin-top:2px}
.cue{break-inside:avoid;margin-top:10px}.who{margin:2px 0;font-size:13px}.note{margin:2px 0;padding:4px 8px;border-left:3px solid #c76543;background:#faf3ef;font-size:13px}
.sw{display:inline-block;width:14px;height:14px;border:1px solid #888;border-radius:3px;vertical-align:-2px;margin-right:5px}
.bar{display:inline-block;width:110px;height:8px;background:#e3e5e0;border-radius:4px;vertical-align:middle;margin-right:6px;overflow:hidden}.bar i{display:block;height:100%;background:#c76543}
.disc{color:#5b605b;font-size:12px;margin-top:6px}ul.toc{columns:2;margin:6px 0;padding-left:18px;font-size:13px}
@media (max-width:600px){main{padding:12px 10px 30px}h1{font-size:21px}ul.toc{columns:1}th,td{padding:3px 5px;font-size:12px}}
footer.credit{margin-top:28px;padding-top:10px;border-top:1px solid #d6d2c8;color:#6b675f;font-size:12px}
@page{size:A4;margin:12mm}
@media print{body{font-size:11.5px;-webkit-print-color-adjust:exact;print-color-adjust:exact}main{max-width:none;padding:0}.song:first-of-type{break-before:auto}.sec{break-inside:avoid-page}}
`;

function buildReport(m) {
  const { title, when, sel, songs, perfs, data, light, people, imgs, svgs, bg, camLabels, loops, planTitle, skipped, credit } = m;
  const pname = (id) => (perfs.find((p) => p.id === id) || { name: id }).name;
  const out = [];
  out.push(`<h1>${esc(title)}</h1><p class="sub">輸出時間 ${esc(when)} · ${songs.length} 首 · 舞台圖：${esc(planTitle)}</p>`);
  if (skipped.length) out.push(`<p class="note">${esc(skipped.join('；'))}</p>`);
  if (sel.order) {
    out.push('<div class="sec"><h2>歌單與次序</h2><div class="scroll"><table><thead><tr><th>#</th><th>歌名</th><th>段落</th><th>BPM</th><th>段落數</th><th>配咗嘅 loop</th></tr></thead><tbody>');
    songs.forEach((s, i) => {
      const cs = data.songs.find((x) => x.number === s.number).cues;
      out.push(`<tr><td class="n">${i + 1} · ${esc(s.number)}</td><td><b>${esc(s.title)}</b><br><small>${esc(s.credit || '')}</small></td><td>${esc(s.section || '')}</td><td>${s.bpm ? esc(s.bpm) : '—'}</td><td>${cs.length}</td><td>${(loops[s.number] || []).map(esc).join('<br>') || '—'}</td></tr>`);
    });
    out.push('</tbody></table></div></div>');
  }
  if (sel.matrix) {
    out.push('<div class="sec"><h2>全場總表</h2><p class="sub">● 台上　★ SOLO　◆ HIGHLIGHT（取該首最高狀態）</p><div class="scroll"><table><thead><tr><th>歌曲</th>' + perfs.map((p) => `<th>${esc(p.name)}</th>`).join('') + '</tr></thead><tbody>');
    for (const s of songs) {
      const cs = data.songs.find((x) => x.number === s.number).cues;
      out.push(`<tr><th>${esc(s.number)} ${esc(s.title)}</th>` + perfs.map((p) => {
        const sts = cs.map((c) => c.states[p.id]), best = sts.includes('solo') ? 'solo' : sts.includes('hl') ? 'hl' : sts.includes('on') ? 'on' : 'off';
        return `<td class="m ${best}">${GLYPH[best]}</td>`;
      }).join('') + '</tr>');
    }
    out.push('</tbody></table></div></div>');
  }
  if (sel.light && light) {
    const L = light;
    out.push(`<div class="sec"><h2>燈光設定</h2><p class="sub">預設：<b>${esc(L.preset.name)}</b>${L.preset.hint ? '（' + esc(L.preset.hint) + '）' : ''}${L.preset.custom ? ' · 已手動改過顏色／強度' : ''}${L.preset.chase ? ' · 顏色按 BPM 循環' : ''}${L.hang ? ' · 燈吊高 ' + L.hang.toFixed(1) + ' m（投影幕頂）' : ''}</p>`);
    out.push('<table><thead><tr><th>燈組</th><th>顏色</th><th>強度（0＝熄，' + L.levels + '＝最亮）</th></tr></thead><tbody>');
    for (const g of L.groups) out.push(`<tr><td>${esc(g.label)}</td><td><span class="sw" style="background:${esc(g.color)}"></span>${esc(g.color)}</td><td><span class="bar"><i style="width:${(g.level / L.levels) * 100}%"></i></span>${g.level} / ${L.levels}</td></tr>`);
    const sp = L.spot;
    out.push(`<tr><td>自訂追光 ${sp.on ? '（開）' : '（熄）'}</td><td><span class="sw" style="background:${esc(sp.color)}"></span>${esc(sp.color)}</td><td>強度 ${sp.strength} / ${L.levels} · 光束闊度 ${sp.width} / ${L.levels}<br>名單：${sp.targets.length ? sp.targets.map(esc).join('、') : '—'}</td></tr>`);
    out.push('</tbody></table>');
    out.push('<table style="margin-top:8px"><thead><tr><th>煙霧機</th><th>狀態</th><th>位置</th><th>強度</th></tr></thead><tbody>' + L.fog.map((f) => `<tr><td>${esc(f.name)}</td><td>${f.on ? '開' : '熄'}</td><td>${esc(f.pos)}</td><td>${f.strength} / ${L.levels}</td></tr>`).join('') + '</tbody></table>');
    out.push('<p class="disc">視覺預覽設定（試吓感覺），唔係燈光師 cue 表。追光名單入面「跟 solo／highlight」會跟住每個段落嘅 SOLO／HIGHLIGHT 樂手。</p></div>');
  }
  if (sel.people && people) {
    out.push('<div class="sec"><h2>服裝</h2><p class="sub">主題色：' + people.palette.map((c) => `<span class="sw" style="background:${esc(c)}"></span>${esc(c)}`).join('　') + '</p><div class="scroll"><table><thead><tr><th>樂手</th><th>性別</th><th>款式</th><th>上身</th><th>下身</th><th>鞋</th><th>髮色</th></tr></thead><tbody>');
    for (const p of perfs) {
      const q = people.people[p.id], o = q && q.outfit;
      if (!o) continue;
      const c = (h) => `<span class="sw" style="background:${esc(h)}"></span>${esc(h)}`;
      out.push(`<tr><td>${esc(p.name)}</td><td>${q.gender === 'f' ? '女' : '男'}</td><td>${esc(people.styles[o.style] || o.style || '')}</td><td>${c(o.top)}</td><td>${c(o.bottom)}</td><td>${c(o.shoes)}</td><td>${c(o.hair)}</td></tr>`);
    }
    out.push('</tbody></table></div></div>');
  }
  if (sel.stage2d || sel.three || sel.timeline) {
    if (songs.length > 3) out.push('<div class="sec"><h2>目錄</h2><ul class="toc">' + songs.map((s) => `<li><a href="#s${esc(s.number)}">${esc(s.number)} ${esc(s.title)}</a></li>`).join('') + '</ul></div>');
    for (const s of songs) {
      const cues = data.songs.find((x) => x.number === s.number).cues;
      out.push(`<section class="song" id="s${esc(s.number)}"><h2><span class="no">${esc(s.number)}</span>${esc(s.title)} <small>${esc(s.section || '')}${s.bpm ? ' · BPM ' + esc(s.bpm) : ''}</small></h2>`);
      if (s.credit) out.push(`<p class="sub">${esc(s.credit)}</p>`);
      if (sel.stage2d || sel.three) {
        cues.forEach((c, i) => {
          const who = (st) => perfs.filter((p) => c.states[p.id] === st).map((p) => esc(p.name)).join('、');
          out.push(`<div class="cue"><h3>${esc(c.name)} <small>${c.at != null ? fmt(c.at) : ''}</small></h3><div class="figs">`);
          if (sel.stage2d && svgs[s.number]) out.push(`<figure class="fig"><div style="background:${esc(bg)};padding:4px">${svgs[s.number][i]}</div><figcaption>2D 舞台圖（觀眾席喺下面）</figcaption></figure>`);
          if (sel.three && imgs[s.number]) for (const im of imgs[s.number][i] || []) out.push(`<figure class="fig"><img alt="${esc(s.title)} ${esc(c.name)} 3D" src="${im.url}"><figcaption>3D · ${esc(camLabels[im.id] || im.id)}</figcaption></figure>`);
          out.push('</div>');
          out.push(`<p class="who">${who('solo') ? '<b>★ SOLO</b>：' + who('solo') + '　' : ''}${who('hl') ? '<b>◆ HIGHLIGHT</b>：' + who('hl') + '　' : ''}<b>台上</b>：${who('on') || '—'}</p>`);
          if (c.note) out.push(`<p class="note">${esc(c.note)}</p>`);
          out.push('</div>');
        });
      }
      if (sel.timeline) {
        out.push('<h3>段落時間表</h3><div class="scroll"><table><thead><tr><th>時間</th><th>段落</th><th>台上</th><th>SOLO</th><th>HIGHLIGHT</th><th>燈光／走位備註</th></tr></thead><tbody>');
        for (const c of cues) {
          const who = (st) => perfs.filter((p) => c.states[p.id] === st).map((p) => esc(p.name)).join('、') || '—';
          out.push(`<tr><td class="n">${c.at != null ? fmt(c.at) : '—'}</td><td>${esc(c.name)}</td><td>${who('on')}</td><td>${who('solo')}</td><td>${who('hl')}</td><td>${esc(c.note) || '—'}</td></tr>`);
        }
        out.push('</tbody></table></div>');
      }
      out.push('</section>');
    }
  }
  return `<!doctype html><html lang="zh-Hant"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)} ${esc(when)}</title><style>${REPORT_CSS}</style></head><body><main>${out.join('')}${credit && credit.text ? `<footer class="credit">${esc(credit.text)}${credit.url ? ' · ' + esc(credit.url) : ''}</footer>` : ''}</main></body></html>`;
}

// ---------------- 視窗 ----------------
export async function openExport(api) {
  const { StageView } = api;
  const plans = await (await fetch('stage-plans.json')).json();
  const ec = plans.export;
  if (!ec) throw new Error('stage-plans.json 冇 export 設定');
  const prefs = loadPrefs();
  const songs = api.songs();
  const tick = (id, def) => (prefs.sel && id in prefs.sel ? !!prefs.sel[id] : def);
  const camOn = (id, def) => (prefs.cams && id in prefs.cams ? !!prefs.cams[id] : def);
  const opener = document.activeElement;

  const back = document.createElement('div');
  back.className = 'exp-back';
  back.innerHTML =
    '<div class="exp-card" role="dialog" aria-modal="true" aria-label="輸出">' +
    '<header class="exp-head"><h2>輸出</h2><button class="smallbtn" data-x aria-label="關閉">✕</button></header>' +
    '<div class="exp-body" data-body></div><div class="exp-foot" data-foot></div></div>';
  document.body.append(back);
  const body = back.querySelector('[data-body]'), foot = back.querySelector('[data-foot]');
  let runId = 0, closed = false, html = '', fileName = '';
  const close = () => { closed = true; back.remove(); document.removeEventListener('keydown', onKey); if (opener && opener.focus) opener.focus(); };
  const onKey = (e) => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', onKey);
  back.querySelector('[data-x]').onclick = close;
  back.addEventListener('mousedown', (e) => { if (e.target === back) close(); });

  function showForm() {
    body.innerHTML =
      '<div class="exp-standalone"><div><b>獨立舞台圖</b><small>輸出單張 2D SVG，不含歌曲資料</small></div><button class="smallbtn" data-download-plan>下載 2D SVG</button></div>' +
      '<fieldset class="exp-set"><legend>輸出邊啲</legend>' +
      '<div class="exp-tools"><button class="smallbtn" data-sec-all>全選項目</button></div>' +
      SECTIONS.map((s) => `<div class="exp-row"><label class="exp-choice"><input type="checkbox" data-sec="${s.id}"${tick(s.id, s.def) ? ' checked' : ''}><span><b>${esc(s.label)}</b><small>${esc(s.hint)}</small></span></label><button class="smallbtn exp-only" data-only-sec="${s.id}" aria-label="只輸出${esc(s.label)}">只輸出</button></div>`).join('') +
      '</fieldset>' +
      '<fieldset class="exp-set" data-camset><legend>3D 鏡頭</legend>' +
      ec.cams.map((c) => `<label class="exp-row"><input type="checkbox" data-cam="${esc(c.id)}"${camOn(c.id, c.default) ? ' checked' : ''}><span><b>${esc(c.label)}</b></span></label>`).join('') +
      '</fieldset>' +
      `<fieldset class="exp-set"><legend>歌曲（<span data-count></span>）</legend><div class="exp-tools"><button class="smallbtn" data-all="1">全選</button><button class="smallbtn" data-all="0">全不選</button><button class="smallbtn" data-all="cur">只係目前呢首</button></div><div class="exp-songs">` +
      songs.map((s) => `<label class="exp-row"><input type="checkbox" data-song="${esc(s.number)}" checked><span><b>${esc(s.number)}</b> ${esc(s.title)}</span></label>`).join('') +
      '</div></fieldset>';
    foot.innerHTML = '<span class="exp-msg" data-msg></span><button class="smallbtn primary" data-go>產生報告</button>';
    const sync = () => {
      const three = body.querySelector('[data-sec="three"]').checked;
      body.querySelector('[data-camset]').hidden = !three;
      body.querySelector('[data-count]').textContent = body.querySelectorAll('[data-song]:checked').length + ' / ' + songs.length;
      const any = [...body.querySelectorAll('[data-sec]')].some((c) => c.checked) && body.querySelectorAll('[data-song]:checked').length > 0;
      const noCam = three && !body.querySelectorAll('[data-cam]:checked').length;
      foot.querySelector('[data-go]').disabled = !any || noCam;
      foot.querySelector('[data-msg]').textContent = !any ? '報告需揀內容同歌曲；單張 2D SVG 可喺上方獨立下載' : noCam ? '3D 要揀至少一個鏡頭' : '';
    };
    body.addEventListener('change', (e) => {
      if (e.target.matches('[data-only-sec]')) {
        const id = e.target.dataset.onlySec;
        body.querySelectorAll('[data-sec]').forEach((c) => (c.checked = c.dataset.sec === id));
      }
      sync();
    });
    body.querySelector('[data-sec-all]').onclick = () => {
      body.querySelectorAll('[data-sec]').forEach((c) => (c.checked = true));
      sync();
    };
    body.querySelectorAll('[data-only-sec]').forEach((b) => (b.onclick = () => {
      body.querySelectorAll('[data-sec]').forEach((c) => (c.checked = c.dataset.sec === b.dataset.onlySec));
      sync();
    }));
    body.querySelector('[data-download-plan]').onclick = () => {
      try {
        const svg = StageView.exportPlanSvg(ec.svgWidth),
          name = `stage-plan-2D-${fileStamp(new Date())}.svg`,
          a = document.createElement('a');
        a.href = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml;charset=utf-8' }));
        a.download = name;
        document.body.append(a);
        a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        api.toast('已下載 ' + name);
      } catch (e) {
        api.toast('SVG 輸出失敗：' + e.message);
      }
    };
    body.querySelectorAll('[data-all]').forEach((b) => (b.onclick = () => {
      body.querySelectorAll('[data-song]').forEach((c) => (c.checked = b.dataset.all === '1' || (b.dataset.all === 'cur' && c.dataset.song === api.activeNumber())));
      sync();
    }));
    foot.querySelector('[data-go]').onclick = generate;
    sync();
    body.querySelector('input').focus();
  }

  async function generate() {
    const sel = Object.fromEntries([...body.querySelectorAll('[data-sec]')].map((c) => [c.dataset.sec, c.checked]));
    const camIds = sel.three ? [...body.querySelectorAll('[data-cam]:checked')].map((c) => c.dataset.cam) : [];
    const picked = new Set([...body.querySelectorAll('[data-song]:checked')].map((c) => c.dataset.song));
    const my = ++runId, alive = () => my === runId && !closed;
    savePrefs({ sel, cams: Object.fromEntries([...body.querySelectorAll('[data-cam]')].map((c) => [c.dataset.cam, c.checked])) });
    const list = songs.filter((s) => picked.has(s.number));
    body.innerHTML = '<div class="exp-prog"><b data-ptxt>準備中…</b><progress data-pbar max="1" value="0"></progress><small>輸出期間請唔好關閉視窗；3D 出圖會暫時借用 3D 畫面，完成後還原。</small></div>';
    foot.innerHTML = '<span></span><button class="smallbtn" data-cancel>取消</button>';
    foot.querySelector('[data-cancel]').onclick = () => { runId++; showForm(); };
    const prog = (txt, v) => { const t = body.querySelector('[data-ptxt]'), b = body.querySelector('[data-pbar]'); if (t) t.textContent = txt; if (b) b.value = v; };
    const skipped = [];
    const data = StageView.exportData();
    const m = {
      title: ec.title, credit: ec.credit || null, when: stamp(new Date()), sel: { ...sel }, songs: list, perfs: data.performers, data, planTitle: data.plan.title,
      light: null, people: null, imgs: {}, svgs: {}, bg: getComputedStyle(document.body).backgroundColor, skipped,
      camLabels: Object.fromEntries(ec.cams.map((c) => [c.id, c.label])), loops: Object.fromEntries(list.map((s) => [s.number, api.loops(s.number)])),
    };
    const steps = list.length || 1;
    try {
      let h = null;
      if (sel.three || sel.light) {
        prog('載入 3D…', 0);
        h = await api.get3d();
        if (!h) { skipped.push('呢部機唔支援 3D：3D 畫面同燈光設定冇輸出'); sel.three = false; sel.light = false; m.sel = { ...sel }; }
      }
      for (let i = 0; i < list.length && alive(); i++) {
        const s = list[i], cues = data.songs.find((x) => x.number === s.number).cues;
        prog(`${s.number} ${s.title}（${i + 1} / ${steps}）`, i / steps);
        if (sel.stage2d) m.svgs[s.number] = cues.map((_, ci) => StageView.exportSvg(s, ci, ec.svgWidth));
        if (sel.three && h) {
          m.imgs[s.number] = [];
          for (let ci = 0; ci < cues.length && alive(); ci++) m.imgs[s.number].push(await h.capture(StageView.snapshotFor(s, ci), camIds, { ...ec.image, settleSteps: ec.settleSteps, settleDt: ec.settleDt }));
        }
        await new Promise((r) => setTimeout(r, 0));          // 畀畫面更新進度條
      }
      if (!alive()) return;
      if (sel.light && h) { await h.update(StageView.snapshotFor(list[0], 0)); m.light = h.describeLight(); }
      if (sel.people && window.People) m.people = { ...People.export(), styles: { dress: '連身裙', skirt: '上衣＋裙', trousers: '上衣＋褲' } };
      if (sel.people && !m.people) { skipped.push('服裝資料讀唔到，冇輸出'); m.sel.people = false; }
      html = buildReport(m);
      fileName = `flowboard-${fileStamp(new Date())}.html`;
    } catch (e) {
      prog('輸出失敗：' + e.message, 0);
      foot.innerHTML = '<span></span><button class="smallbtn" data-back>返回</button>';
      foot.querySelector('[data-back]').onclick = showForm;
      return;
    } finally {
      StageView.notify();                                     // 3D 畫面還原返用家揀緊嘅歌
    }
    showPreview();
  }

  function showPreview() {
    const mb = (new Blob([html]).size / 1048576).toFixed(1);
    body.innerHTML = '<iframe class="exp-frame" title="報告預覽" sandbox="allow-modals allow-same-origin"></iframe>';
    body.querySelector('iframe').srcdoc = html;
    foot.innerHTML = `<span class="exp-msg">${esc(fileName)} · ${mb} MB</span><button class="smallbtn" data-back>返回修改</button><button class="smallbtn" data-print>列印／存 PDF</button><button class="smallbtn primary" data-dl>下載 HTML</button>`;
    foot.querySelector('[data-back]').onclick = showForm;
    foot.querySelector('[data-print]').onclick = () => { const f = body.querySelector('iframe'); f.contentWindow.focus(); f.contentWindow.print(); };
    foot.querySelector('[data-dl]').onclick = () => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
      a.download = fileName;
      document.body.append(a);
      a.click();
      setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
      api.toast('已下載 ' + fileName);
    };
  }

  showForm();
}
