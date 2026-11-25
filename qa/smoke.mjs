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
ok('歌單 10 首（6 首有音訊 ＋ 4 首 Suno／Spotify，來自 songs.json）', titles.length === 10 && titles.some((x) => x.startsWith('Le Dernier Bal')), titles.join(' / '));
const badges = await p.$$eval('#songs .srcbadge', (e) => e.map((x) => x.textContent));
ok('歌單：Suno／Spotify 歌有細標記（Suno ×2、Spotify ×2），本地歌冇', badges.filter((x) => x === 'Suno').length === 2 && badges.filter((x) => x === 'Spotify').length === 2 && badges.length === 4, badges.join(','));
ok('標題列由 stage-plans.json 設定', (await p.title()) === 'Flowboard' && /FLOWBOARD/.test(await p.locator('.top .brand').innerText()));

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
const venues = await p.$$eval('.threebar .venuesel option', (e) => e.map((x) => x.value));
ok('場地選單：3D 工具列有 4 個場地（黑箱／club／hall／open）', venues.join() === 'A,club,hall,open', venues.join());
const fx0 = await p.evaluate(() => window.__stage3d.lighting.fixtures[0].x);
await p.selectOption('.threebar .venuesel', 'club'); await p.waitForTimeout(2500);
const fx1 = await p.evaluate(() => window.__stage3d.lighting.fixtures[0].x);
ok('場地選單：揀 club → 舞台圖換咗、燈位跟住縮', (await p.evaluate(() => window.StageView.planId())) === 'club' && Math.abs(fx1) < Math.abs(fx0) * 0.6, fx0 + ' -> ' + fx1);
await p.selectOption('.threebar .venuesel', 'open'); await p.waitForTimeout(2000);
ok('場地選單：揀 open（冇牆）→ 仍然有 76 支燈、冇錯誤', (await p.evaluate(() => window.__stage3d.lighting.fixtures.length)) >= 76 && errs.length === 0, errs.join(' | ').slice(0, 200));
await p.selectOption('.threebar .venuesel', 'A'); await p.waitForTimeout(1500);
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
await p.route(/^https:\/\/open\.spotify\.com\/embed\/.*/, (r) => r.fulfill({ contentType: 'text/html', body: '<!doctype html><title>fake embed</title><button>play</button>' }));
const SPOT = 'https://open.spotify.com/embed/track/';
await p.click('.song[data-num="T3"]'); await p.waitForTimeout(500);
const ifs3 = await p.$$eval('iframe.embedframe', (e) => e.map((x) => ({ src: x.src, sandbox: x.getAttribute('sandbox') })));
ok('歌單 Spotify 歌：撳 T3 → iframe 指向 open.spotify.com/embed/track、有 sandbox、本地音訊暫停、冇版本 chip', ifs3.length === 1 && ifs3[0].src === SPOT + '4Vkk3iD1VrENHJEACNddvt' && !!ifs3[0].sandbox && await p.$eval('#audio', (a) => a.paused) && await p.$eval('#versions', (v) => v.hidden), JSON.stringify(ifs3));
await p.click('.song[data-num="T1"]'); await p.waitForTimeout(500);
const ifs1 = await p.$$eval('iframe.embedframe', (e) => e.map((x) => x.src));
ok('歌單 Suno 歌：撳 T1 → 只剩一個 iframe 指向 suno.com/embed', ifs1.length === 1 && /^https:\/\/suno\.com\/embed\/[0-9a-f-]{36}$/.test(ifs1[0]), ifs1.join());
ok('歌單 Suno／Spotify 歌：我哋自己嗰條播放列收埋（淨係用內嵌播放器）', await p.locator('#player').isHidden() && await p.locator('#embedRow').isVisible());
await p.evaluate(() => Object.defineProperty(window, 'isSecureContext', { value: false, configurable: true }));
await p.click('.song[data-num="T2"]'); await p.waitForTimeout(400); await p.click('.song[data-num="T1"]'); await p.waitForTimeout(400);
ok('http 頁面開 Suno 歌 → 提示要 https', /https/.test(await p.locator('#embedRow .embedhint').innerText()));
await p.evaluate(() => Object.defineProperty(window, 'isSecureContext', { value: true, configurable: true }));
await p.click('.song[data-num="T3"]'); await p.waitForTimeout(400);
const sb3 = await p.$eval('iframe.embedframe', (f) => f.getAttribute('sandbox'));
ok('內嵌 sandbox 容許登入視窗脫離（Spotify 登入）', /allow-popups-to-escape-sandbox/.test(sb3) && /allow-forms/.test(sb3), sb3);
await p.click('.song[data-num="01"]'); await p.waitForTimeout(500);
ok('轉返本地歌 → 內嵌 iframe 移除、音訊有 src、播放列返嚟', (await p.$$('iframe.embedframe')).length === 0 && !!(await p.$eval('#audio', (a) => a.getAttribute('src'))) && await p.locator('#player').isVisible());
// 加歌：貼連結
await p.click('#trackAdd'); await p.fill('#trackForm [name=url]', 'https://example.com/x'); await p.click('#trackForm [type=submit]'); await p.waitForTimeout(300);
ok('加歌：唔認得嘅連結 → 顯示錯誤、歌單唔變', /連結唔啱/.test(await p.locator('.trackerr').innerText()) && (await p.locator('#songs .song').count()) === 10);
await p.fill('#trackForm [name=url]', 'https://open.spotify.com/track/0K9rIsZfdlzAoOEWyeFQYM?si=abc123'); await p.fill('#trackForm [name=title]', '我嘅測試歌'); await p.click('#trackForm [type=submit]'); await p.waitForTimeout(600);
const added = await p.$$eval('#songs .song.selected', (e) => e.map((x) => x.textContent));
ok('加歌：貼 Spotify 連結 → 歌單多一行、自動揀咗、有 Spotify 標記、iframe 指向該曲', (await p.locator('#songs .song').count()) === 11 && /我嘅測試歌/.test(added.join()) && /Spotify/.test(added.join()) && (await p.$$eval('iframe.embedframe', (e) => e.map((x) => x.src))).join() === SPOT + '0K9rIsZfdlzAoOEWyeFQYM', added.join());
await p.reload(); await p.waitForSelector('#songs .song'); await p.waitForTimeout(800);
ok('加歌：reload 後仍然喺歌單（存喺瀏覽器）', (await p.locator('#songs .song').count()) === 11 && (await p.locator('#songs .songname', { hasText: '我嘅測試歌' }).count()) === 1);
await p.locator('#songs .song', { hasText: '我嘅測試歌' }).locator('[data-act="del"]').click(); await p.waitForTimeout(500);
ok('加歌：撳 ✕ 移除自己加嘅歌 → 回到 10 首；長期歌冇 ✕', (await p.locator('#songs .song').count()) === 10 && (await p.locator('#songs [data-act="del"]').count()) === 0);
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
      const t = fs.readFileSync(f, 'utf8').replace(/https:\/\/cuesheet-board-demo\.netlify\.app\/?/g, ''); const mm = t.match(BAD);   // README 自己嘅示範站連結唔算私人字眼
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
