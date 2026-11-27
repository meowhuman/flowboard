// 樂手面向：每首歌每個段落，每個企／坐住嘅樂手面孔都要朝住佢彈緊嗰件器材（共用樂手）或者朝 item.rot 方向（企喺器材後面嘅樂手）。
// 用法：PW_FROM=<有 playwright 嘅目錄> BASE=http://127.0.0.1:9424/index.html node qa/figures.mjs
import { createRequire } from 'node:module';
const { chromium } = createRequire(process.env.PW_FROM || import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:9424/index.html';
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
await p.goto(BASE); await p.evaluate(() => localStorage.clear()); await p.reload(); await p.waitForTimeout(1500);
await p.click('#viewbar [data-view="stage"]'); await p.locator('[data-mode="3d"]:visible').first().click();
await p.waitForSelector('#threebox canvas', { timeout: 90000 });
await p.waitForFunction(() => window.__stage3d && window.__stage3d.figures && Object.keys(window.__stage3d.figures).length, null, { timeout: 120000 });
await p.evaluate(() => window.StageView.setMode('both')); await p.waitForTimeout(1500);
const songs = await p.evaluate(() => fetch('songs.json').then((r) => r.json()));
let bad = 0, n = 0;
for (const s of songs.filter((x) => /^0\d$/.test(x.number))) {
  await p.click(`.song[data-num="${s.number}"]`); await p.waitForTimeout(800);
  await p.evaluate(() => document.querySelectorAll('audio,video').forEach((a) => { a.pause(); a.muted = true; }));   // 唔暫停嘅話，播放跟隨會將段落彈返去 0:00，掃唔到後面嘅段落
  const parts = await p.locator('.partbar [data-part]').count();
  for (let i = 0; i < parts; i++) {
    const pname = (await p.locator(`.partbar [data-part="${i}"]`).innerText()).split(' · ')[0];
    await p.locator(`.partbar [data-part="${i}"]`).click();
    await p.waitForFunction((nm) => document.querySelector('#threebox').innerText.trim().endsWith(nm), pname, { timeout: 60000 }).catch(() => { console.log('WARN 3D 未跟上段落', s.number, i, pname); });
    await p.waitForTimeout(1500);
    const r = await p.evaluate(({ num, i }) => {
      const q = window.__stage3d._qa, T = q.THREE, st = window.__stage3d, out = [];
      const snap = window.StageView.snapshotFor(window.__songs ? window.__songs[num] : { number: num }, i);
      const items = Object.fromEntries(snap.items.map((it) => [it.id, it]));
      for (const f of q.figs) {
        if (!f.root.visible) continue; let vis = true; f.root.traverseAncestors((a) => { if (!a.visible) vis = false; }); if (!vis) continue;
        const c = new T.Vector3(); f.root.getWorldPosition(c);
        const wd = new T.Vector3(); f.root.updateMatrixWorld(true); f.root.getWorldDirection(wd); let fx = -wd.x, fz = -wd.z; const L = Math.hypot(fx, fz) || 1; fx /= L; fz /= L;
        const it = items[f.itemId] || {}; const pl = Object.values(st.players || {}).find((x) => x.at && (x.seated || x.standing) && f.itemId && items[x.at] && items[x.at].player === it.player && it.player);
        let tx, tz, kind;
        if (it.player && pl) { const t = items[pl.at]; tx = t.x - c.x; tz = t.y - c.z; kind = 'player→' + pl.at; }
        else { tx = Math.sin((it.rot || 0) * Math.PI / 180); tz = Math.cos((it.rot || 0) * Math.PI / 180); kind = 'rot' + (it.rot || 0) + '→front'; }
        const tl = Math.hypot(tx, tz) || 1;
        out.push({ id: f.itemId, type: it.type, kind, dot: +((fx * tx + fz * tz) / tl).toFixed(2) });
      }
      return out;
    }, { num: s.number, i });
    const orphan = await p.evaluate(() => {              // 手臂／手掌可見，但同一件器材冇樂手可見＝浮空嘅波
      const q = window.__stage3d._qa, vis = (o) => { let v = true; for (let a = o; a; a = a.parent) if (!a.visible) v = false; return v; };
      let s = q.figs[0].root; while (s.parent) s = s.parent;
      let bad = 0;
      s.traverse((o) => {
        if (!(o.userData && o.userData.heldArm) || !vis(o)) return;
        let g = o; while (g.parent && !g.userData.type) g = g.parent;
        if (!q.figs.some((f) => vis(f.root) && (() => { for (let a = f.root; a; a = a.parent) if (a === g) return true; return false; })())) bad++;
      });
      return bad;
    });
    if (orphan) { bad++; console.log('BAD', s.number, 'part', i, '手臂浮空 ×' + orphan); }
    for (const x of r) { n++; if (x.dot < 0.3) { bad++; console.log('BAD', s.number, 'part', i, JSON.stringify(x)); } }
  }
}
console.log(bad ? 'FAIL' : 'PASS', '| 樂手面向（' + n + ' 個樂手狀態，朝錯 ' + bad + '）');
await b.close();
process.exit(bad ? 1 : 0);
