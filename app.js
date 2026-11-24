(() => {
  boot();
  async function boot() {
    if (window.ready) return;
    window.ready = true;
    const songs = await fetch('songs.json').then((r) => {
      if (!r.ok) throw Error('songs.json ' + r.status);
      return r.json();
    });
    const inventory = await fetch('source-materials/drive-video-inventory.json').then((r) => {
      if (!r.ok) throw Error('影片清單 ' + r.status);
      return r.json();
    });
    const videos = inventory.videos.map((v) => ({
      ...v,
      matchType: v.matchType || 'section-only',
    }));
    const defaultOrder = songs.map((s) => s.number),
      key = 'cuesheet-board-drive-v5';
    let state;
    try {
      state = JSON.parse(localStorage.getItem(key));
    } catch {}
    if (!state || !Array.isArray(state.order) || state.order.length !== songs.length)
      state = { order: [...defaultOrder], clips: {} };
    for (const s of songs) if (!Array.isArray(state.clips[s.number])) state.clips[s.number] = [];
    if (!localStorage.getItem(key)) state.clips = createDefaultClips();
    const b64u = {
      enc: (o) => {
        const bytes = new TextEncoder().encode(JSON.stringify(o));
        let bin = '';
        bytes.forEach((c) => (bin += String.fromCharCode(c)));
        return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      },
      dec: (s) => {
        const bin = atob(s.replace(/-/g, '+').replace(/_/g, '/'));
        return JSON.parse(new TextDecoder().decode(Uint8Array.from(bin, (c) => c.charCodeAt(0))));
      },
    };
    function toast(msg) {
      const el = document.createElement('div');
      el.className = 'toast';
      el.setAttribute('role', 'status');
      el.textContent = msg;
      document.body.append(el);
      setTimeout(() => el.remove(), 4000);
    }
    function validCfg(c) {
      if (!c || !Array.isArray(c.order) || typeof c.clips !== 'object' || !c.clips) return false;
      if ([...c.order].sort().join() !== [...defaultOrder].sort().join()) return false;
      return Object.entries(c.clips).every(
        ([n, ids]) =>
          defaultOrder.includes(n) &&
          Array.isArray(ids) &&
          ids.every((id) => videos.some((v) => v.fileId === id)),
      );
    }
    // 短連結 #s=o=<32 位歌序>;03:1cQr.1RMZ;04:-  只寫同預設唔同嘅部分；舊 #cfg=（base64）仍可讀
    const isShareHash = (h) => h.startsWith('#s=') || h.startsWith('#cfg=');
    function shortDecode(body) {
      const out = { order: [...defaultOrder], clips: createDefaultClips() };
      for (const part of body.split(';').filter(Boolean)) {
        if (part.startsWith('o=')) {
          out.order = part.slice(2).match(/\d\d[a-z]?/g) || [];
          continue;
        }
        const m = /^(\d\d[a-z]?):(-|[A-Za-z0-9_-]{4}(?:\.[A-Za-z0-9_-]{4})*)$/.exec(part);
        if (!m) return null;
        const ids = m[2] === '-' ? [] : m[2].split('.').map((p) => videos.find((v) => v.fileId.startsWith(p)));
        if (ids.some((v) => !v)) return null;
        out.clips[m[1]] = ids.map((v) => v.fileId);
      }
      return out;
    }
    window.addEventListener('hashchange', () => {
      if (isShareHash(location.hash) || /^#(show=|lx)/.test(location.hash)) location.reload();
    });
    const cfgMatch = isShareHash(location.hash) ? [null, location.hash] : null;
    if (cfgMatch) {
      let incoming = null;
      try {
        incoming = cfgMatch[1].startsWith('#s=')
          ? shortDecode(cfgMatch[1].slice(3))
          : b64u.dec(cfgMatch[1].slice(5));
      } catch {}
      if (!validCfg(incoming)) {
        toast('分享連結無效，已使用本機配置。');
      } else {
        const had = localStorage.getItem(key);
        const clips = Object.fromEntries(defaultOrder.map((n) => [n, incoming.clips[n] || []]));
        const differs = !had || JSON.stringify(state.order) !== JSON.stringify(incoming.order) ||
          JSON.stringify(state.clips) !== JSON.stringify(clips);
        if (!differs || !had || confirm('套用分享嘅排序同配片？會取代你本機嘅版本。')) {
          state = { order: incoming.order, clips };
          localStorage.setItem(key, JSON.stringify(state));
          toast('已套用分享嘅排序同配片。');
        }
      }
      history.replaceState(null, '', location.pathname + location.search);
    }
    let active = state.order[0],
      selectedVideo = null,
      dragSong = null,
      dragClip = null,
      previewTimer = null,
      previewGeneration = 0,
      previewTimedOut = false;
    const audio = document.querySelector('#audio'),
      video = document.querySelector('#video'),
      vplayer = document.querySelector('#vplayer'),
      songRoot = document.querySelector('#songs'),
      lib = document.querySelector('#library');
    const save = () => localStorage.setItem(key, JSON.stringify(state)),
      song = (n) => songs.find((s) => s.number === n),
      clip = (id) => videos.find((v) => v.fileId === id),
      exactIds = (n) =>
        videos
          .filter((v) => v.songNumbers.includes(n) && v.matchType === 'exact-title')
          .map((v) => v.fileId);
    function label(v) {
      return v.matchType === 'exact-title'
        ? 'EXACT'
        : v.matchType === 'visual-name-candidate'
          ? 'CANDIDATE'
          : 'SECTION';
    }
    function songTitle(n) {
      const s = song(n);
      return s ? s.title : n;
    }
    function clipTitle(v) {
      if (v.matchType === 'exact-title')
        return { main: songTitle(v.songNumbers[0]), pill: 'exact', note: '' };
      if (v.matchType === 'visual-name-candidate')
        return { main: songTitle(v.songNumbers[0]), pill: 'candidate', note: '待確認' };
      const scope =
        v.songNumbers.length > 1 ? ' 可用於 ' + v.songNumbers.join('·') : ' 區段';
      return { main: v.folder + scope, pill: 'section', note: '' };
    }
    function renderSongs() {
      songRoot.innerHTML = '';
      for (const [i, n] of state.order.entries()) {
        const s = song(n),
          refs = state.clips[n],
          row = document.createElement('article');
        row.className =
          'song' + (active === n ? ' selected' : '') + (defaultIds(n).length ? '' : ' no-ref');
        row.draggable = true;
        row.tabIndex = 0;
        row.setAttribute('aria-label', s.title + '歌曲列；按 Enter 選擇');
        row.dataset.num = n;
        const match = refs.length
          ? refs.length + ' loop'
          : exactIds(n).length
            ? exactIds(n).length + ' exact'
            : '無 loop';
        row.innerHTML = `<span class="num">${n}</span><div><div class="songname">${esc(s.title)}</div><div class="songdesc">${esc(match)} · ${esc(s.section)}</div></div><div class="songbuttons"><button data-act="up" aria-label="${esc(s.title)}上移">↑</button><button data-act="down" aria-label="${esc(s.title)}下移">↓</button></div>`;
        row.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
            e.preventDefault();
            setActive(n);
          }
        });
        row.addEventListener('click', (e) => {
          const a = e.target.dataset.act;
          if (a === 'up' || a === 'down') {
            const j = i + (a === 'up' ? -1 : 1);
            if (j >= 0 && j < state.order.length) {
              [state.order[i], state.order[j]] = [state.order[j], state.order[i]];
              save();
              renderSongs();
            }
          } else setActive(n);
        });
        row.addEventListener('dragstart', (e) => {
          dragSong = n;
          e.dataTransfer.setData('text/song', n);
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => row.classList.remove('dragging'));
        row.addEventListener('dragover', (e) => {
          e.preventDefault();
          row.classList.add('over');
        });
        row.addEventListener('dragleave', () => row.classList.remove('over'));
        row.addEventListener('drop', (e) => {
          e.preventDefault();
          row.classList.remove('over');
          const dragged = e.dataTransfer.getData('text/clip');
          if (dragged) {
            assign(n, dragged);
            return;
          }
          const from = state.order.indexOf(dragSong),
            to = state.order.indexOf(n);
          if (from >= 0 && to >= 0 && from !== to) {
            state.order.splice(to, 0, state.order.splice(from, 1)[0]);
            save();
            renderSongs();
          }
        });
        songRoot.append(row);
      }
      const withLoop = state.order.filter((n) => (state.clips[n] || []).length).length;
      document.querySelector('#loopCount').textContent =
        withLoop + ' / ' + songs.length + ' 首已有 loop';
      document.querySelector('.panelhead h2').textContent = songs.length + ' 首歌曲';
    }
    function stopPreview(message = '已停止並卸載 Drive 預覽。') {
      previewGeneration++;
      selectedVideo = null;
      previewTimedOut = false;
      if (previewTimer) clearTimeout(previewTimer);
      previewTimer = null;
      video.removeAttribute('src');
      video.hidden = false;
      vplayer.pause();
      vplayer.removeAttribute('src');
      vplayer.hidden = true;
      document.querySelector('#status').textContent = message;
    }
    function setActive(n) {
      active = n;
      stopPreview('已切換歌曲；舊影片預覽已卸載。');
      renderSongs();
      renderLibrary();
      renderAssigned();
      document.querySelector('#nowTitle').textContent = n + ' · ' + song(n).title;
      document.querySelector('#npTitle').textContent = n + ' · ' + song(n).title;
      document.querySelector('#npSub').textContent = song(n).credit || '歌曲排練音訊';
      document.querySelector('#nowMeta').textContent = song(n).credit + ' · ' + song(n).section;
      const sel = songRoot.querySelector('.song.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      const s = song(n);
      renderVersions(s);
      renderPanes(s);
      // 呢首歌有配 loop：預設自動播第一條（靜音，投影幕／影片窗即刻有畫面）
      const firstLoop = (state.clips[n] || []).map(clip).find(Boolean);
      if (firstLoop && (view.video || view.three)) playClip(firstLoop);
    }
    // 顯示內容：影片／舞台／歌詞／譜 可以自由組合開關，素材庫可收埋令中欄更闊
    const VIEW_KEY = 'cuesheet-board-view-v1';
    const view = { video: true, stage: false, timeline: false, three: false, lyrics: false, charts: false, library: true, dock: 'full' };
    try {
      Object.assign(view, JSON.parse(localStorage.getItem(VIEW_KEY)) || {});
    } catch {}
    const lx = /^#lx\b/.test(location.hash); // 燈光師檢視：只讀，舞台＋時間線
    if (lx) {
      Object.assign(view, { video: false, stage: true, timeline: true, lyrics: false, charts: false, library: false, dock: 'min' });
      document.body.dataset.lx = '1';
      StageView.setReadOnly(true);
    }
    // #show=stage,three,timeline,video,lyrics,charts,library：開連結即係呢個組合（唔會覆蓋你存低嘅設定）
    const showM = /^#show=([a-z,]+)/.exec(location.hash);
    if (showM) {
      const want = showM[1].split(',');
      for (const k of Object.keys(view)) if (typeof view[k] === 'boolean') view[k] = want.includes(k);
      view.dock = want.includes('min') ? 'min' : 'full';
    }
    const saveView = () => {
      if (lx || showM) return;
      try {
        localStorage.setItem(VIEW_KEY, JSON.stringify(view));
      } catch {}
    };
    let lyricLang = null,
      chartKey = null,
      videoSuspended = false;
    const PANES = { video: '影片', stage: '舞台', timeline: '時間線', three: '3D', lyrics: '歌詞', charts: '譜' };
    const LANG = { ko: '한국어', zh: '中文', en: 'English', ja: '日本語' },
      CHART = { form: 'Form', lead: 'Lead', full: 'Full', vn1: 'Vn 1', vn2: 'Vn 2', va: 'Va', vc: 'Vc' };
    const lyricsOf = (s) =>
        Object.entries(s.lyrics || {}).filter(([, v]) => typeof v === 'string' && v.trim()),
      chartsOf = (s) => Object.entries(s.charts || {}).filter(([, v]) => typeof v === 'string' && v);
    function chip(text, pressed, onclick) {
      const b = document.createElement('button');
      b.className = 'vchip';
      b.textContent = text;
      b.setAttribute('aria-pressed', String(pressed));
      b.onclick = onclick;
      return b;
    }
    function renderPanes(s, keepVideo) {
      const has = {
        video: true,
        stage: !!(window.StageView && StageView.available()),
        timeline: !!(window.StageView && StageView.available()),
        three: !!(window.StageView && StageView.available()) && !three3dFailed,
        lyrics: lyricsOf(s).length > 0,
        charts: chartsOf(s).length > 0,
      };
      let shown = Object.keys(PANES).filter((k) => has[k] && view[k]);
      // 譜唔入格仔：喺中欄下面獨立一層，可拖高低，聽歌同睇譜可以同時
      const showScore = shown.includes('charts');
      shown = shown.filter((k) => k !== 'charts');
      if (!shown.length) shown = ['video']; // 全部收埋（或舞台資料未載入）時顯示影片，但唔改用戶嘅設定
      document.querySelectorAll('#viewbar [data-view]').forEach((b) => {
        const k = b.dataset.view;
        if (k === 'library') {
          b.setAttribute('aria-pressed', String(view.library));
          b.onclick = () => {
            view.library = !view.library;
            saveView();
            renderPanes(song(active));
          };
          return;
        }
        b.disabled = !has[k];
        b.textContent = PANES[k] + (has[k] ? '' : '（未上載）');
        b.setAttribute('aria-pressed', String(k === 'charts' ? showScore : shown.includes(k)));
        b.onclick = () => {
          view[k] = !view[k];
          saveView();
          renderPanes(song(active));
        };
      });
      const panels = document.querySelector('#panels');
      panels.dataset.count = String(shown.length);
      panels.dataset.only = shown.length === 1 ? shown[0] : '';
      document.querySelector('#app').dataset.library = view.library ? 'on' : 'off';
      document.querySelectorAll('#panels .pane').forEach((p) => {
        p.hidden = !shown.includes(p.dataset.pane);
        p.dataset.first = String(p.dataset.pane === shown[0]);
      });
      // 影片收埋：暫停並卸載（唔食資源）；再開返就由選中嘅 clip 重新載入。3D 開住時影片要繼續播（投影幕要用）
      const videoNeeded = shown.includes('video') || shown.includes('three');
      if (!videoNeeded) {
        if (!videoSuspended) {
          videoSuspended = true;
          vplayer.pause();
          video.removeAttribute('src');
        }
      } else if (videoSuspended) {
        videoSuspended = false;
        if (!keepVideo && selectedVideo && clip(selectedVideo)) playClip(clip(selectedVideo));
      }
      if (shown.includes('stage')) StageView.render();
      if (shown.includes('timeline')) StageView.renderTimeline();
      if (shown.includes('three')) show3d();
      else if (stage3d) stage3d.setVisible(false);
      const lp = document.querySelector('[data-pane="lyrics"]'),
        cp = document.querySelector('#scorebody');
      document.querySelector('#scoredock').hidden = !showScore;
      lp.innerHTML = '';
      cp.innerHTML = '';
      if (shown.includes('lyrics')) {
        const ly = lyricsOf(s);
        if (!ly.some(([k]) => k === lyricLang)) lyricLang = ly[0][0];
        if (ly.length > 1) {
          const bar = document.createElement('div');
          bar.className = 'docbar';
          ly.forEach(([k]) =>
            bar.append(chip(LANG[k] || k, k === lyricLang, () => { lyricLang = k; renderPanes(s); })),
          );
          lp.append(bar);
        }
        const box = document.createElement('div');
        box.className = 'lyrics';
        Object.fromEntries(ly)[lyricLang].split(/\n\s*\n/).forEach((para) => {
          const p = document.createElement('p');
          p.textContent = para.trim();
          box.append(p);
        });
        lp.append(box);
      }
      if (showScore) {
        const ch = chartsOf(s);
        if (!ch.some(([k]) => k === chartKey)) chartKey = ch[0][0];
        const path = Object.fromEntries(ch)[chartKey],
          bar = document.createElement('div');
        bar.className = 'docbar';
        ch.forEach(([k]) =>
          bar.append(chip(CHART[k] || k, k === chartKey, () => { chartKey = k; renderPanes(s); })),
        );
        const a = document.createElement('a');
        a.href = path;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '新分頁開啟 ↗';
        const x = document.createElement('button');
        x.className = 'vchip scoreclose';
        x.textContent = '×';
        x.title = x.ariaLabel = '收埋譜';
        x.onclick = () => {
          view.charts = false;
          saveView();
          renderPanes(s);
        };
        bar.append(a, x);
        cp.append(bar);
        const isImg = /\.(png|jpe?g|webp|gif)$/i.test(path),
          el = document.createElement(isImg ? 'img' : 'iframe');
        el.className = 'docframe';
        el.title = (CHART[chartKey] || chartKey) + ' 譜';
        el.alt = el.title;
        el.src = isImg ? path : path + '#zoom=page-width';
        cp.append(el);
      }
    }
    // 譜面板高度：拖動手柄（或手柄上按 ↑↓）調整，記住喺 localStorage
    {
      const dock = document.querySelector('#scoredock'),
        handle = document.querySelector('#scorehandle'),
        SKEY = 'cuesheet-board-score-h-v1';
      let h = 0;
      try {
        h = +localStorage.getItem(SKEY) || 0;
      } catch {}
      const limit = () => {
        const c = dock.parentElement;
        return Math.max(160, (c ? c.clientHeight : innerHeight) - 260);
      };
      const setH = (v, save) => {
        h = Math.round(Math.min(Math.max(v, 140), limit()));
        dock.style.setProperty('--score-h', h + 'px');
        if (save)
          try {
            localStorage.setItem(SKEY, String(h));
          } catch {}
      };
      if (h) setH(h, false);
      let drag = null;
      handle.addEventListener('pointerdown', (e) => {
        drag = { y: e.clientY, h: dock.getBoundingClientRect().height };
        handle.setPointerCapture(e.pointerId);
        document.body.classList.add('score-resizing');
      });
      handle.addEventListener('pointermove', (e) => {
        if (drag) setH(drag.h + (drag.y - e.clientY), false);
      });
      const end = () => {
        if (!drag) return;
        drag = null;
        document.body.classList.remove('score-resizing');
        setH(h, true);
      };
      handle.addEventListener('pointerup', end);
      handle.addEventListener('pointercancel', end);
      handle.addEventListener('keydown', (e) => {
        if (e.key !== 'ArrowUp' && e.key !== 'ArrowDown') return;
        e.preventDefault();
        setH(dock.getBoundingClientRect().height + (e.key === 'ArrowUp' ? 24 : -24), true);
      });
    }
    // 3D：撳開關先動態載入 three.js（站內 vendor/），WebGL 唔支援就收埋呢個開關
    let stage3d = null,
      three3dFailed = false,
      three3dLoading = false;
    async function show3d() {
      const box = document.querySelector('#threebox');
      if (!stage3d && !three3dLoading) {
        three3dLoading = true;
        box.textContent = '載入 3D 中…';
        try {
          const m = await import('./stage3d.js');
          stage3d = await m.mount(box, StageView);
        } catch (e) {
          three3dFailed = true;
          view.three = false;
          box.textContent = '3D 無法載入：' + e.message;
          toast('3D 無法載入：' + e.message);
          three3dLoading = false;
          return renderPanes(song(active));
        }
        three3dLoading = false;
      }
      if (stage3d) {
        stage3d.setVisible(true);
        StageView.notify();
      }
    }
    // 輸出報告要借 3D 畫圖：未載入就載入（唔顯示出嚟），用完由輸出視窗還原
    async function get3d() {
      if (!stage3d && !three3dFailed) await show3d();
      while (three3dLoading) await new Promise((r) => setTimeout(r, 50));
      if (stage3d && !view.three) stage3d.setVisible(false);
      return stage3d;
    }
    const versionSel = {};
    StageView.mount({
      box: document.querySelector('#stagebox'),
      timelineBox: document.querySelector('#timelinebox'),
      timelineVisible: () => !!view.timeline,
      songs: () => state.order.map(song),
      selectSong: (n) => setActive(n),
      song: () => song(active),
      audio,
      toast,
      active: () => !!view.stage,
      threeVisible: () => !!view.three,
      video: vplayer,
      getMode: () => (view.stage && view.three ? 'both' : view.three ? '3d' : view.stage ? '2d' : ''),
      setMode: (m) => {
        view.stage = m === '2d' || m === 'both';
        view.three = m === '3d' || m === 'both';
        saveView();
        renderPanes(song(active));
      },
    });
    StageView.ready().then(() => renderPanes(song(active)));

    // ---- 音樂播放列（自訂外觀；底下仍然係 <audio id="audio">，其他功能照用）----
    const playBtn = document.querySelector('#playBtn'),
      seek = document.querySelector('#seek'),
      tCur = document.querySelector('#tCur'),
      tDur = document.querySelector('#tDur'),
      vol = document.querySelector('#vol'),
      muteBtn = document.querySelector('#muteBtn'),
      dock = document.querySelector('#dock'),
      dockToggle = document.querySelector('#dockToggle');
    const ICON = {
      play: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>',
      pause: '<svg viewBox="0 0 24 24" width="18" height="18" fill="currentColor" aria-hidden="true"><path d="M7 5h4v14H7zM13 5h4v14h-4z"/></svg>',
      prev: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 5h2v14H6zM9 12l10-7v14z"/></svg>',
      next: '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M16 5h2v14h-2zM5 5l10 7L5 19z"/></svg>',
      vol: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9zM16 8.5a5 5 0 010 7M18.5 6a8.5 8.5 0 010 12" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
      mute: '<svg viewBox="0 0 24 24" width="17" height="17" fill="currentColor" aria-hidden="true"><path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16 9l5 6M21 9l-5 6" stroke="currentColor" stroke-width="1.8" fill="none" stroke-linecap="round"/></svg>',
      up: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 15l6-6 6 6"/></svg>',
      down: '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 9l6 6 6-6"/></svg>',
    };
    document.querySelector('#prevSong').innerHTML = ICON.prev;
    document.querySelector('#nextSong').innerHTML = ICON.next;
    const fmtT = (t) => (Number.isFinite(t) ? Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0') : '0:00');
    let seeking = false;
    function syncPlayer() {
      const d = audio.duration,
        p = Number.isFinite(d) && d > 0 ? (audio.currentTime / d) * 1000 : 0;
      tCur.textContent = fmtT(audio.currentTime);
      tDur.textContent = fmtT(d);
      if (!seeking) seek.value = p;
      seek.style.setProperty('--p', p / 10 + '%');
      playBtn.innerHTML = audio.paused ? ICON.play : ICON.pause;
      playBtn.setAttribute('aria-label', audio.paused ? '播放' : '暫停');
    }
    function syncVol() {
      muteBtn.innerHTML = audio.muted || audio.volume === 0 ? ICON.mute : ICON.vol;
      vol.style.setProperty('--p', (audio.muted ? 0 : audio.volume * 100) + '%');
    }
    ['timeupdate', 'durationchange', 'loadedmetadata', 'play', 'pause', 'ended', 'emptied'].forEach((e) => audio.addEventListener(e, syncPlayer));
    seek.addEventListener('input', () => {
      seeking = true;
      const d = audio.duration;
      if (Number.isFinite(d)) audio.currentTime = (seek.value / 1000) * d;
      seek.style.setProperty('--p', seek.value / 10 + '%');
    });
    seek.addEventListener('change', () => (seeking = false));
    playBtn.onclick = () => (audio.paused ? audio.play().catch(() => {}) : audio.pause());
    vol.oninput = () => {
      audio.volume = vol.value / 100;
      audio.muted = false;
      syncVol();
    };
    muteBtn.onclick = () => {
      audio.muted = !audio.muted;
      syncVol();
    };
    document.addEventListener('keydown', (e) => {
      if (e.defaultPrevented || e.code !== 'Space' || e.target.isContentEditable || /^(INPUT|TEXTAREA|SELECT|BUTTON)$/.test(e.target.tagName)) return;
      e.preventDefault();
      playBtn.click();
    });
    // 下欄（loop 組合）收埋：只剩播放列，畀 3D／舞台更大
    function applyDock() {
      const min = view.dock === 'min';
      dock.dataset.dock = min ? 'min' : 'full';
      dockToggle.innerHTML = min ? ICON.up : ICON.down;
      dockToggle.setAttribute('aria-expanded', String(!min));
      dockToggle.setAttribute('aria-label', min ? '展開下欄' : '收埋下欄');
    }
    dockToggle.onclick = () => {
      view.dock = view.dock === 'min' ? 'full' : 'min';
      saveView();
      applyDock();
    };
    syncVol();
    syncPlayer();
    applyDock();
    function songVersions(s) {
      if (!s.demo) return [];
      return [{ label: s.demoLabel || 'demo', src: s.demo }, ...(s.alternates || [])];
    }
    function renderVersions(s) {
      const box = document.querySelector('#versions'),
        list = songVersions(s),
        idx = Math.min(versionSel[s.number] || 0, Math.max(list.length - 1, 0));
      box.innerHTML = '';
      box.hidden = list.length < 2;
      list.forEach((ver, i) => {
        const b = document.createElement('button');
        b.className = 'vchip';
        b.textContent = ver.label;
        b.setAttribute('aria-pressed', String(i === idx));
        b.onclick = () => {
          versionSel[s.number] = i;
          renderVersions(s);
        };
        box.append(b);
      });
      if (list.length) {
        const src = list[idx].src;
        if (audio.getAttribute('src') !== src) {
          audio.src = src;
          audio.load();
        }
      } else {
        audio.removeAttribute('src');
        audio.load();
      }
    }
    function groupClips() {
      const used = new Set(),
        groups = [];
      for (const n of state.order) {
        const items = videos.filter(
          (v) => !used.has(v.fileId) && v.songNumbers.includes(n) && v.matchType !== 'section-only',
        );
        if (!items.length) continue;
        for (const v of items) used.add(v.fileId);
        const cand = items.every((v) => v.matchType === 'visual-name-candidate');
        groups.push({
          title:
            n + ' ' + songTitle(n) + (cand ? '（候選）' : '') + ' · ' + items.length + ' clips',
          items,
        });
      }
      const byFolder = new Map();
      for (const n of state.order)
        for (const v of videos) {
          if (
            used.has(v.fileId) ||
            v.matchType !== 'section-only' ||
            !v.songNumbers.includes(n)
          )
            continue;
          used.add(v.fileId);
          if (!byFolder.has(v.folder)) byFolder.set(v.folder, []);
          byFolder.get(v.folder).push(v);
        }
      for (const [folder, items] of byFolder)
        groups.push({ title: folder + ' 區段 · ' + items.length + ' clips', items });
      const rest = videos.filter((v) => !used.has(v.fileId));
      if (rest.length) groups.push({ title: '未分區 · ' + rest.length + ' clips', items: rest });
      return groups;
    }
    function renderLibrary() {
      lib.innerHTML = '';
      for (const g of groupClips()) {
        const sec = document.createElement('section');
        sec.className = 'group';
        const head = document.createElement('div');
        head.className = 'grouptitle';
        head.textContent = g.title;
        const grid = document.createElement('div');
        grid.className = 'groupgrid';
        for (const v of g.items) grid.append(clipTile(v));
        sec.append(head, grid);
        lib.append(sec);
      }
    }
    function clipTile(v) {
      const t = clipTitle(v),
        tile = document.createElement('div');
      tile.className = 'clip' + (selectedVideo === v.fileId ? ' selected' : '');
      tile.draggable = true;
      tile.tabIndex = 0;
      tile.setAttribute('role', 'button');
      tile.setAttribute('aria-label', v.filename + ' ' + t.main + '，' + label(v));
      tile.innerHTML =
        `<img loading="lazy" src="source-materials/thumbnails/${encodeURIComponent(v.fileId)}.jpg" alt="${esc(v.filename)} 縮圖">` +
        `<div class="clipbadges"><span class="pill ${t.pill}">${label(v)}</span>` +
        (t.note ? `<span class="clipnote">${esc(t.note)}</span>` : '') +
        `</div>` +
        `<button class="clipadd" aria-label="將 ${esc(v.filename)} 加入 ${esc(t.main)}">＋</button>` +
        `<div class="clipinfo"><div class="cliptitle" title="${esc(t.main)}">${esc(t.main)}</div>` +
        `<div class="clipfile" title="${esc(v.filename)}">${esc(v.filename)}</div></div>`;
      tile.onclick = (e) => {
        if (e.target.closest('button')) return;
        selectedVideo = v.fileId;
        playClip(v);
      };
      tile.querySelector('button').onclick = (e) => {
        e.stopPropagation();
        assign(active, v.fileId);
      };
      tile.onkeydown = (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          tile.click();
        }
      };
      tile.ondragstart = (e) => {
        dragClip = v.fileId;
        e.dataTransfer.setData('text/clip', v.fileId);
        e.dataTransfer.effectAllowed = 'copy';
      };
      return tile;
    }
    const proxySrc = (v) => 'media/loops/' + encodeURIComponent(v.fileId) + '.mp4';
    const audioPlaying = () => !audio.paused && !audio.ended;
    function playClip(v) {
      if (!view.video && !view.three) {
        view.video = true;
        saveView();
        renderPanes(song(active), true);
      }
      previewGeneration++;
      if (previewTimer) clearTimeout(previewTimer);
      selectedVideo = v.fileId;
      document.querySelector('#nowTitle').textContent = v.filename;
      document.querySelector('#nowMeta').textContent =
        label(v) + ' · ' + v.folder + ' · 本站 loop proxy（靜音，跟歌曲音訊同步）';
      video.removeAttribute('src');
      video.hidden = true;
      vplayer.hidden = false;
      const assigned = state.clips[active] || [];
      vplayer.loop = !(assigned.includes(v.fileId) && assigned.length > 1);
      vplayer.onerror = () => {
        if (selectedVideo !== v.fileId) return;
        vplayer.hidden = true;
        document.querySelector('#status').textContent = '影片載入失敗：' + v.filename;
      };
      vplayer.src = proxySrc(v);
      document.querySelector('#status').textContent = audioPlaying()
        ? '影片與歌曲音訊同步播放中（影片短，自動循環）。'
        : '影片靜音播放中；按下方歌曲音訊嘅播放掣，歌同影片會一齊播放。';
      vplayer.play().catch(() => {});
      renderLibrary();
      renderAssigned();
    }
    vplayer.addEventListener('ended', () => {
      const assigned = state.clips[active] || [],
        i = assigned.indexOf(selectedVideo),
        nextId = i >= 0 && assigned.length > 1 ? assigned[(i + 1) % assigned.length] : selectedVideo;
      if (nextId === selectedVideo) {
        vplayer.currentTime = 0;
        vplayer.play().catch(() => {});
      } else if (clip(nextId)) {
        playClip(clip(nextId));
      }
    });
    audio.addEventListener('play', () => {
      if (!selectedVideo && view.video) {
        const first = (state.clips[active] || []).map(clip).find(Boolean);
        if (first) playClip(first);
      }
      if (selectedVideo && !vplayer.hidden) vplayer.play().catch(() => {});
    });
    audio.addEventListener('pause', () => vplayer.pause());
    audio.addEventListener('ended', () => vplayer.pause());
    video.addEventListener('load', () => {
      if (!selectedVideo || previewTimedOut) return;
      document.querySelector('#status').textContent =
        'Drive 預覽頁已載入；內嵌播放器仍在初始化，尚未確認可播放。';
    });
    function assign(n, id) {
      if (!state.clips[n].includes(id)) state.clips[n].push(id);
      active = n;
      save();
      setActive(n);
      renderAssigned();
      renderSongs();
      selectedVideo = id;
      const v = clip(id);
      if (v) playClip(v);
    }
    function renderAssigned() {
      const s = song(active),
        box = document.querySelector('#assigned');
      document.querySelector('#assignTitle').textContent =
        active + ' · ' + s.title + ' 的 loop 組合';
      box.innerHTML = '';
      if (!state.clips[active].length) {
        const hint = document.createElement('div');
        hint.className = 'assigned-empty';
        hint.textContent = defaultIds(active).length
          ? '此歌尚未配任何 loop；由右側拖入片段，或點縮圖右上角「＋」。'
          : '此歌無 Drive ref；仍可將任何影片拖入，或點縮圖右上角「＋」。';
        box.append(hint);
      }
      state.clips[active].forEach((id, i) => {
        const v = clip(id);
        if (!v) return;
        const card = document.createElement('div');
        card.className = 'assigned-card' + (selectedVideo === id ? ' playing' : '');
        card.tabIndex = 0;
        card.setAttribute('role', 'group');
        card.setAttribute('aria-label', v.filename + (selectedVideo === id ? '（播放中）' : ''));
        card.draggable = true;
        card.dataset.id = id;
        card.innerHTML = `<img loading="lazy" src="source-materials/thumbnails/${encodeURIComponent(id)}.jpg" alt=""><div class="cardname" title="${esc(v.filename)}">${esc(v.filename)}</div><div class="cardactions"><button data-a="play" aria-label="播放${esc(v.filename)}">播放</button><button data-a="left" aria-label="片段左移">←</button><button data-a="right" aria-label="片段右移">→</button><button data-a="remove" aria-label="移除${esc(v.filename)}">移除</button></div>`;
        const thumb = card.querySelector('img'),
          name = card.querySelector('.cardname');
        [thumb, name].forEach((el) => {
          el.style.cursor = 'pointer';
          el.title = '點擊播放 ' + v.filename;
          el.onclick = () => playClip(v);
        });
        card.onkeydown = (e) => {
          if (e.target === card && (e.key === 'Enter' || e.key === ' ')) {
            e.preventDefault();
            playClip(v);
          }
        };
        if (selectedVideo === id) setTimeout(() => card.scrollIntoView({ block: 'nearest', inline: 'nearest' }), 0);
        card.querySelectorAll('button').forEach(
          (b) =>
            (b.onclick = () => {
              const a = b.dataset.a;
              if (a === 'play') playClip(v);
              if (a === 'remove') state.clips[active].splice(i, 1);
              if (a === 'left' && i > 0)
                [state.clips[active][i - 1], state.clips[active][i]] = [
                  state.clips[active][i],
                  state.clips[active][i - 1],
                ];
              if (a === 'right' && i < state.clips[active].length - 1)
                [state.clips[active][i + 1], state.clips[active][i]] = [
                  state.clips[active][i],
                  state.clips[active][i + 1],
                ];
              save();
              renderAssigned();
              renderSongs();
            }),
        );
        card.ondragstart = (e) => {
          dragClip = id;
          e.dataTransfer.setData('text/assigned', id);
        };
        card.ondragover = (e) => e.preventDefault();
        card.ondrop = (e) => {
          e.preventDefault();
          const from = state.clips[active].indexOf(e.dataTransfer.getData('text/assigned'));
          if (from < 0) return;
          const [moved] = state.clips[active].splice(from, 1);
          state.clips[active].splice(i, 0, moved);
          save();
          renderAssigned();
        };
        box.append(card);
      });
    }
    function defaultIds(n) {
      return videos.filter((v) => v.songNumbers.includes(n)).map((v) => v.fileId);
    }
    function createDefaultClips() {
      const clips = Object.fromEntries(songs.map((s) => [s.number, []]));
      for (const n of ['03', '05', '06'])
        clips[n] = videos
          .filter((v) => v.songNumbers.includes(n) && v.matchType === 'exact-title')
          .map((v) => v.fileId);
      clips['07'] = videos
        .filter((v) => v.matchType === 'visual-name-candidate')
        .map((v) => v.fileId);
      return clips;
    }
    function esc(x) {
      return String(x).replace(
        /[&<>"']/g,
        (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c],
      );
    }
    document.querySelector('#share').onclick = async () => {
      const def = createDefaultClips(),
        parts = [];
      if (JSON.stringify(state.order) !== JSON.stringify(defaultOrder))
        parts.push('o=' + state.order.join(''));
      for (const n of defaultOrder)
        if (JSON.stringify(state.clips[n]) !== JSON.stringify(def[n]))
          parts.push(n + ':' + (state.clips[n].length ? state.clips[n].map((id) => id.slice(0, 4)).join('.') : '-'));
      const url = location.origin + location.pathname + (parts.length ? '#s=' + parts.join(';') : '');
      try {
        await navigator.clipboard.writeText(url);
        toast('已複製分享連結 ✓');
      } catch {
        prompt('複製此連結：', url);
      }
    };
    fetch('stage-plans.json')
      .then((r) => r.json())
      .then((cfg) => {
        const site = cfg.site || {};
        if (site.title) document.title = site.title;
        if (site.brand) document.querySelector('.top .brand').textContent = site.brand;
        if (site.meta) document.querySelector('.top .meta').textContent = site.meta;
        document.querySelectorAll('.top a[data-link]').forEach((a) => {
          const l = (cfg.links || {})[a.dataset.link];
          if (!l || !l.url) return;
          a.href = l.url;
          const lbl = document.createElement('span');
          lbl.className = 'lbl';
          lbl.textContent = l.label || l.url;
          a.replaceChildren(lbl);
          a.setAttribute('aria-label', l.title || l.label || l.url);
          if (l.title) a.title = l.title;
          a.hidden = false;
        });
      })
      .catch(() => {});
    document.querySelector('#export').onclick = async () => {
      try {
        const m = await import('./export.js');
        await StageView.ready();
        m.openExport({
          StageView,
          toast,
          get3d,
          activeNumber: () => active,
          songs: () => state.order.map(song),
          loops: (n) => (state.clips[n] || []).map(clip).filter(Boolean).map((v) => v.filename),
        });
      } catch (e) {
        toast('輸出失敗：' + e.message);
      }
    };
    document.querySelector('#reset').onclick = () => {
      if (!confirm('重設全部排序與影片配置？')) return;
      state = { order: [...defaultOrder], clips: createDefaultClips() };
      save();
      stopPreview('配置已重設。');
      renderSongs();
      setActive(state.order[0]);
      renderAssigned();
    };
    document.querySelector('#clearVideo').onclick = () => stopPreview();
    document.querySelector('#prevSong').onclick = () => {
      const i = state.order.indexOf(active);
      if (i > 0) setActive(state.order[i - 1]);
    };
    document.querySelector('#nextSong').onclick = () => {
      const i = state.order.indexOf(active);
      if (i < state.order.length - 1) setActive(state.order[i + 1]);
    };
    document.querySelector('#search').oninput = (e) => {
      const q = e.target.value.trim().toLowerCase(),
        hit = (el) =>
          el.textContent.toLowerCase().includes(q) ||
          (el.getAttribute('aria-label') || '').toLowerCase().includes(q);
      document.querySelectorAll('.song').forEach((el) => (el.hidden = !hit(el)));
      document.querySelectorAll('.clip').forEach((el) => (el.hidden = !hit(el)));
      document.querySelectorAll('.group').forEach((g) => {
        g.hidden = !Array.from(g.querySelectorAll('.clip')).some((c) => !c.hidden);
      });
    };
    renderSongs();
    setActive(state.order[0]);
  }
})();
