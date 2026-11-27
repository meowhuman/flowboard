<p align="center"><picture><source media="(prefers-color-scheme: dark)" srcset="docs/logo-dark.svg"><img src="docs/logo.svg" alt="Flowboard, a Mono Labs tool" width="420"></picture></p>

<p align="center"><strong>Prepare your show song by song: stage plan, solos and lighting for every section.</strong></p>

<p align="center">
  <a href="https://flowboard-sample.netlify.app/">Live sample</a> ·
  <a href="#try-it">Run it</a> ·
  <a href="#use-your-own-set">Use your own set</a> ·
  <a href="CONTRIBUTING.md">Contribute</a> ·
  <a href="CHANGELOG.md">Changelog</a>
</p>

<p align="center"><img alt="Licence: MIT" src="https://img.shields.io/badge/licence-MIT-c76543"> <img alt="Status: early" src="https://img.shields.io/badge/status-early-aaa49a"> <img alt="No build step" src="https://img.shields.io/badge/build-none-aaa49a"></p>

A browser board for the part of a live set that usually lives in a Word file and a few WhatsApp messages: **who is on stage, who solos, and how it is lit, per song and per section**, tied to the rehearsal audio.

Open it, pick a song, press play. The 2D plan, the 3D lighting preview and the section timeline follow the audio. When the set is ready, tick what you need and export one report for the lighting operator.

