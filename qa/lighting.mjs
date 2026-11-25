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
R('燈光面板有「燈光檔」：預設燈位＋ lighting/ 入面 5 個檔', opts.length === 6 && opts[0] === '' && opts.includes('small-club-rig.mvr'), opts.join());
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
await p.selectOption('[data-mvr="sel"]', ''); await p.waitForTimeout(1200);
R('揀「預設燈位」→ 還原 76 支', (await count()) === 76, await status());
R('冇 JS 錯誤', errs.length === 0, errs.join(' | '));
await b.close();
console.log(bad ? `FAIL ${bad}` : '== ALL PASS ==');
process.exit(bad ? 1 : 0);
