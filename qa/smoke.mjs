// 公開版 smoke test：冇密碼閘、冇外部請求、歌／歌詞／譜／影片／3D／輸出都行得通、手機唔溢出、冇殘留私人字眼。
// 用法：node qa/range-server.py 9424 . 127.0.0.1 之後  node qa/smoke.mjs   （需要 playwright：npm i -D playwright）
import { createRequire } from 'node:module';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const { chromium } = createRequire(process.env.PW_FROM || import.meta.url)('playwright');
const BASE = process.env.BASE || 'http://127.0.0.1:9424/index.html';
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const res = [];
const ok = (n, c, d = '') => { res.push(c); console.log((c ? 'PASS' : 'FAIL') + ' | ' + n + (d ? ' | ' + d : '')); };
const browser = await chromium.launch({ args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist'] });
const origin = new URL(BASE).origin;

async function open(w = 1440, h = 900, mobile = false) {
  const ctx = await browser.newContext({ viewport: { width: w, height: h }, acceptDownloads: true, ...(mobile ? { isMobile: true, hasTouch: true } : {}) });
  const page = await ctx.newPage(); const errs = [], ext = [];
  page.on('pageerror', (e) => errs.push(String(e)));
  page.on('console', (m) => m.type() === 'error' && !/404|Failed to load resource/.test(m.text()) && errs.push(m.text()));
  page.on('request', (r) => { const u = r.url(); if (!u.startsWith(origin) && !u.startsWith('data:') && !u.startsWith('blob:')) ext.push(u); });
  await page.goto(BASE); await page.waitForSelector('#songs .song'); await page.waitForTimeout(800);
  return { page, errs, ext, ctx };
}

// ---- 桌面 ----
const { page: p, errs, ext } = await open();
ok('冇密碼閘', (await p.locator('#gate').count()) === 0 && (await p.locator('#songs .song').count()) > 0);
const titles = await p.locator('#songs .songname').allInnerTexts();
ok('歌單 6 首（來自 songs.json）', titles.length === 6 && titles.includes('Le Dernier Bal'), titles.join(' / '));
ok('標題列由 stage-plans.json 設定', (await p.title()) === 'cuesheet-board — Show Flow' && /CUESHEET/.test(await p.locator('.top .brand').innerText()));

await p.click('.song[data-num="01"]'); await p.waitForTimeout(1200);
const au = await p.evaluate(() => { const a = document.querySelector('#audio'); return { src: a.getAttribute('src') || a.src, rs: a.readyState, d: a.duration }; });
ok('揀歌 → 音訊載入（mp3、時長 > 100s）', /ngo-mou-hok-waai\.mp3$/.test(au.src) && au.d > 100, JSON.stringify(au));

await p.click('[data-view="lyrics"]'); await p.waitForTimeout(400);
ok('歌詞：01 有歌詞（含段落標籤同內容）', /Verse 1/.test(await p.locator('[data-pane="lyrics"]').innerText()) && /mama/i.test(await p.locator('[data-pane="lyrics"]').innerText()));
await p.click('.song[data-num="02"]'); await p.waitForTimeout(500);
ok('歌詞：02 冇歌詞 → 歌詞掣停用', await p.locator('[data-view="lyrics"]').isDisabled());
await p.click('.song[data-num="01"]'); await p.waitForTimeout(500);
if (await p.locator('[data-view="lyrics"]').getAttribute('aria-pressed') === 'true') await p.click('[data-view="lyrics"]');

await p.click('[data-view="charts"]'); await p.waitForTimeout(600);
const ch = await p.evaluate(async () => { const el = document.querySelector('[data-pane="charts"] .docframe'); if (!el) return null; const r = await fetch(el.getAttribute('src')); return { tag: el.tagName, src: el.getAttribute('src'), status: r.status, svg: (await r.text()).startsWith('<svg') }; });
ok('譜：form chart（SVG）載到', ch && ch.status === 200 && ch.svg, JSON.stringify(ch));
await p.click('[data-view="charts"]');

await p.click('[data-view="timeline"]'); await p.waitForTimeout(700);
const seg = await p.locator('.tlpart').count();
ok('時間線：01 有 11 個段落（歌詞段落）', seg === 11, 'segments=' + seg);
await p.click('[data-view="timeline"]');

await p.click('.song[data-num="06"]'); await p.waitForTimeout(600);
const vers = await p.locator('#versions button').allInnerTexts();
ok('版本切換：06 有 Instrumental／Vocals', vers.length === 2 && vers.some((v) => /Vocals/.test(v)), vers.join(','));

await p.click('.song[data-num="01"]'); await p.waitForTimeout(500);
await p.click('#library .clip >> nth=0'); await p.waitForTimeout(2500);
const vp = await p.evaluate(() => { const v = document.querySelector('#vplayer'); return { hidden: v.hidden, src: v.getAttribute('src'), rs: v.readyState }; });
ok('影片 loop：本地 mp4 載入、冇走 Drive', !vp.hidden && /^media\/loops\/.+\.mp4$/.test(vp.src) && vp.rs >= 2, JSON.stringify(vp));

await p.click('#viewbar [data-view="stage"]'); await p.locator('[data-mode="3d"]:visible').first().click();
await p.waitForSelector('#threebox canvas', { timeout: 90000 });
await p.waitForFunction(() => window.__stage3d && window.__stage3d.lighting && window.__stage3d.lighting.fixtures, null, { timeout: 120000 });
ok('3D：canvas 出現', (await p.locator('#threebox canvas').count()) === 1);
const nfix = await p.evaluate(() => window.__stage3d.lighting.fixtures.length);
const plan = await p.evaluate(() => fetch('stage-plans.json').then((r) => r.json()));
ok('燈光：舞台燈位由 MVR（Capture 匯出）匯入，76 支', nfix >= 76 && plan.lighting.mvrImport && plan.lighting.mvrImport.fixtureCount === 76 && plan.lighting.rig.hangAt !== 'screenTop', 'fixtures=' + nfix + ' ' + JSON.stringify(plan.lighting.mvrImport || {}).slice(0, 120));
await p.click('.threebar [data-light]'); await p.click('[data-preset="warm"]'); await p.waitForTimeout(2500);
const lit = await p.evaluate(() => window.__stage3d.lighting.fixtures.filter((f) => f.level > 0.05).length);
ok('燈光：揀「暖色 Jazz」→ 多支燈亮起', lit >= 20, 'lit=' + lit);
await p.click('#viewbar [data-view="stage"]');

await p.click('#export'); await p.waitForSelector('.exp-card');
await p.click('[data-all="0"]'); await p.check('.exp-card [data-song="01"]');
for (const id of ['order', 'matrix', 'stage2d', 'three', 'timeline', 'light', 'people']) await p.locator(`[data-sec="${id}"]`).setChecked(['order', 'stage2d', 'timeline'].includes(id));
await p.click('[data-go]'); await p.waitForSelector('iframe.exp-frame', { timeout: 120000 });
const rep = await p.locator('iframe.exp-frame').evaluate((f) => f.srcdoc);
ok('輸出：報告有歌名、段落、2D 圖，冇 script、冇外部連結', /我冇學壞/.test(rep) && /Verse 1/.test(rep) && /<svg/.test(rep) && !/<script/i.test(rep) && !/https?:\/\//.test(rep.replace(/xmlns="http:\/\/www\.w3\.org\/[^"]+"/g, '')));
await p.click('.exp-head [data-x]');

ok('冇外部網絡請求（淨係同源）', ext.length === 0, ext.slice(0, 3).join(' | '));

// ---- 內嵌版本（Suno）：攔截 iframe 目標，唔真係連外網 ----
await p.route(/^https:\/\/suno\.com\/embed\/.*/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fake embed</title><button>play</button>' }));
await p.click('.song[data-num="01"]'); await p.waitForTimeout(500);
const chips01 = await p.$$eval('#versions .vchip', (e) => e.map((x) => x.textContent));
ok('內嵌版本：01 有 suno chip', chips01.includes('suno'), chips01.join(','));
await p.click('#versions .vchip:has-text("suno")'); await p.waitForTimeout(500);
const ifr = await p.$$eval('iframe.embedframe', (e) => e.map((x) => ({ src: x.src, sandbox: x.getAttribute('sandbox') })));
ok('內嵌版本：揀 suno → iframe 指向 suno.com/embed、有 sandbox，本地音訊暫停', ifr.length === 1 && /^https:\/\/suno\.com\/embed\/[0-9a-f-]{36}$/.test(ifr[0].src) && !!ifr[0].sandbox && await p.$eval('#audio', (a) => a.paused));
await p.click('#versions .vchip >> nth=0'); await p.waitForTimeout(400);
ok('內嵌版本：轉返主版本 → iframe 移除', (await p.$$('iframe.embedframe')).length === 0);
await p.click('#songsBtn'); await p.waitForTimeout(300);
ok('歌單掣：收埋左邊歌單', await p.evaluate(() => document.querySelector('#app').dataset.songs === 'off'));
await p.click('#songsBtn'); await p.waitForTimeout(300);
ok('冇 console／page 錯誤', errs.length === 0, errs.join(' | ').slice(0, 300));

// ---- 手機 390 ----
const { page: m, errs: me } = await open(390, 844, true);
const mg = await m.evaluate(() => ({ sw: document.documentElement.scrollWidth, maxR: Math.round(Math.max(...[...document.querySelectorAll('.top .tools button, .top .tools a:not([hidden])')].map((b) => b.getBoundingClientRect().right))) }));
ok('手機：頁面冇橫向溢出、標題列掣喺畫面內', mg.sw <= 390 && mg.maxR <= 390, JSON.stringify(mg));
ok('手機：冇 console／page 錯誤', me.length === 0, me.join(' | ').slice(0, 300));

// ---- 靜態掃描：公開 repo 唔准有私人字眼 ----
const BAD = /jace|drip|westk|freespace|drive\.google|西九|netlify|\.env|passcode/i;
const SKIP = new Set(['node_modules', 'vendor', 'media', 'logs', '.git', 'qa']);
const hits = [];
(function walk(dir) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(e.name)) continue;
    const f = path.join(dir, e.name);
    if (e.isDirectory()) walk(f);
    else if (/\.(js|mjs|html|css|json|md|py|svg|txt)$/i.test(e.name)) {
      const t = fs.readFileSync(f, 'utf8'); const mm = t.match(BAD);
      if (mm) hits.push(path.relative(ROOT, f) + ':' + mm[0]);
    }
  }
})(ROOT);
ok('靜態掃描：冇私人字眼（JACE／Drip／WestK／Freespace／Drive／密碼）', hits.length === 0, hits.slice(0, 6).join(' | '));
ok('靜態掃描：index.html 冇密碼輸入', !/type="password"/i.test(fs.readFileSync(path.join(ROOT, 'index.html'), 'utf8')));

await browser.close();
const pass = res.filter(Boolean).length;
console.log(pass === res.length ? `== ALL PASS (${res.length}) ==` : `== FAIL ${res.length - pass}/${res.length} ==`);
process.exit(pass === res.length ? 0 : 1);