> A [Mono Labs](https://github.com/meowhuman) tool. Not related to other projects that happen to be called Flowboard. Built by a working music director for a real festival set, then cleaned up and published with a sample set so you can try it.

![Desktop: song list, the 3D stage with the video loop projected on the screen, and the loop library](docs/board-desktop.png)

## Status

Early and honest:

- It was built for one real show. The engine is generic, the sample set in this repo is not that show.
- The interface text is **Traditional Chinese for now**. An English interface is the first item on the roadmap below.
- No server, no accounts. Everything runs in the browser; your edits, and the songs and videos you add, are kept in this browser only (`localStorage` and IndexedDB).
- The 3D venues are simple generated rooms (a black box with seats, a small club, a hall, an open stage). Loading a modelled venue from Blender is not built yet.

## What it does

- **Per-section staging.** Each song has sections (cues). Each cue says who is on stage, who is soloing, who is highlighted, plus a note for the crew.
- **2D plan and timeline.** Drag items on the plan, scrub the timeline, the playhead jumps between sections.
- **3D lighting preview.** Colour presets, custom colour and strength per light group, three spots that follow soloists, haze. Fixed camera presets, free orbit, audience seat view.
- **Rehearsal audio and video loops.** Several versions per song (for example instrumental and vocal), loops play in sync with the audio.
- **Add songs from the board.** `+ Add song` takes a Suno or Spotify link, or an audio file from your computer (mp3, wav, m4a, flac). Each row carries a small `SUNO`, `SPOTIFY` or `FILE` mark. Links play in a player inside the page; files play in the board's own player. Nothing is uploaded. See [Add songs and videos](#add-songs-and-videos).
- **Add videos from the board.** `+ Add video` puts your own clips in the loop library, where you can play them and assign them to songs.
- **Venue picker.** Each venue is a stage plan with its own stage size, room and light positions. Pick one in the stage bar or the 3D toolbar. See [Venues](#venues).
- **Lighting rig from a lighting designer.** Import an `.mvr` file (My Virtual Rig, exported by Capture, Vectorworks, grandMA3 and others) and the 3D preview uses their fixture positions. See [Import a lighting rig](#import-a-lighting-rig-mvr).
- **Hide the song list** with one button to give the middle column more room.
- **Lyrics and charts** per song, when you provide them.
- **One-click report.** Tick sections (order, matrix, 2D plan, 3D images, timeline, lighting settings, people), pick songs, get a single self-contained HTML file with no scripts and no external links. Print it to PDF from the browser.
- **Phone layout.** The board and the export dialog fit a phone screen.

## Try it

Live sample (unlisted, not indexed): https://flowboard-sample.netlify.app/

Or run it yourself:

```bash
git clone https://github.com/meowhuman/flowboard && cd flowboard
python3 qa/range-server.py 8080 . 127.0.0.1
# open http://127.0.0.1:8080/
```

Any static server works, but it must support HTTP range requests, otherwise audio and video cannot seek. `qa/range-server.py` is a small one that does.

Open the board from `https://` or `localhost`. The Suno player refuses to play on a plain `http://` page with a network address (it needs a secure context), and the board shows a note when that happens.

## What the sample set shows

The sample set exercises every feature, so you can click through them before loading your own set.

| Feature | Where to look |
|---|---|
| Sections and timeline | Pick any song. Song 01 has 7 sections with a lyric-driven timeline |
| 2D plan, solo and highlight | Stage view. Grand Piano and Vocal are placed on the sample stage; the timeline colours show on-stage, solo and highlight |
| 3D lighting with an imported rig | Stage view, the `3D` switch, then the lighting button. The `燈光檔` list in the panel switches between the nine files in `lighting/`: the Capture demo rig (76 fixtures), generated sample rigs, and four `capture-look-*` files that carry colour and level per fixture (Verse, Chorus, Solo, Finale), so you can see a file-supplied look |
| Versions | Song 06 has two audio versions (sparse and full band) behind the version switcher |
| Suno and Spotify tracks | Rows T1 and T2 are Spotify tracks with a small mark; they play inside the board. Try `+ Add song` at the bottom of the list and paste a Suno or Spotify link (a Suno link only plays for others if the song is public) |
| Venues | Stage view: the venue list in the stage bar (2D) or the 3D toolbar: black box, jazz club, concert hall, open stage |
| Loops | Sample video loops (moody, no people) sit in the library on the right. Click one to play it, `+` assigns it to the current song, `+ Add video` adds your own |
| Lyrics and lead sheets | Song 01 has lyrics (original sample text). Every sample song has a generated lead sheet (melody, chords, form) |
| Musician outfits | 3D view, `服裝`: six outfit presets (all black, white shirt, navy suit, wine, vintage, casual) and per-musician colours |
| One-click report | `輸出`, tick sections, get a self-contained HTML file |
| Phone layout | Open it on a phone, or narrow the window to 390 px |

## Add songs and videos

Under the song list, `+ Add song` opens a small form. Give it one of:

- **A Suno or Spotify link.** Optionally a title. It becomes a row with a `SUNO` or `SPOTIFY` mark and plays in a compact player below the board.
- **An audio file.** mp3, wav, m4a or flac. It becomes a row with a `FILE` mark and plays in the board's own player.

The `x` button on a row you added removes it. Links, and songs and videos you add, live in this browser only. Clearing site data removes them.

In the loop library, `+ Add video` takes one or more video files. They appear under "My videos", with a thumbnail made from the first frame. Click to play, `+` to assign to the current song, `x` to remove.

For songs that should always be there, list them in `songs.json`:

```json
{ "number": "T1", "title": "My Suno song", "section": "Suno", "track": { "url": "https://suno.com/song/<uuid>" } }
```

- Only `https`, and only `suno.com` and `open.spotify.com` (song, album, playlist, episode), are accepted as links. Anything else is refused.
- The player is created when you pick the row and removed when you pick another song. Local audio pauses while a track plays.
- Tracks do not take part in auto-next, the timeline playhead or the exported report.
- Suno pages cannot be framed, so the board uses `suno.com/embed/<uuid>`. It needs a secure context: `https://` or `localhost`.
- Spotify plays a 30-second preview unless the browser is logged in to Spotify. Full tracks follow your Spotify account (Premium for full playback); the board never sees your login.
- Suno limits how many songs your account can download each month. Embedding a link does not use that allowance.
- A song can also carry a player as a version chip: add `{ "label": "suno", "embed": { "provider": "suno", "url": "..." } }` to its `alternates`.

![A Suno track in the set list, with the compact player at the bottom](docs/board-tracks.png)

## Venues

When `stage-plans.json` has more than one plan, the 3D toolbar shows a venue list. A plan has its own `stage` (size and screen), optional `room` (walls and optional seats) and optional `lighting` (a rig for that venue).

`tools/add-venues.py` builds the extra venues from the first plan by scaling the instruments, platforms and light positions:

```bash
python3 tools/add-venues.py            # preview: prints the venues, writes nothing
python3 tools/add-venues.py --apply    # writes stage-plans.json (a .bak copy is made first)
```

Venue sizes live in `tools/venues.default.json`. Run it after an MVR import so the lights it scales are the imported ones.

## Load a lighting rig (MVR)

Lighting designers can export their rig as an `.mvr` file. There are two ways to use one:

- **In the board.** Open the 3D view, then the lighting panel. The `燈光檔` list at the top shows every file in the `lighting/` folder, and `揀檔…` loads any `.mvr` from your computer. The board reads the file in your browser (nothing is uploaded), replaces the lights of the current venue, and remembers the choice in this browser.
- **From the command line**, to write a rig into `stage-plans.json` for good (below).

### What the board shows and what it can set

An `.mvr` file is a **rig**: where each light is, which way it points, what model it is. It does not hold the designer's looks or cues; those live in the lighting console or the visualiser. So:

| | |
|---|---|
| **Shown from the file** | Every light's position, height, aim, model and group (wash, back, follow). Small dots mark the lights even when they are off |
| **Shown if the file has it** | The colour and dimmer each light had when the file was exported. The `檔案原狀` look uses them, and is picked automatically |
| **Set on the board** | Per group: colour and level. Per light: on or off, colour, level (pick the light in `單支燈`). Follow spots, haze, looks per preset. Your changes stay in this browser |
| **Not in the board** | Pan, tilt, zoom, gobos, effects, DMX channels, a full cue list. The board is a rehearsal sketch, not a console |

For real looks per song section, ask the designer for a short render of each section and attach it as a loop. A cue sheet import (colour and level per group per section) is on the roadmap.

Save all your `.mvr` files in `lighting/`, then run `python3 tools/mvr-index.py` once. It rebuilds `lighting/index.json`, the list the board reads (a static server cannot list a folder). Edit `title` and `note` in that file by hand if you like. Alignment and grouping for both ways come from `lighting/mvr-map.json`.

### Import from the command line

Lighting designers can export their rig as an `.mvr` file. `tools/mvr-import.py` reads it and fills `lighting.rig.fixtures` in `stage-plans.json`:

```bash
# preview: prints a table and a summary, writes nothing
python3 tools/mvr-import.py lighting/capture_demo_show.mvr
# write it (a .bak copy of stage-plans.json is made first)
python3 tools/mvr-import.py lighting/capture_demo_show.mvr --apply
```

- Alignment and grouping live in `lighting/mvr-map.json`: origin offset, rotation, flips, which fixture models go to the front, back or follow group, and default aim points. Edit that file, run the preview, and check how many fixtures land on the stage.
- Aim comes from the file's focus points when there are any; otherwise from the fixture's direction when it points at the floor; otherwise from the group default. The summary shows which source each fixture used. Check the 3D view after the first import.
- It reads only `GeneralSceneDescription.xml` from the zip, never extracts files, and rejects XML with a DOCTYPE.
- `lighting/` is the folder for all your `.mvr` files. It holds three public test files (MIT, see `lighting/LICENSE-python-mvr.txt`), two generated sample rigs and four generated looks (`tools/make-look-mvrs.py` builds them from `tools/looks.json`; they keep only the XML, no 3D meshes). `capture_demo_show.mvr` is a Capture export with 76 fixtures; the sample stage uses it.

## Use your own set

Everything is data files at the repo root. No build step.

| File | What it holds |
|---|---|
| `songs.json` | The song list. Per song: `number`, `title`, `section`, `credit`, `notes`, `parts`, `demo` (audio path), `demoLabel`, `alternates` (`[{label, src}]` for audio, or `[{label, embed:{provider, url}}]` for a Suno or Spotify player), optional `bpm`, `lyrics` (`{lang: text}`), `charts` (`{key: path}`) |
| `stage-cues.json` | Default cues per song: `{ "cues": { "01": [{ "name", "at", "on", "solo", "hl", "note" }] } }`. `at` is seconds into the audio; `on`, `solo`, `hl` are item ids from the stage plan |
| `stage-plans.json` | The stage plan (items and positions), `partItems` (which instrument codes light up which items), lighting presets and rig, export defaults, page title, header links |
| `source-materials/drive-video-inventory.json` | The video loop list. Files live in `media/loops/<fileId>.mp4`, thumbnails in `source-materials/thumbnails/<fileId>.jpg` |

`tools/make-demo-data.py` shows one way to generate these files from audio: it detects sections from loudness changes (or reads lyric section tags) and writes sample cues per song; `tools/make-leadsheets.py` draws a lead sheet from `tools/leadsheets.json`. The sample cues it produces are placeholders. Edit them to your arrangement in the board; changes are saved in your browser, and the stage panel's Export button saves them as JSON so you can put them back into `stage-cues.json`.

## Why no build step

Flowboard is plain files: clone it, open `index.html`, and it works for a guitarist or a lighting tech, with nothing to install first. That is a deliberate trade-off: there is no tree shaking, no type checking, and updating a vendored library is a manual step in `vendor/`. The gaps a build step would catch are covered by the Playwright suite in `qa/`: 43 smoke checks plus file, lighting and facing sweeps, run with `npm test` locally and on every push. If the code ever grows too large to stay plain, an optional build step will be added for contributors; it will not be made required.

## Using an npm package

`index.html` ships an import map, so browser code can use bare specifiers that resolve to files in the repo: `import * as THREE from 'three'` maps to `./vendor/three/build/three.module.min.js`. To use an npm package, install it and point the import map at it:

```bash
npm install some-lib
```

```html
<script type="importmap">
  { "imports": {
      "three": "./vendor/three/build/three.module.min.js",
      "some-lib": "./node_modules/some-lib/index.js"
  } }
</script>
```

```js
import x from 'some-lib'
```

`node_modules` is not committed. If the package should work in a bare clone, copy the needed files into `vendor/` and point the import map there instead, the same way `three` is vendored.

## Tests

```bash
npm install
npm run serve &        # range-capable static server on :9424
npm test               # Playwright smoke test and the add-songs/videos test
```

`qa/figures.mjs` sweeps every song and section and checks that each musician faces their instrument or the audience and that no held arm floats without its player. `qa/lighting.mjs` checks the lighting file list, loading a file from the folder and from your computer, remembering it per venue, and a broken file. `qa/files.mjs` checks adding an audio file and a video from the board, that they survive a reload and can be removed, and that the middle column has no scroll bars. The smoke test checks: no external network requests, audio and video load, lyrics, charts and timeline render, the 3D view mounts with the imported rig and the lighting presets light fixtures, Suno and Spotify rows play in a player that appears and is removed again, pasting a link adds a row (the iframe target is faked, so no network is used), the venue list changes the stage and the light positions, the song-list button works, the report exports as a self-contained file, the phone layout does not overflow, and the repository contains no leftover private strings.

## Roadmap

1. English interface (all strings are currently Traditional Chinese).
2. Venue size and seating from `stage-plans.json` instead of a fixed room.
3. One `show.json` instead of four data files.
4. Import lighting cues (colour and level per fixture or group, per song) from a CSV. Fixture positions already import from MVR.
5. Load saved Blender venues (modelled rooms) instead of the generated ones.

See [CONTRIBUTING.md](CONTRIBUTING.md) before opening a pull request. If you run a rehearsal or a show with it, I would like to hear what broke: open an issue.

## Credits and prior art

- [three.js](https://threejs.org) renders the 3D view.
- The `lighting/` test files `basic_fixture.mvr`, `scene_objects.mvr` and `capture_demo_show.mvr` come from [open-stage/python-mvr](https://github.com/open-stage/python-mvr) (MIT).
- Instrument models were generated with TRELLIS.2 and normalised in Blender.
- Free tools that overlap in part: Limelight (3D lighting and cue paperwork), TecRider and Stageplot Pro (stage plots and input lists), BandHelper (setlists and scheduling). Flowboard is aimed at the gap between them: the song-by-song staging and lighting of a whole set, with the audio.

## Licence and name

- **Code: MIT**, see [LICENSE](LICENSE). You may use, change and sell it, and you must keep the copyright notice.
- **Sample media** has separate terms, see [NOTICE](NOTICE).
- **Name and logo are not licensed.** "Flowboard", "Mono Labs" and the logo are the author's marks. A fork or a product built on this code needs its own name and logo, and must not suggest it is the original or endorsed by it. See [TRADEMARKS.md](TRADEMARKS.md).
