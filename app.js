// 內嵌播放（Suno／Spotify）：host 白名單同路徑格式只喺呢一個常量，散落字串唔准。
// 只接受 https；拒絕 userinfo、顯式 port（連預設 443）、fragment；query 只准 ?si=<非空> 單參數。
const EMBED = (() => {
  const HOSTS = ['suno.com', 'open.spotify.com'];
  const SUNO_PATH = /^\/(song|embed)\/(.+)$/;
  const SUNO_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
  const SPOTIFY_TYPES = ['track', 'album', 'playlist', 'episode'];
  const SPOTIFY_PATH = /^\/(?:intl-[a-z]{2}\/)?(track|album|playlist|episode)\/(.+)$/;
  const SPOTIFY_ID = /^[A-Za-z0-9]{22}$/;
  function parse(url) {
    if (typeof url !== 'string') return null;
    let u;
    try {
      u = new URL(url);
    } catch (e) {
      return null;
    }
    if (u.protocol !== 'https:') return null;
    // 顯式 port（連預設 443 都拒）：new URL 會藏預設 port，要喺原字符串查
    const portM = /^https:\/\/([^\/?#]+)/.exec(url);
    if (!portM || portM[1].split('@').pop().indexOf(':') !== -1) return null;
    if (u.username || u.password || u.port) return null;
    if (HOSTS.indexOf(u.hostname) === -1) return null;
    if (u.hash) return null;
    // query 只准 ?si=<非空> 單參數（Spotify share 連結）；其餘 query 形式拒絕
    if (u.search && (u.search.indexOf('&') !== -1 || !/^si=.+$/.test(u.search.slice(1)))) return null;
    if (u.hostname === 'suno.com') {
      const m = SUNO_PATH.exec(u.pathname);
      if (!m || !SUNO_UUID.test(m[2])) return null;
      return { provider: 'suno', iframe: 'https://suno.com/embed/' + m[2] };
    }
    const m2 = SPOTIFY_PATH.exec(u.pathname);
    if (!m2 || SPOTIFY_TYPES.indexOf(m2[1]) === -1 || !SPOTIFY_ID.test(m2[2])) return null;
    return { provider: 'spotify', iframe: 'https://open.spotify.com/embed/' + m2[1] + '/' + m2[2] };
  }
  return { parse };
})();
window.__showEmbed = { parse: EMBED.parse };

(() => {
  boot();
  async function boot() {
    if (window.ready) return;
    window.ready = true;
    const songs = await fetch('songs.json').then((r) => {
      if (!r.ok) throw Error('songs.json ' + r.status);
      return r.json();
    });
    const TITLES_KEY = 'flowboard-titles-v1';
    const DETAILS_KEY = TITLES_KEY + '-instrumentation-v1';
    const SECTIONS_KEY = 'flowboard-sections-v1';
    const COLLAPSED_SECTIONS_KEY = SECTIONS_KEY + '-collapsed-v1';
    const SEGUES_KEY = 'flowboard-segues-v1';
    const validColor = (value) => /^#[0-9a-f]{6}$/i.test(value || '');
    let sectionState = { groups: [], assignments: {} }, segues = [];
    let collapsedSections = new Set();
    const toolsOpen = new Set(); // 歌單列「⋯」展開咗段落／銜接工具嘅歌
    try {
      const saved = JSON.parse(localStorage.getItem(SECTIONS_KEY));
      if (saved && Array.isArray(saved.groups) && saved.assignments && typeof saved.assignments === 'object') {
        sectionState = saved;
        sectionState.groups = sectionState.groups.filter((g) => g && g.id && typeof g.name === 'string' && validColor(g.color));
      }
    } catch {}
    for (const s of songs) {
      const section = s.archived
        ? { id: 'archive', name: 'Archive', color: '#7b827d' }
        : s.flowGroup;
      if (!section || !section.id || !section.name || !validColor(section.color)) continue;
      if (!sectionState.groups.some((g) => g.id === section.id)) sectionState.groups.push({ ...section });
      const assigned = sectionState.assignments[s.number];
      if (s.archived || !sectionState.groups.some((g) => g.id === assigned)) sectionState.assignments[s.number] = section.id;
    }
    try {
      const saved = JSON.parse(localStorage.getItem(COLLAPSED_SECTIONS_KEY));
      if (Array.isArray(saved)) collapsedSections = new Set(saved.filter((key) => typeof key === 'string'));
    } catch {}
    try {
      const saved = JSON.parse(localStorage.getItem(SEGUES_KEY));
      if (Array.isArray(saved)) segues = saved.filter((p) => typeof p === 'string' && p.includes('→'));
    } catch {}
    const saveSections = () => {
      try { localStorage.setItem(SECTIONS_KEY, JSON.stringify(sectionState)); } catch {}
    };
    const saveCollapsedSections = () => {
      try { localStorage.setItem(COLLAPSED_SECTIONS_KEY, JSON.stringify([...collapsedSections])); } catch {}
    };
    const saveSegues = () => {
      try { localStorage.setItem(SEGUES_KEY, JSON.stringify(segues)); } catch {}
    };
    let titleOverrides = {};
    try {
      const saved = JSON.parse(localStorage.getItem(TITLES_KEY));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) titleOverrides = saved;
    } catch {}
    let detailOverrides = {};
    try {
      const saved = JSON.parse(localStorage.getItem(DETAILS_KEY));
      if (saved && typeof saved === 'object' && !Array.isArray(saved)) detailOverrides = saved;
    } catch {}
    const sourceTitles = new Map(songs.map((s) => [s.number, s.title]));
    for (const s of songs) if (typeof titleOverrides[s.number] === 'string') s.title = titleOverrides[s.number];
    // 歌單入面嘅 Suno／Spotify 歌：songs.json 可寫 track（長期），亦可喺板上「＋加歌」貼連結（只存喺呢個瀏覽器）
    const TRACKS_KEY = 'flowboard-tracks-v1';
    const TRACK_NAME = { suno: 'Suno', spotify: 'Spotify' };
    const trackUrl = (s) => (s && s.track ? (typeof s.track === 'string' ? s.track : s.track.url) : null);
    const readTracks = () => {
      try {
        const a = JSON.parse(localStorage.getItem(TRACKS_KEY));
        return Array.isArray(a) ? a.filter((t) => t && t.number && EMBED.parse(t.url)) : [];
      } catch {
        return [];
      }
    };
    const writeTracks = (a) => {
      try {
        localStorage.setItem(TRACKS_KEY, JSON.stringify(a));
      } catch {}
    };
    const userTrackSong = (t) => ({ number: t.number, title: t.title, section: TRACK_NAME[EMBED.parse(t.url).provider], credit: '', parts: [], track: { url: t.url }, userAdded: true });
    for (const t of readTracks()) if (!songs.some((s) => s.number === t.number)) songs.push(userTrackSong(t));
    for (const s of songs) {
      if (!sourceTitles.has(s.number)) sourceTitles.set(s.number, s.title);
      if (typeof titleOverrides[s.number] === 'string') s.title = titleOverrides[s.number];
    }
    // 本機檔案（歌、影片）：存喺瀏覽器 IndexedDB，唔上傳；reload 後仍然喺
    const IDB = (() => {
      const open = () =>
        new Promise((res, rej) => {
          try {
            const r = indexedDB.open('flowboard-files-v1', 1);
            r.onupgradeneeded = () => {
              r.result.createObjectStore('songs', { keyPath: 'number' });
              r.result.createObjectStore('videos', { keyPath: 'id' });
            };
            r.onsuccess = () => res(r.result);
            r.onerror = () => rej(r.error);
          } catch (e) {
            rej(e);
          }
        });
      const run = async (store, mode, fn) => {
        const db = await open();
        return new Promise((res, rej) => {
          const t = db.transaction(store, mode),
            req = fn(t.objectStore(store));
          t.oncomplete = () => res(req && req.result);
          t.onerror = t.onabort = () => rej(t.error);
        });
      };
      return {
        all: (s) => run(s, 'readonly', (st) => st.getAll()).then((r) => r || []).catch(() => []),
        put: (s, v) => run(s, 'readwrite', (st) => st.put(v)),
        del: (s, k) => run(s, 'readwrite', (st) => st.delete(k)).catch(() => {}),
      };
    })();
    const fileSong = (f) => ({ number: f.number, title: f.title, section: '本機檔案', credit: '', parts: [], demo: URL.createObjectURL(f.blob), demoLabel: 'file', userAdded: true, userFile: true });
    for (const f of await IDB.all('songs')) if (f && f.blob && !songs.some((s) => s.number === f.number)) songs.push(fileSong(f));
    for (const s of songs) {
      if (!sourceTitles.has(s.number)) sourceTitles.set(s.number, s.title);
      if (typeof titleOverrides[s.number] === 'string') s.title = titleOverrides[s.number];
    }
    const inventory = await fetch('source-materials/drive-video-inventory.json').then((r) => {
      if (!r.ok) throw Error('影片清單 ' + r.status);
      return r.json();
    });
    const legacyMatchType = () => 'section-only';
    const videos = inventory.videos.map((v) => ({
      ...v,
      matchType: v.matchType || legacyMatchType(v.filename),
    }));
    const fileVideo = (f) => ({ filename: f.name, folder: '我加嘅影片', fileId: 'u-' + f.id, sizeBytes: f.blob.size, songNumbers: [], matchType: 'pool', localSrc: URL.createObjectURL(f.blob), thumb: f.thumb || '', userAdded: true, idbId: f.id });
    for (const f of await IDB.all('videos')) if (f && f.blob) videos.push(fileVideo(f));
    const defaultOrder = songs.map((s) => s.number),
      key = 'flowboard-drive-v7',
      legacyPrefix = 'flowboard-drive-v';
    let state,
      migratedState = null,
      hasSavedState = false;
    try {
      state = JSON.parse(localStorage.getItem(key));
      hasSavedState = !!(state && Array.isArray(state.order));
    } catch {}
    if (!state || !Array.isArray(state.order)) {
      const oldKeys = Object.keys(localStorage)
        .filter((k) => k.startsWith(legacyPrefix) && k !== key)
        .sort()
        .reverse();
      for (const oldKey of oldKeys) {
        try {
          const oldState = JSON.parse(localStorage.getItem(oldKey));
          if (oldState && oldState.clips && typeof oldState.clips === 'object') {
            migratedState = oldState;
            break;
          }
        } catch {}
      }
      state = {
        order: [...defaultOrder],
        clips: migratedState?.clips || {},
        clipsRev: migratedState?.clipsRev,
      };
      try {
        localStorage.setItem(key, JSON.stringify(state));
      } catch {}
    } else {
      const kept = [...new Set(state.order.filter((n) => defaultOrder.includes(n)))];
      state.order = [...kept, ...defaultOrder.filter((n) => !kept.includes(n))];
      state.clips = state.clips && typeof state.clips === 'object' ? state.clips : {};
    }
    for (const s of songs) if (!Array.isArray(state.clips[s.number])) state.clips[s.number] = [];
    if (!migratedState && !hasSavedState) state.clips = createDefaultClips();
    // 素材庫換版（inventory.clipsRevision 變咗）：舊配片冇意義，一次過重設為新預設（每首歌自動掛返自己嘅 loop）
    const defaultClips = createDefaultClips(),
      invRev = inventory.clipsRevision || 0;
    if ((state.clipsRev || 0) !== invRev) {
      state.clips = Object.fromEntries(songs.map((x) => [x.number, [...defaultClips[x.number]]]));
      state.clipsRev = invRev;
    }
    // 清走指住已不存在 fileId 嘅 clips；全部失效嘅歌補回預設（人手清空嘅歌唔補）
    for (const s of songs) {
      const before = state.clips[s.number],
        kept = before.filter((id) => videos.some((v) => v.fileId === id));
      state.clips[s.number] = !kept.length && before.length ? defaultClips[s.number] : kept;
    }
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {}
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
        const had = hasSavedState || !!migratedState; // 載入時 state 已經寫入 localStorage，唔可以再用 getItem 判斷「本機有冇配置」
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
      dragSection = null,
      dragClip = null,
      previewTimer = null,
      previewGeneration = 0,
      previewTimedOut = false;
    const audio = document.querySelector('#audio'),
      video = document.querySelector('#video'),
      vplayer = document.querySelector('#vplayer'),
      songRoot = document.querySelector('#songs'),
      lib = document.querySelector('#library');
    const libTitleEl = document.querySelector('#libTitle'); // 舊快取嘅 index.html 冇呢個 id：唔好令成頁死
    if (libTitleEl) libTitleEl.textContent = videos.length + ' 個 loop';
    const ROW_MODE = 'classic';
    const HIDE_DOCK_NO_VIDEO = true;
    const miList = null;
    if (miList && Array.isArray(miList.groups) && miList.groups.length) {
      document.querySelector('#miListTitle').textContent = miList.title || 'M+ MI list';
      document.querySelector('#miListContent').innerHTML = miList.groups.map((group) => {
        const sections = (group.sections || []).map((section) => {
          const items = (section.items || []).map((item) => `<li>${esc(item)}</li>`).join('');
          return `${section.title ? `<h4>${esc(section.title)}</h4>` : ''}${items ? `<ul>${items}</ul>` : ''}`;
        }).join('');
        const remarks = (group.remarks || [])
          .map((remark) => `<p class="mi-remark">${esc(remark)}</p>`)
          .join('');
        return `<section class="mi-group"><h3>${esc(group.name)}</h3>${sections}${remarks}</section>`;
      }).join('');
      document.querySelector('#miList').hidden = false;
    }
    const save = () => {
      try {
        const serialized = JSON.stringify(state);
        localStorage.setItem(key, serialized);
        if (localStorage.getItem(key) !== serialized) throw new Error('localStorage readback mismatch');
        return true;
      } catch {
        toast('自動保存失敗；請重試或先複製分享連結備份。');
        return false;
      }
    },
      song = (n) => songs.find((s) => s.number === n),
      clip = (id) => videos.find((v) => v.fileId === id),
      exactIds = (n) =>
        videos
          .filter((v) => v.songNumbers.includes(n) && v.matchType === 'exact-title')
          .map((v) => v.fileId);
    function label(v) {
      if (v.userAdded) return 'MINE';
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
      if (v.userAdded) return { main: v.filename, pill: 'section', note: '' };
      if (v.matchType === 'exact-title')
        return { main: songTitle(v.songNumbers[0]), pill: 'exact', note: '' };
      if (v.matchType === 'visual-name-candidate')
        return { main: songTitle(v.songNumbers[0]), pill: 'candidate', note: '待確認' };
      const scope =
        v.songNumbers.length > 1 ? ' 可用於 ' + v.songNumbers.join('·') : ' 區段';
      return { main: v.folder + scope, pill: 'section', note: '' };
    }
    function renderSectionManager() {
      const root = document.querySelector('#sectionGroups');
      if (!root) return;
      root.innerHTML = '';
      sectionState.groups.forEach((group) => {
        const item = document.createElement('div');
        item.className = 'section-group-editor';
        item.innerHTML = `<input data-field="name" value="${esc(group.name)}" maxlength="40" aria-label="段落名稱" /><input data-field="color" type="color" value="${group.color}" aria-label="${esc(group.name)}顏色" /><button type="button" data-act="delete-group" aria-label="刪除${esc(group.name)}段落" title="刪除段落">刪除</button>`;
        item.querySelector('[data-field="name"]').addEventListener('change', (e) => {
          const name = e.target.value.trim();
          if (name) group.name = name;
          else e.target.value = group.name;
          saveSections();
          renderSongs();
        });
        item.querySelector('[data-field="color"]').addEventListener('change', (e) => {
          if (!validColor(e.target.value)) return;
          group.color = e.target.value;
          saveSections();
          renderSongs();
        });
        item.querySelector('[data-act="delete-group"]').addEventListener('click', () => {
          sectionState.groups = sectionState.groups.filter((g) => g.id !== group.id);
          for (const [number, id] of Object.entries(sectionState.assignments)) if (id === group.id) delete sectionState.assignments[number];
          saveSections();
          renderSectionManager();
          renderSongs();
        });
        root.append(item);
      });
    }
    const sectionForm = document.querySelector('#sectionForm');
    sectionForm?.addEventListener('submit', (e) => {
      e.preventDefault();
      const name = sectionForm.elements.name.value.trim();
      if (!name) return;
      const id = 'section-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
      sectionState.groups.push({ id, name, color: validColor(sectionForm.elements.color.value) ? sectionForm.elements.color.value : '#8b6df6' });
      saveSections();
      sectionForm.reset();
      sectionForm.elements.color.value = '#8b6df6';
      renderSectionManager();
      renderSongs();
    });
    // 段落拖曳：歌屬某段落嘅位置
    const firstOfGroup = (gid) => state.order.find((x) => sectionState.assignments[x] === gid);
    const moveSongBeforeGroup = (num, gid) => {
      const target = state.order.find((x) => x !== num && sectionState.assignments[x] === gid); // 唔計自己（已先歸咗段）
      state.order = state.order.filter((x) => x !== num);
      const idx = target !== undefined ? state.order.indexOf(target) : state.order.length;
      state.order.splice(idx < 0 ? state.order.length : idx, 0, num);
    };
    // 整段搬位：段落 gid 嘅全部歌搬去 beforeNum 之前；beforeNum 為 undefined 就放最尾
    const moveBlockBefore = (gid, beforeNum) => {
      const block = state.order.filter((x) => sectionState.assignments[x] === gid);
      if (!block.length) return;
      state.order = state.order.filter((x) => sectionState.assignments[x] !== gid);
      const idx = beforeNum !== undefined ? state.order.indexOf(beforeNum) : state.order.length;
      state.order.splice(idx < 0 ? state.order.length : idx, 0, ...block);
    };
    // 段落標題：loop 內為有歌段落、loop 後為空段落；點擊收合、拖標題整段搬位、拖歌入標題歸段
    const appendHeading = (group, collapsedKey) => {
      const heading = document.createElement('button');
      const collapsed = collapsedSections.has(collapsedKey);
      heading.className = 'song-section-heading';
      heading.type = 'button';
      heading.style.setProperty('--section-color', group.color);
      heading.setAttribute('aria-expanded', String(!collapsed));
      heading.setAttribute('aria-label', `${collapsed ? '展開' : '收起'}${group.name}歌曲段落`);
      heading.innerHTML = `<span>${esc(group.name)}</span><span class="section-collapse-icon" aria-hidden="true">${collapsed ? '▸' : '▾'}</span>`;
      heading.dataset.group = group.id;
      heading.title = '點擊收合／展開歌曲；拖標題整段搬位';
      heading.draggable = true;
      heading.addEventListener('click', (e) => {
        e.stopPropagation();
        if (collapsedSections.has(collapsedKey)) collapsedSections.delete(collapsedKey);
        else collapsedSections.add(collapsedKey);
        saveCollapsedSections();
        renderSongs();
      });
      heading.addEventListener('dragstart', (e) => {
        dragSection = group.id;
        dragSong = null;
        e.dataTransfer.setData('text/section', group.id);
        heading.classList.add('dragging');
      });
      heading.addEventListener('dragend', () => {
        heading.classList.remove('dragging');
        dragSection = null;
      });
      heading.addEventListener('dragover', (e) => {
        e.preventDefault();
        heading.classList.add('over');
      });
      heading.addEventListener('dragleave', () => heading.classList.remove('over'));
      heading.addEventListener('drop', (e) => {
        e.preventDefault();
        heading.classList.remove('over');
        if (dragSection && dragSection !== group.id) {
          // 整段拖：搬去本段落第一首歌之前；本段落空就放最尾
          moveBlockBefore(dragSection, firstOfGroup(group.id));
        } else if (dragSong) {
          sectionState.assignments[dragSong] = group.id;
          moveSongBeforeGroup(dragSong, group.id);
        } else return;
        saveSections();
        if (save()) toast('段落及歌序已自動保存。');
        renderSongs();
      });
      songRoot.append(heading);
    };
    function renderSongs() {
      songRoot.innerHTML = '';
      renderSectionManager();
      let previousGroup = null,
        groupRunStart = null;
      for (const [i, n] of state.order.entries()) {
        const s = song(n),
          row = document.createElement('article');
        const group = sectionState.groups.find((g) => g.id === sectionState.assignments[n]),
          previousNumber = state.order[i - 1],
          nextNumber = state.order[i + 1],
          previousIsActive = previousNumber !== undefined && !song(previousNumber).archived,
          nextIsActive = nextNumber !== undefined && !song(nextNumber).archived,
          segueKey = (from, to) => String(from) + '→' + String(to),
          segueOn = previousIsActive && segues.includes(segueKey(previousNumber, n)),
          nextSegueOn = nextIsActive && segues.includes(segueKey(n, nextNumber));
        if (group && group.id !== previousGroup) {
          groupRunStart = n;
          appendHeading(group, group.id + ':' + groupRunStart);
        }
        row.className =
          'song' + (active === n ? ' selected' : '') + (s.archived ? ' archived-song' : '') + (s.track ? ' track' : defaultIds(n).length ? '' : ' no-ref') + (segueOn ? ' segue-on' : '') + (nextSegueOn ? ' segue-next-on' : '') + (toolsOpen.has(n) ? ' tools-open' : '');
        if (group) row.style.setProperty('--section-color', group.color);
        row.hidden = Boolean(group && collapsedSections.has(group.id + ':' + groupRunStart));
        row.draggable = true;
        row.tabIndex = 0;
        row.setAttribute('aria-label', s.title + (s.archived ? '，Archive 封存曲目' : '歌曲列；按 Enter 選擇'));
        row.dataset.num = n;
        // 歌單列顯示方式由 shows.json 嘅 flow.rowMode 決定：classic＝歌號（13a／13b）＋ loop 數量；position＝序號＋樂器備註
        let num, sub;
        if (ROW_MODE === 'position') {
          num = s.archived
            ? 'A' + state.order.slice(0, i + 1).filter((x) => song(x).archived).length
            : String(state.order.slice(0, i + 1).filter((x) => !song(x).archived).length).padStart(2, '0');
          const detail = Object.hasOwn(detailOverrides, n) ? detailOverrides[n] : s.instrumentationNote;
          sub = `<div class="songdesc editable-song-note${detail ? '' : ' is-empty'}" role="button" tabindex="0" title="雙擊編輯編曲／樂手">${esc(detail || '')}</div>`;
        } else {
          const refs = state.clips[n],
            match = refs.length
              ? refs.length + ' loop'
              : exactIds(n).length
                ? exactIds(n).length + ' exact'
                : '無 loop';
          num = defaultOrder[i];
          sub = `<div class="songdesc">${esc(match)} · ${esc(s.section)}</div>`;
        }
        const tp = s.track ? EMBED.parse(trackUrl(s)) : null;
        if (tp) sub = `<div class="songdesc">${esc(TRACK_NAME[tp.provider])} 連結 · 喺下欄播放</div>`;
        if (s.userFile) sub = `<div class="songdesc">本機檔案 · 只喺呢個瀏覽器</div>`;
        const badge = s.archived ? '' : s.userFile ? `<span class="srcbadge file" title="本機音訊檔">檔案</span>` : tp ? `<span class="srcbadge ${tp.provider}" title="${esc(TRACK_NAME[tp.provider])} 歌曲">${esc(TRACK_NAME[tp.provider])}</span>` : '';
        const del = s.userAdded ? `<button data-act="del" aria-label="${esc(s.title)}移除" title="移除呢首（只喺呢個瀏覽器）">✕</button>` : '';
        const previousTitle = previousIsActive ? song(previousNumber).title : '',
          nextTitle = nextIsActive ? song(nextNumber).title : '';
        const connectionLabel = `直接銜接：${previousTitle} → ${s.title}`;
        const connectionMark = segueOn
          ? `<span class="segue-joint-icon" title="${esc(connectionLabel)}" aria-label="${esc(connectionLabel)}"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.07 0l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71M14 11a5 5 0 0 0-7.07 0l-3 3a5 5 0 0 0 7.07 7.07l1.72-1.71"/></svg></span>`
          : '';
        const previousSegueLabel = `接上上一首：${previousTitle} → ${s.title}`,
          nextSegueLabel = `接到下一首：${s.title} → ${nextTitle}`;
        const previousSegueButton = previousIsActive
          ? `<button type="button" class="segue-toggle${segueOn ? ' on' : ''}" data-act="segue" data-from="${esc(previousNumber)}" data-to="${esc(n)}" aria-pressed="${segueOn}" aria-label="${esc(segueOn ? '取消' + previousSegueLabel : previousSegueLabel)}" title="${esc(segueOn ? '取消銜接：' + previousTitle + ' → ' + s.title : previousSegueLabel)}">${segueOn ? '✓ 前' : '↶ 前'}</button>`
          : '';
        const nextSegueButton = nextIsActive
          ? `<button type="button" class="segue-toggle${nextSegueOn ? ' on' : ''}" data-act="segue" data-from="${esc(n)}" data-to="${esc(nextNumber)}" aria-pressed="${nextSegueOn}" aria-label="${esc(nextSegueOn ? '取消' + nextSegueLabel : nextSegueLabel)}" title="${esc(nextSegueOn ? '取消銜接：' + s.title + ' → ' + nextTitle : nextSegueLabel)}">${nextSegueOn ? '✓ 後' : '後 ↷'}</button>`
          : '';
        const unassignButton = group ? `<button type="button" class="unassign-section" data-act="unassign" title="將歌曲移出目前段落">移出段落</button>` : '';
        row.innerHTML = `<span class="num">${num}</span><div><div class="songname"><span class="songtitle" role="button" tabindex="0" title="雙擊編輯歌名（只存此瀏覽器）">${esc(s.title)}</span>${badge}</div>${connectionMark}${sub}<div class="song-row-tools">${previousSegueButton}${nextSegueButton}${unassignButton}</div></div><div class="songbuttons"><button data-act="more" class="more" aria-label="${esc(s.title)}段落與銜接" aria-expanded="${toolsOpen.has(n)}" title="段落／銜接">⋯</button>${del}</div>`;
        const detailEl = row.querySelector('.editable-song-note');
        if (detailEl) {
          const sourceDetail = s.instrumentationNote || '';
          const finishDetailEdit = (cancel = false) => {
            const next = cancel ? detailEl.dataset.original : detailEl.textContent.trim();
            detailEl.contentEditable = 'false';
            detailEl.setAttribute('role', 'button');
            detailEl.removeAttribute('aria-multiline');
            detailEl.textContent = cancel ? detailEl.dataset.original : next;
            detailEl.classList.toggle('is-empty', !detailEl.textContent.trim());
            if (!cancel && next !== sourceDetail) detailOverrides[n] = next;
            else delete detailOverrides[n];
            try { localStorage.setItem(DETAILS_KEY, JSON.stringify(detailOverrides)); } catch {}
            delete detailEl.dataset.original;
          };
          const beginDetailEdit = () => {
            if (detailEl.isContentEditable) return;
            detailEl.dataset.original = detailEl.textContent;
            detailEl.contentEditable = 'true';
            detailEl.setAttribute('role', 'textbox');
            detailEl.setAttribute('aria-multiline', 'false');
            detailEl.focus();
            const selection = getSelection(), range = document.createRange();
            range.selectNodeContents(detailEl);
            selection.removeAllRanges();
            selection.addRange(range);
          };
          detailEl.addEventListener('click', (e) => e.stopPropagation());
          detailEl.addEventListener('input', () => detailEl.classList.toggle('is-empty', !detailEl.textContent.trim()));
          detailEl.addEventListener('dblclick', (e) => { e.stopPropagation(); beginDetailEdit(); });
          detailEl.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && !detailEl.isContentEditable) { e.preventDefault(); beginDetailEdit(); }
            else if (e.key === 'Enter' && detailEl.isContentEditable) { e.preventDefault(); detailEl.blur(); }
            else if (e.key === 'Escape' && detailEl.isContentEditable) { e.preventDefault(); finishDetailEdit(true); }
          });
          detailEl.addEventListener('blur', () => { if (detailEl.isContentEditable) finishDetailEdit(); });
        }
        const titleEl = row.querySelector('.songtitle');
        const finishTitleEdit = (cancel = false) => {
          const next = cancel ? titleEl.dataset.original : titleEl.textContent.trim();
          titleEl.contentEditable = 'false';
          titleEl.setAttribute('role', 'button');
          titleEl.removeAttribute('aria-multiline');
          if (!next) {
            titleEl.textContent = s.title;
            return;
          }
          titleEl.textContent = next;
          if (!cancel && next !== s.title) {
            const source = sourceTitles.get(n) || s.sourceTitle || s.title;
            s.title = next;
            if (next === source) delete titleOverrides[n];
            else titleOverrides[n] = next;
            try {
              localStorage.setItem(TITLES_KEY, JSON.stringify(titleOverrides));
            } catch {}
            renderSongs();
            renderLibrary();
            renderAssigned();
            if (active === n) {
              document.querySelector('#nowTitle').textContent = n + ' · ' + s.title;
              document.querySelector('#npTitle').textContent = n + ' · ' + s.title;
              renderPanes(s);
            }
            if (window.StageView) StageView.renderTimeline();
          }
          delete titleEl.dataset.original;
        };
        const beginTitleEdit = () => {
          if (titleEl.isContentEditable) return;
          titleEl.dataset.original = s.title;
          titleEl.contentEditable = 'true';
          titleEl.setAttribute('role', 'textbox');
          titleEl.setAttribute('aria-multiline', 'false');
          titleEl.focus();
          const selection = getSelection();
          const range = document.createRange();
          range.selectNodeContents(titleEl);
          selection.removeAllRanges();
          selection.addRange(range);
        };
        let titleClickTimer;
        titleEl.addEventListener('click', (e) => {
          e.stopPropagation();
          if (titleEl.isContentEditable) return;
          clearTimeout(titleClickTimer);
          if (e.detail > 1) {
            beginTitleEdit();
            return;
          }
          titleClickTimer = setTimeout(() => setActive(n, true), 260);
        });
        titleEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          beginTitleEdit();
        });
        titleEl.addEventListener('keydown', (e) => {
          if (e.key === 'Enter' && !titleEl.isContentEditable) {
            e.preventDefault();
            beginTitleEdit();
          } else if (e.key === 'Enter' && titleEl.isContentEditable) {
            e.preventDefault();
            titleEl.blur();
          } else if (e.key === 'Escape' && titleEl.isContentEditable) {
            e.preventDefault();
            finishTitleEdit(true);
          }
        });
        titleEl.addEventListener('blur', () => {
          if (titleEl.isContentEditable) finishTitleEdit();
        });
        row.addEventListener('keydown', (e) => {
          if ((e.key === 'Enter' || e.key === ' ') && e.target === row) {
            e.preventDefault();
            setActive(n, true);
          } else if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown') && e.target === row) {
            // 鍵盤改歌序：Alt＋↑／↓（滑鼠就直接拖）
            e.preventDefault();
            const to = i + (e.key === 'ArrowUp' ? -1 : 1);
            if (to >= 0 && to < state.order.length) {
              [state.order[i], state.order[to]] = [state.order[to], state.order[i]];
              if (save()) toast('歌序已自動保存。');
              renderSongs();
              const moved = songRoot.querySelector(`.song[data-num="${CSS.escape(String(n))}"]`);
              if (moved) moved.focus();
            }
          }
        });
        row.addEventListener('click', (e) => {
          const a = e.target.dataset.act;
          if (a === 'segue') {
            e.stopPropagation();
            const key = segueKey(e.target.dataset.from, e.target.dataset.to);
            if (segues.includes(key)) segues = segues.filter((p) => p !== key);
            else segues.push(key);
            saveSegues();
            renderSongs();
          } else if (a === 'del') {
            e.stopPropagation();
            if (s.userFile) IDB.del('songs', n);
            else writeTracks(readTracks().filter((t) => t.number !== n));
            songs.splice(songs.findIndex((x) => x.number === n), 1);
            defaultOrder.splice(defaultOrder.indexOf(n), 1);
            state.order = state.order.filter((x) => x !== n);
            delete state.clips[n];
            delete sectionState.assignments[n];
            segues = segues.filter((p) => !p.endsWith('→' + String(n)) && !p.startsWith(String(n) + '→'));
            saveSections();
            saveSegues();
            delete titleOverrides[n];
            sourceTitles.delete(n);
            try {
              localStorage.setItem(TITLES_KEY, JSON.stringify(titleOverrides));
            } catch {}
            save();
            if (active === n) setActive(state.order[0]);
            else renderSongs();
          } else if (a === 'unassign') {
            e.stopPropagation();
            delete sectionState.assignments[n];
            saveSections();
            renderSongs();
          } else if (a === 'more') {
            e.stopPropagation();
            if (toolsOpen.has(n)) toolsOpen.delete(n);
            else toolsOpen.add(n);
            renderSongs();
          } else setActive(n, true);
        });
        row.addEventListener('dragstart', (e) => {
          dragSong = n;
          dragSection = null;
          e.dataTransfer.setData('text/song', n);
          row.classList.add('dragging');
        });
        row.addEventListener('dragend', () => {
          row.classList.remove('dragging');
          dragSong = null;
        });
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
          if (dragSection) {
            // 整段拖：目標歌屬於同一段落就忽略
            if (sectionState.assignments[n] !== dragSection) moveBlockBefore(dragSection, n);
            saveSections();
            if (save()) toast('段落及歌序已自動保存。');
            renderSongs();
            return;
          }
          const from = state.order.indexOf(dragSong),
            to = state.order.indexOf(n);
          if (from >= 0 && to >= 0 && from !== to) {
            state.order.splice(to, 0, state.order.splice(from, 1)[0]);
            if (group) sectionState.assignments[dragSong] = group.id;
            else delete sectionState.assignments[dragSong];
            saveSections();
            if (save()) toast('歌序已自動保存。');
            renderSongs();
          }
        });
        songRoot.append(row);
        previousGroup = group ? group.id : null;
        if (!group) groupRunStart = null;
      }
      // 空段落（未有歌）：喺歌單最底顯示標題，畀用家拖歌入去
      for (const g of sectionState.groups) if (!firstOfGroup(g.id)) appendHeading(g, g.id + ':empty');
      const activeSongs = songs.filter((s) => !s.archived),
        archivedCount = songs.filter((s) => s.archived).length,
        withLoop = state.order.filter((n) => !song(n).archived && (state.clips[n] || []).length).length,
        nTracks = activeSongs.filter((s) => s.track).length;
      document.querySelector('#loopCount').textContent =
        withLoop + ' / ' + (activeSongs.length - nTracks) + ' 首已有 loop' + (nTracks ? ' · ' + nTracks + ' 首 Suno／Spotify' : '');
      document.querySelector('.panelhead h2').textContent = activeSongs.length + ' 首歌曲' + (archivedCount ? ` · ${archivedCount} 首 Archive` : '');
    }
    // ＋加歌：貼 Suno／Spotify 連結入歌單（即時加入、即時揀、冇 reload）
    const trackForm = document.querySelector('#trackForm'),
      trackAddBtn = document.querySelector('#trackAdd');
    if (trackForm && trackAddBtn) {
      const turl = trackForm.querySelector('[name=url]'),
        ttitle = trackForm.querySelector('[name=title]'),
        terr = trackForm.querySelector('.trackerr');
      trackAddBtn.onclick = () => {
        trackForm.hidden = !trackForm.hidden;
        trackAddBtn.setAttribute('aria-expanded', String(!trackForm.hidden));
        if (!trackForm.hidden) turl.focus();
      };
      const tfile = trackForm.querySelector('[name=file]');
      const addSong = (s) => {
        songs.push(s);
        sourceTitles.set(s.number, s.title);
        defaultOrder.push(s.number);
        state.order.push(s.number);
        state.clips[s.number] = [];
        save();
        terr.textContent = '';
        trackForm.reset();
        trackForm.hidden = true;
        trackAddBtn.setAttribute('aria-expanded', 'false');
        setActive(s.number);
      };
      trackForm.onsubmit = async (e) => {
        e.preventDefault();
        const file = tfile && tfile.files[0];
        if (file) {
          const nf = Math.max(0, ...songs.map((s) => /^F(\d+)$/.exec(String(s.number))).filter(Boolean).map((m) => +m[1])) + 1,
            rec = { number: 'F' + nf, title: ttitle.value.trim() || file.name.replace(/\.[^.]+$/, ''), blob: file };
          try {
            await IDB.put('songs', rec);
          } catch {
            terr.textContent = '瀏覽器唔俾存呢個檔（空間唔夠或私隱模式）；今次先加入，reload 後會消失。';
          }
          addSong(fileSong(rec));
          return;
        }
        const url = turl.value.trim(),
          p = EMBED.parse(url);
        if (!url) {
          terr.textContent = '貼 Suno／Spotify 連結，或者揀一個本機音訊檔。';
          return;
        }
        if (!p) {
          terr.textContent = '連結唔啱：只收 suno.com／open.spotify.com 嘅歌曲、專輯或 playlist 連結。';
          return;
        }
        const next = Math.max(0, ...songs.map((s) => /^T(\d+)$/.exec(String(s.number))).filter(Boolean).map((m) => +m[1])) + 1,
          t = { number: 'T' + next, url, title: ttitle.value.trim() || TRACK_NAME[p.provider] + ' 歌曲' };
        writeTracks([...readTracks(), t]);
        songs.push(userTrackSong(t));
        defaultOrder.push(t.number);
        state.order.push(t.number);
        state.clips[t.number] = [];
        save();
        terr.textContent = '';
        trackForm.reset();
        trackForm.hidden = true;
        trackAddBtn.setAttribute('aria-expanded', 'false');
        setActive(t.number);
      };
    }
    // ＋加影片：揀本機影片入素材庫（存喺瀏覽器 IndexedDB），之後同其他 loop 一樣撳 ＋ 配入歌曲
    function makeThumb(file) {
      return new Promise((res) => {
        const v = document.createElement('video'),
          u = URL.createObjectURL(file),
          done = (d) => {
            URL.revokeObjectURL(u);
            res(d || '');
          };
        v.muted = true;
        v.preload = 'auto';
        v.onloadeddata = () => {
          v.currentTime = Math.min(0.2, (v.duration || 1) / 2);
        };
        v.onseeked = () => {
          try {
            const c = document.createElement('canvas');
            c.width = 320;
            c.height = Math.round((320 * (v.videoHeight || 9)) / (v.videoWidth || 16));
            c.getContext('2d').drawImage(v, 0, 0, c.width, c.height);
            done(c.toDataURL('image/jpeg', 0.7));
          } catch {
            done('');
          }
        };
        v.onerror = () => done('');
        setTimeout(() => done(''), 5000);
        v.src = u;
      });
    }
    const vAddBtn = document.querySelector('#videoAdd'),
      vFile = document.querySelector('#videoFile');
    if (vAddBtn && vFile) {
      vAddBtn.onclick = () => vFile.click();
      vFile.onchange = async () => {
        let failed = 0;
        for (const f of [...vFile.files]) {
          const rec = { id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6), name: f.name, blob: f, thumb: await makeThumb(f) };
          try {
            await IDB.put('videos', rec);
          } catch {
            failed++;
          }
          videos.push(fileVideo(rec));
        }
        vFile.value = '';
        document.querySelector('#status').textContent = failed ? '有影片存唔入瀏覽器（空間唔夠），reload 後會消失。' : '已加入素材庫：撳縮圖播放，撳 ＋ 配入目前歌曲。';
        renderLibrary();
      };
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
    function setActive(n, autoplay = false) {
      active = n;
      stopPreview('已切換歌曲；舊影片預覽已卸載。');
      renderSongs();
      renderLibrary();
      renderAssigned();
      document.querySelector('#nowTitle').textContent = n + ' · ' + song(n).title;
      document.querySelector('#npTitle').textContent = n + ' · ' + song(n).title;
      document.querySelector('#npSub').textContent = song(n).track ? TRACK_NAME[(EMBED.parse(trackUrl(song(n))) || {}).provider] + ' 內嵌播放器：用上面嘅播放掣' : song(n).credit || '歌曲排練音訊';
      document.querySelector('#nowMeta').textContent = [song(n).credit, song(n).section].filter(Boolean).join(' · ');
      const sel = songRoot.querySelector('.song.selected');
      if (sel) sel.scrollIntoView({ block: 'nearest' });
      const s = song(n);
      renderVersions(s);
      renderPanes(s);
      // 呢首歌有配 loop：預設自動播第一條（靜音，投影幕／影片窗即刻有畫面）
      const firstLoop = (state.clips[n] || []).map(clip).find(Boolean);
      if (firstLoop && (view.video || view.three)) playClip(firstLoop);
      if (autoplay) {
        // 連播唔可以跳入內嵌版本：目前選擇係 embed 就回退主 demo 播音訊
        const av = songVersions(s);
        const ai = Math.min(versionSel[s.number] || 0, Math.max(av.length - 1, 0));
        if (av[ai] && av[ai].embed) {
          versionSel[s.number] = 0;
          renderVersions(s);
        }
        if (audio.getAttribute('src')) {
          if (audio.readyState > 0) audio.currentTime = 0;
          audio.play().catch(() => toast('歌曲未能自動播放；請按播放掣重試。'));
        } else if (!s.track) {
          toast('此歌未有音檔；如有配對影片，影片會播放。');
        }
      }
    }
    // 顯示內容：影片／舞台／歌詞／譜 可以自由組合開關，素材庫可收埋令中欄更闊
    const VIEW_KEY = 'flowboard-view-v1';
    const view = {"video":true,"stage":false,"timeline":false,"three":false,"lyrics":false,"charts":false,"library":true,"dock":"full"};
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
      view.hideSongs = want.includes('nosongs'); // #show=…,nosongs：收埋左邊歌單
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
      CHART = { form: 'Form', lead: 'Lead', full: 'Lead', bv: 'BV', vn1: 'Vn 1', vn2: 'Vn 2', va: 'Va', vc: 'Vc' };
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
      let shown = Object.keys(PANES).filter((k) => k !== 'timeline' && has[k] && view[k]);   // 時間線喺右欄，唔入中間格仔
      const showTl = !!(view.timeline && has.timeline);
      // 譜唔入格仔：喺中欄下面獨立一層，可拖高低，聽歌同睇譜可以同時
      const showScore = shown.includes('charts');
      shown = shown.filter((k) => k !== 'charts');
      // 全部收埋（或舞台資料未載入）時顯示影片，但唔改用戶嘅設定；譜開住就容許淨係睇譜（影片可以收埋）
      // 例外：用家開咗舞台／3D／歌詞但冇資料顯示唔到，先退返顯示影片；用家自己將影片收埋就尊重（中間留空 + 提示）
      // Suno／Spotify 歌冇影片畫面：同舞台一齊開時唔留空白影片格，畀舞台用晒位
      const noPicture = !!s.track || !(state.clips[s.number] || []).length;
      if (noPicture && shown.length > 1) shown = shown.filter((k) => k !== 'video');
      // 冇 loop 嘅歌只開咗影片格：改顯示舞台（唔改用家設定），唔好留一個黑畫面
      if (noPicture && shown.length === 1 && shown[0] === 'video' && has.stage && !showScore) shown = ['stage'];
      const wantedMissing = ['stage', 'three', 'lyrics'].some((k) => view[k]);
      if (!shown.length && !showScore && wantedMissing) shown = ['video'];
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
        const pressed = k === 'charts' ? showScore : k === 'timeline' ? showTl : k === 'stage' ? shown.includes('stage') || shown.includes('three') : shown.includes(k);
        b.setAttribute('aria-pressed', String(pressed));
        b.onclick = () => {
          if (k === 'stage') {
            // 舞台＝2D／3D／2D+3D 一個掣；入面揀視圖，收埋再開會記得上次視圖
            if (view.stage || view.three) {
              view.lastMode = view.three && view.stage ? 'both' : view.three ? '3d' : '2d';
              view.stage = false;
              view.three = false;
            } else {
              const m = has.three ? view.lastMode || '2d' : '2d';
              view.stage = m !== '3d';
              view.three = m === '3d' || m === 'both';
            }
          } else view[k] = !view[k];
          saveView();
          renderPanes(song(active));
        };
      });
      const panels = document.querySelector('#panels');
      panels.dataset.count = String(shown.length);
      panels.dataset.only = shown.length === 1 ? shown[0] : '';
      // 影片同舞台（2D／3D）一齊顯示時，舞台放喺影片下面（上下排），唔好左右併排
      panels.dataset.stack = shown.length === 2 && shown.includes('video') ? 'video-top' : '';
      document.querySelector('#app').dataset.library = view.library || showTl ? 'on' : 'off';
      document.querySelector('#app').dataset.songs = view.hideSongs ? 'off' : 'on';
      const songsBtnEl = document.querySelector('#songsBtn'); // 左邊歌單開關（舊快取 index.html 冇就跳過）
      if (songsBtnEl) songsBtnEl.setAttribute('aria-pressed', String(!view.hideSongs));
      // flow.hideDockWithoutVideo：冇 loop 嘅 show（例如 M+）關閉影片視圖就收埋下欄；有 loop 嘅 show 下欄一直可用
      const dockOff = HIDE_DOCK_NO_VIDEO && !view.video && !shown.includes('three'); // 3D 要用投影幕，所以 3D 開住下欄照留
      document.querySelector('#dock').hidden = dockOff;
      document.querySelector('#dockToggle').hidden = dockOff;
      const dockBtnEl = document.querySelector('#dockBtn');
      if (dockBtnEl) dockBtnEl.hidden = dockOff;
      panels.hidden = !shown.length; // 淨係睇譜：中間格仔收埋，譜佔晒位
      document.querySelector('.center').dataset.solo = !shown.length && showScore ? 'score' : '';
      let hint = document.querySelector('#emptyHint');
      if (!hint) {
        hint = document.createElement('div');
        hint.id = 'emptyHint';
        hint.className = 'emptyhint';
        hint.textContent = '影片已收埋 · 撳上面「影片」再開（亦可開舞台、譜）';
        panels.after(hint);
      }
      hint.hidden = !!shown.length || showScore;
      document.querySelector('#tlpanel').hidden = !showTl;
      const libp = document.querySelector('#libpanel'),
        libT = document.querySelector('#libToggle');
      libp.hidden = !view.library;
      libp.dataset.collapsed = String(!!view.libCollapsed);
      libT.textContent = view.libCollapsed ? '▸' : '▾';
      libT.setAttribute('aria-expanded', String(!view.libCollapsed));
      libT.setAttribute('aria-label', view.libCollapsed ? '展開素材庫' : '收埋素材庫');
      libT.onclick = () => {
        view.libCollapsed = !view.libCollapsed;
        saveView();
        renderPanes(song(active), true);
      };
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
      if (showTl) StageView.renderTimeline();
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
        // 並排：Lead 同 BV（多過一份譜）左右同時睇；單撳返其中一份就退出並排
        const split = !!view.chartSplit && ch.length > 1;
        ch.forEach(([k]) =>
          bar.append(chip(CHART[k] || k, !split && k === chartKey, () => { chartKey = k; view.chartSplit = false; saveView(); renderPanes(s); })),
        );
        if (ch.length > 1) {
          const sp = chip('並排', split, () => { view.chartSplit = !split; saveView(); renderPanes(s); });
          sp.id = 'chartSplit';
          sp.title = '同時並排顯示 ' + ch.map(([k]) => CHART[k] || k).join(' 同 ');
          bar.append(sp);
        }
        const a = document.createElement('a');
        a.href = path;
        a.target = '_blank';
        a.rel = 'noopener';
        a.textContent = '新分頁開啟 ↗';
        a.hidden = split;
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
        if (split) {
          const pair = document.createElement('div');
          pair.className = 'docpair';
          ch.forEach(([k, pth]) => {
            const side = document.createElement('div'),
              lab = document.createElement('a'),
              fr = document.createElement('iframe');
            side.className = 'docside';
            lab.className = 'docsidelab';
            lab.href = pth;
            lab.target = '_blank';
            lab.rel = 'noopener';
            lab.textContent = (CHART[k] || k) + ' ↗';
            fr.className = 'docframe';
            fr.title = (CHART[k] || k) + ' 譜';
            fr.src = pth + '#zoom=page-width';
            side.append(lab, fr);
            pair.append(side);
          });
          cp.append(pair);
          return;
        }
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
        SKEY = 'flowboard-score-h-v1';
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
      const dockBtnEl = document.querySelector('#dockBtn'); // 視圖列嘅「Loop 欄」掣（舊快取 index.html 冇就跳過）
      if (dockBtnEl) dockBtnEl.setAttribute('aria-pressed', String(!min));
    }
    // 底部播放列高度 → --bar-h（版面同 toast 都靠呢個變數避開播放列）
    const playerbar = document.querySelector('#playerbar');
    if (playerbar && window.ResizeObserver) {
      new ResizeObserver(() =>
        document.documentElement.style.setProperty('--bar-h', playerbar.offsetHeight + 'px'),
      ).observe(playerbar);
    }
    const toggleDock = () => {
      view.dock = view.dock === 'min' ? 'full' : 'min';
      saveView();
      applyDock();
    };
    dockToggle.onclick = toggleDock;
    const songsBtnInit = document.querySelector('#songsBtn');
    if (songsBtnInit)
      songsBtnInit.onclick = () => {
        view.hideSongs = !view.hideSongs;
        saveView();
        renderPanes(song(active));
      };
    const dockBtnInit = document.querySelector('#dockBtn');
    if (dockBtnInit) dockBtnInit.onclick = toggleDock;
    syncVol();
    syncPlayer();
    applyDock();
    // ---- 內嵌播放（Suno／Spotify）：iframe 只喺揀 embed 版本時先建立，轉版本／轉歌就移除 ----
    const embedRow = document.querySelector('#embedRow'); // null guard：舊快取 index.html 冇呢個 id
    let embedFrame = null;
    function showEmbedFrame(embed, title) {
      if (!embedRow) return;
      if (embedFrame) {
        embedFrame.remove();
        embedFrame = null;
      }
      embedFrame = document.createElement('iframe');
      embedFrame.className = 'embedframe ' + (embed.provider || '');
      embedFrame.title = title;
      embedFrame.allow = 'autoplay; encrypted-media; clipboard-write';
      embedFrame.sandbox = 'allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms allow-presentation';   // Spotify 登入視窗要脫離 sandbox 先行得通
      embedFrame.referrerPolicy = 'strict-origin-when-cross-origin';
      embedFrame.loading = 'lazy';
      embedFrame.src = embed.iframe;
      embedRow.append(embedFrame);
      embedRow.hidden = false;
    }
    function hideEmbedFrame() {
      if (embedFrame) {
        embedFrame.remove();
        embedFrame = null;
      }
      if (embedRow) embedRow.hidden = true;
    }
    function songVersions(s) {
      if (s.track) {
        const p = EMBED.parse(trackUrl(s));
        return p ? [{ label: p.provider, embed: p }] : [];
      }
      if (!s.demo) return [];
      const list = [{ label: s.demoLabel || 'demo', src: s.demo }];
      (s.alternates || []).forEach((a) => {
        if (a && typeof a === 'object' && 'embed' in a) {
          const raw = a.embed && typeof a.embed === 'object' ? a.embed.url : typeof a.embed === 'string' ? a.embed : null;
          const p = EMBED.parse(raw);
          if (!p) {
            console.warn('[embed] 版本 "' + (a.label || '?') + '" 無法解析 URL，唔顯示：' + (raw || a.embed || ''));
            return;
          }
          list.push({ label: a.label || 'embed', embed: p });
          return;
        }
        list.push(a);
      });
      return list;
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
      const cur = list[idx];
      // 歌單入面嘅 Suno／Spotify 歌：內嵌播放器就係播放器，收埋我哋自己嗰條播放列
      const pbar = document.querySelector('#playerbar');
      if (pbar) pbar.classList.toggle('trackmode', !!s.track);
      const hint = document.querySelector('#embedRow .embedhint');
      if (hint) {
        const warn = !!(cur && cur.embed && cur.embed.provider === 'suno' && !window.isSecureContext);
        hint.classList.toggle('warn', warn);
        hint.textContent = warn ? 'Suno 內嵌播放器要 https 頁面先播到（而家係 http，會顯示 0:00）。請用 https 網址或 localhost 開。' : '內嵌播放唔同步時間線';
      }
      if (cur && cur.embed) {
        // 內嵌播放：本地音訊／影片暫停；時間線／3D 播放頭保持靜止（提示喺 embed 列）
        audio.pause();
        vplayer.pause();
        audio.removeAttribute('src');
        audio.load();
        showEmbedFrame(cur.embed, (cur.label || '') + ' 內嵌播放器');
      } else if (list.length) {
        hideEmbedFrame();
        const src = list[idx].src;
        if (audio.getAttribute('src') !== src) {
          audio.src = src;
          audio.load();
        }
      } else {
        hideEmbedFrame();
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
      const mine = videos.filter((v) => !used.has(v.fileId) && v.userAdded);
      if (mine.length) groups.push({ title: '我加嘅影片 · ' + mine.length + ' clips', items: mine });
      const rest = videos.filter((v) => !used.has(v.fileId) && !v.userAdded);
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
        `<img loading="lazy" src="${v.thumb ? v.thumb : 'source-materials/thumbnails/' + encodeURIComponent(v.fileId) + '.jpg'}" alt="${esc(v.filename)} 縮圖">` +
        (v.userAdded ? `<button class="clipdel" aria-label="移除 ${esc(v.filename)}" title="移除（只喺呢個瀏覽器）">✕</button>` : '') +
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
      tile.querySelector('.clipadd').onclick = (e) => {
        e.stopPropagation();
        assign(active, v.fileId);
      };
      const delBtn = tile.querySelector('.clipdel');
      if (delBtn)
        delBtn.onclick = (e) => {
          e.stopPropagation();
          IDB.del('videos', v.idbId);
          videos.splice(videos.indexOf(v), 1);
          for (const k of Object.keys(state.clips)) state.clips[k] = state.clips[k].filter((id) => id !== v.fileId);
          if (selectedVideo === v.fileId) stopPreview('已移除影片。');
          save();
          renderLibrary();
          renderAssigned();
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
    const proxySrc = (v) => v.localSrc || 'media/loops/' + encodeURIComponent(v.fileId) + '.mp4';
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
        if (v.localSrc) {
          document.querySelector('#status').textContent = '呢個影片播唔到（瀏覽器唔支援呢個格式？）。';
          return;
        }
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
    // 連播：預設開；播完自動接下一首。關閉後只停低，設定存 localStorage。
    const AUTONEXT_KEY = 'flowboard-autonext-v1';
    let autoNext = true;
    try {
      autoNext = localStorage.getItem(AUTONEXT_KEY) !== 'off';
    } catch (e) {}
    const autoNextBtn = document.querySelector('#autoNext');
    function paintAutoNext() {
      autoNextBtn.setAttribute('aria-pressed', String(autoNext));
      autoNextBtn.title = autoNext ? '連播開：播完自動播下一首（撳一下關閉）' : '連播關：播完停低（撳一下開啟）';
    }
    autoNextBtn.onclick = () => {
      autoNext = !autoNext;
      try {
        localStorage.setItem(AUTONEXT_KEY, autoNext ? 'on' : 'off');
      } catch (e) {}
      paintAutoNext();
    };
    paintAutoNext();
    audio.addEventListener('ended', () => {
      vplayer.pause();
      if (!autoNext) return;
      const index = state.order.indexOf(active);
      if (index >= 0 && index + 1 < state.order.length) setActive(state.order[index + 1], true);
    });
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
          : '此歌未配 loop；將素材庫影片拖入呢度，或點縮圖右上角「＋」。';
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
      for (const s of songs)
        clips[s.number] = videos
          .filter(
            (v) =>
              v.songNumbers.includes(s.number) &&
              (v.matchType === 'exact-title' || v.matchType === 'visual-name-candidate'),
          )
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
      if (i > 0) setActive(state.order[i - 1], true);
    };
    document.querySelector('#nextSong').onclick = () => {
      const i = state.order.indexOf(active);
      if (i < state.order.length - 1) setActive(state.order[i + 1], true);
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
