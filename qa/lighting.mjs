// 燈光檔（.mvr）載入：燈光面板揀 lighting/ 入面嘅檔、揀本機檔、reload 記住、每個場地各自記、錯誤檔。
// 用法：PW_FROM=<有 playwright 嘅目錄> BASE=http://127.0.0.1:9424/index.html node qa/lighting.mjs
import { createRequire } from 'node:module';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(process.env.PW_FROM || import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:9424/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), 'flowboard-lighting-'));
let bad = 0;
const R = (n, ok, x = '') => { if (!ok) bad++; console.log(ok ? 'PASS' : 'FAIL', '|', n, x); };
const b = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const p = await (await b.newContext({ viewport: { width: 1440, height: 900 } })).newPage();
const errs = []; p.on('pageerror', (e) => errs.push(String(e).slice(0, 160)));
const count = () => p.evaluate(() => window.__stage3d.lighting.fixtures.filter((f) => f.group !== 'spot').length);   // 追光（spot）唔計
const status = () => p.locator('[data-mvr="status"]').innerText();
async function open3d() {
  await p.goto(BASE); await p.waitForTimeout(1500);
  await p.click('#viewbar [data-view="stage"]'); await p.locator('[data-mode="3d"]:visible').first().click();
  await p.waitForSelector('#threebox canvas', { timeout: 90000 });
  await p.waitForFunction(() => window.__stage3d && window.__stage3d.lighting && window.__stage3d.lighting.fixtures && window.__stage3d.lighting.fixtures.length, null, { timeout: 120000 });
  await p.click('.threebar [data-light]'); await p.waitForSelector('.lp-mvr:not([hidden])', { timeout: 10000 });
}
await p.goto(BASE); await p.evaluate(() => localStorage.clear());
await open3d();
const opts = await p.$$eval('[data-mvr="sel"] option', (e) => e.map((x) => x.value));
R('燈光面板有「燈光檔」：預設燈位＋ lighting/ 入面 9 個檔', opts.length === 10 && opts[0] === '' && opts.includes('small-club-rig.mvr'), opts.join());
const n0 = await count(); R('預設 76 支燈', n0 === 76, n0);
await p.selectOption('[data-mvr="sel"]', 'small-club-rig.mvr'); await p.waitForTimeout(1500);
R('揀 Small club rig → 3D 換成 12 支燈', (await count()) === 12, await status());
R('狀態列顯示台上支數', /12 支，台上 12 支/.test(await status()), await status());
await p.reload(); await p.waitForTimeout(500);
await open3d();
R('reload 後仍然用 Small club rig', (await count()) === 12 && (await p.inputValue('[data-mvr="sel"]')) === 'small-club-rig.mvr', await count());
await p.click('.threebar [data-light]');
await p.selectOption('.threebar .venuesel', 'club'); await p.waitForTimeout(2500);
await p.click('.threebar [data-light]'); await p.waitForSelector('.lp-mvr:not([hidden])');
R('轉去 club 場地 → 呢個場地仲係預設燈位（各場地各自記）', (await count()) === 76 && (await p.inputValue('[data-mvr="sel"]')) === '', await count());
await p.click('.threebar [data-light]');
await p.selectOption('.threebar .venuesel', 'A'); await p.waitForTimeout(2500);
R('返去黑箱場地 → 又係 12 支', (await count()) === 12, await count());
await p.click('.threebar [data-light]'); await p.waitForSelector('.lp-mvr:not([hidden])');
await p.setInputFiles('[data-mvr="file"]', path.join(ROOT, 'lighting/theatre-rig.mvr')); await p.waitForTimeout(1500);
R('揀本機檔 theatre-rig.mvr → 32 支', (await count()) === 32 && /theatre-rig\.mvr（32 支/.test(await status()), await status());
fs.writeFileSync(path.join(TMP, 'bad.mvr'), 'not a zip at all');
await p.setInputFiles('[data-mvr="file"]', path.join(TMP, 'bad.mvr')); await p.waitForTimeout(800);
R('亂碼檔 → 顯示載入失敗、燈位唔變', /載入失敗/.test(await status()) && (await count()) === 32, await status());
// ---- 燈光師存喺檔案入面嘅 look（scene_objects.mvr 有顏色）----
await p.selectOption('[data-mvr="sel"]', 'scene_objects.mvr'); await p.waitForTimeout(3500);
R('檔案有顏色 → 自動用「檔案原狀」，唔係我哋嘅 preset', (await p.getAttribute('[data-preset="@file"]', 'aria-pressed')) === 'true' && /已用檔案入面嘅顏色同亮度/.test(await status()), await status());
const litFile = await p.evaluate(() => window.__stage3d.lighting.fixtures.filter((f) => f.group !== 'spot' && f.level > 0.05).length);
R('檔案原狀：72 支燈按檔案顏色亮起', litFile >= 60, litFile);
// ---- 測試 look 檔（Capture 燈位 + 每支燈顏色／亮度）----
// 燈光亮度係漸變嘅：慢機器（例如 CI 軟件渲染）每秒幀數少，固定等待會量到中途值。改為等到條件成立先量（最長 90 秒）。
const until = (fn, arg, ms = 90000) => p.waitForFunction(fn, arg, { timeout: ms, polling: 500 }).catch(() => {});
const look = async (file, want) => { await p.selectOption('[data-mvr="sel"]', file); await p.waitForTimeout(1000); await until((w) => { const f = window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot'); const avg = (g) => { const a = f.filter((x) => x.group === g); return a.reduce((t, x) => t + x.level, 0) / (a.length || 1); }; return Math.abs(avg('wash') - w.wash) < 0.03 && Math.abs(avg('back') - w.back) < 0.03 && Math.abs(avg('follow') - w.follow) < 0.03; }, want); return p.evaluate(() => { const f = window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot'); const by = (g) => f.filter((x) => x.group === g); const avg = (a) => a.reduce((s, x) => s + x.level, 0) / (a.length || 1); return { n: f.length, wash: avg(by('wash')), back: avg(by('back')), follow: avg(by('follow')), cols: [...new Set(f.map((x) => x.color))].length, filePreset: document.querySelector('[data-preset="@file"]').getAttribute('aria-pressed') }; }); };
let lk = await look('capture-look-chorus-warm.mvr', { wash: 0.8, back: 0.9, follow: 0.6 });
R('Chorus look：用檔案原狀、76 支燈、面光 0.8／逆光 0.9／追光 0.6', lk.filePreset === 'true' && lk.n === 76 && Math.abs(lk.wash - 0.8) < 0.1 && Math.abs(lk.back - 0.9) < 0.1 && Math.abs(lk.follow - 0.6) < 0.1, JSON.stringify(lk));
lk = await look('capture-look-solo-spot.mvr', { wash: 0.12, back: 0.25, follow: 1 });
R('Solo look：追光全亮、面光／逆光好暗', lk.follow > 0.9 && lk.wash < 0.2 && lk.back < 0.35, JSON.stringify(lk));
lk = await look('capture-look-verse-blue.mvr', { wash: 0.35, back: 0.55, follow: 0 });
R('Verse look：追光熄、其餘暗藍', lk.follow < 0.02 && lk.wash > 0.25 && lk.wash < 0.45, JSON.stringify(lk));
lk = await look('capture-look-finale-rainbow.mvr', { wash: 0.7, back: 0.8, follow: 0.5 });
R('Finale look：每支燈按位置有唔同顏色（>= 15 種）', lk.cols >= 15, JSON.stringify(lk));
// ---- 淨係燈位冇 look（Capture）----
await p.selectOption('[data-mvr="sel"]', 'capture_demo_show.mvr'); await p.waitForTimeout(1000); await until(() => window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot').every((x) => x.level < 0.02));
R('冇顏色嘅檔 → 提示 cue 唔喺 MVR，燈全部熄、燈位點預設唔顯示', /冇顏色／亮度/.test(await status()) && (await p.evaluate(() => { const f = window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot'); return f.every((x) => x.level < 0.02) && f.every((x) => !x.marker); })), await status());
// ---- 燈區：76 支燈分成幾排，成區一齊調 ----
const zrows = await p.$$eval('[data-z]', (e) => e.map((x) => x.dataset.z));
R('燈多嘅 rig → 出「燈區」（每組最多 3 排）', zrows.length >= 4 && zrows.length <= 9 && await p.isVisible('[data-zn="box"]'), zrows.join());
await p.click('[data-z="' + zrows[0] + '"] [data-zn="pick"]'); await p.waitForTimeout(2500);
const zsel = await p.evaluate(() => { const f = window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot'); return { shown: f.filter((x) => x.marker).length, total: f.length }; });
R('撳區名 → 3D 只標出嗰區嘅燈位點（唔係成面點）', zsel.shown > 0 && zsel.shown < zsel.total / 2, JSON.stringify(zsel));
await p.evaluate((id) => { const r = document.querySelector('[data-z="' + id + '"]'); const c = r.querySelector('[data-zk="color"]'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); const l = r.querySelector('[data-zk="level"]'); l.value = '8'; l.dispatchEvent(new Event('input', { bubbles: true })); }, zrows[0]);
await p.waitForTimeout(800); await until((n) => window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot' && x.level > 0.05).length >= n, zsel.shown);
const zlit = await p.evaluate(() => window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot' && x.level > 0.05).map((x) => x.color));
R('調一個區 → 只有嗰區嘅燈亮、係紅色', zlit.length === zsel.shown && zlit.every((c) => c === '#ff0000'), zlit.length + ' lit, ' + zsel.shown + ' in zone');
await p.click('[data-zn="reset"]'); await p.click('[data-z="' + zrows[0] + '"] [data-zn="pick"]'); await p.waitForTimeout(800); await until(() => window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot').every((x) => x.level < 0.05 && !x.marker));
R('全部還原 → 熄返、點隱藏', await p.evaluate(() => window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot').every((x) => x.level < 0.05 && !x.marker)));
// ---- 單支燈 ----
await p.evaluate(() => { document.querySelector('details.lp-fix').open = true; });
const fid = await p.inputValue('[data-fx="sel"]');
await p.evaluate(() => { const c = document.querySelector('[data-fx="color"]'); c.value = '#ff0000'; c.dispatchEvent(new Event('input', { bubbles: true })); const l = document.querySelector('[data-fx="level"]'); l.value = '8'; l.dispatchEvent(new Event('input', { bubbles: true })); });
await p.waitForTimeout(800); await until((id) => window.__stage3d.lighting.fixtures.find((x) => x.id === id).level > 0.5, fid);
const one = await p.evaluate((id) => { const f = window.__stage3d.lighting.fixtures.find((x) => x.id === id); const others = window.__stage3d.lighting.fixtures.filter((x) => x.group !== 'spot' && x.id !== id && x.level > 0.05).length; return { color: f.color, level: f.level, others }; }, fid);
R('單支燈：揀一支改紅色、強度 8 → 只有呢支亮、係紅色', one.color === '#ff0000' && one.level > 0.5 && one.others === 0, JSON.stringify(one));
await p.click('[data-fx="reset"]'); await p.waitForTimeout(800); await until((id) => window.__stage3d.lighting.fixtures.find((x) => x.id === id).level < 0.05, fid);
R('還原呢支 → 熄返', (await p.evaluate((id) => window.__stage3d.lighting.fixtures.find((x) => x.id === id).level, fid)) < 0.05);
await p.click('[data-fx="next"]');
R('▶ 跳去下一支燈', (await p.inputValue('[data-fx="sel"]')) !== fid);
await p.selectOption('[data-mvr="sel"]', ''); await p.waitForTimeout(1200);
R('揀「預設燈位」→ 還原 76 支', (await count()) === 76, await status());
R('冇 JS 錯誤', errs.length === 0, errs.join(' | '));
await b.close();
console.log(bad ? `FAIL ${bad}` : '== ALL PASS ==');
process.exit(bad ? 1 : 0);
