# cuesheet-board

A browser board for the part of a live set that usually lives in a Word file and a few WhatsApp messages: **who is on stage, who solos, and how it is lit, per song and per section**, tied to the rehearsal audio.

Open it, pick a song, press play. The 2D plan, the 3D lighting preview and the section timeline follow the audio. When the set is ready, tick what you need and export one report for the lighting operator.

> A Mono Labs tool. Built by a working music director for a real festival set, then cleaned up and published with a sample set so you can try it.

![Desktop: loop video, 2D stage plan, section timeline and player](docs/board-desktop.png)

![3D lighting preview with a rig imported from a Capture export (76 fixtures)](docs/board-lighting-mvr.png)

<img src="docs/board-mobile.png" width="300" alt="Phone layout: song list, loops and player">

## Status

Early and honest:

- It was built for one real show. The engine is generic, the sample set in this repo is not that show.
- The interface text is **Traditional Chinese for now**. An English interface is the first item on the roadmap below.
- No server, no accounts. Everything runs in the browser; your edits are kept in `localStorage`.
- The 3D room is one fixed black box. Venue size is not configurable yet.

## What it does

- **Per-section staging.** Each song has sections (cues). Each cue says who is on stage, who is soloing, who is highlighted, plus a note for the crew.
- **2D plan and timeline.** Drag items on the plan, scrub the timeline, the playhead jumps between sections.
- **3D lighting preview.** Colour presets, custom colour and strength per light group, three spots that follow soloists, haze. Fixed camera presets, free orbit, audience seat view.
- **Rehearsal audio and video loops.** Several versions per song (for example instrumental and vocal), loops play in sync with the audio.
- **Embedded Suno and Spotify versions.** A version chip can be a Suno or Spotify player that plays inside the page. No pop-up, no download. See [Embedded versions](#embedded-versions-suno-and-spotify).
- **Lighting rig from a lighting designer.** Import an `.mvr` file (My Virtual Rig, exported by Capture, Vectorworks, grandMA3 and others) and the 3D preview uses their fixture positions. See [Import a lighting rig](#import-a-lighting-rig-mvr).
- **Hide the song list** with one button to give the middle column more room.
- **Lyrics and charts** per song, when you provide them.
- **One-click report.** Tick sections (order, matrix, 2D plan, 3D images, timeline, lighting settings, people), pick songs, get a single self-contained HTML file with no scripts and no external links. Print it to PDF from the browser.
- **Phone layout.** The board and the export dialog fit a phone screen.

## Try it

Live sample (unlisted, not indexed): https://cuesheet-board-demo.netlify.app/

Or run it yourself:

```bash
git clone <this repo> && cd cuesheet-board
python3 qa/range-server.py 8080 . 127.0.0.1
# open http://127.0.0.1:8080/
```

Any static server works, but it must support HTTP range requests, otherwise audio and video cannot seek. `qa/range-server.py` is a small one that does.

## What the sample set shows

The sample set exercises every feature, so you can click through them before loading your own set.

| Feature | Where to look |
|---|---|
| Sections and timeline | Pick any song. Song 01 has 11 sections with a lyric-driven timeline |
| 2D plan, solo and highlight | Stage view. Grand Piano and Vocal are placed on the sample stage; the timeline colours show on-stage, solo and highlight |
| 3D lighting with an imported rig | Stage view, `僅 3D`, then the lighting button. 76 fixtures come from `samples/mvr/capture_demo_show.mvr` |
| Versions | Song 06 has instrumental and vocal audio versions |
| Embedded versions | Songs 01 to 05 each have a `suno` chip that plays the original Suno song inside the board. Songs 02 and 04 also have a `spotify` chip (reference tracks) |
| Loops | Songs have three sample video loops. Pick one in the loop panel |
| Lyrics and form chart | Song 01 has lyrics and a generated form chart |
| One-click report | `輸出`, tick sections, get a self-contained HTML file |
| Phone layout | Open it on a phone, or narrow the window to 390 px |

![Embedded Suno player inside the board](docs/board-embed.png)

## Embedded versions (Suno and Spotify)

Put a player in the version chips instead of an audio file. In `songs.json`:

```json
"alternates": [
  { "label": "suno", "embed": { "provider": "suno", "url": "https://suno.com/song/<uuid>" } },
  { "label": "spotify", "embed": { "provider": "spotify", "url": "https://open.spotify.com/track/<id>" } }
]
```

- Only `https`, and only `suno.com` and `open.spotify.com`, are accepted. Anything else is ignored with a console warning.
- The player is created only when you pick the chip, and removed when you pick another chip or another song. Local audio pauses while an embed plays.
- Embeds do not take part in auto-next, the timeline playhead or the exported report.
- Suno pages cannot be framed, so the board uses `suno.com/embed/<uuid>`. Spotify shows a 30-second preview to visitors who are not logged in to Spotify.
- Suno limits how many songs your account can download each month. Embedding a link does not use that allowance.

## Import a lighting rig (MVR)

Lighting designers can export their rig as an `.mvr` file. `tools/mvr-import.py` reads it and fills `lighting.rig.fixtures` in `stage-plans.json`:

```bash
# preview: prints a table and a summary, writes nothing
python3 tools/mvr-import.py samples/mvr/capture_demo_show.mvr
# write it (a .bak copy of stage-plans.json is made first)
python3 tools/mvr-import.py samples/mvr/capture_demo_show.mvr --apply
```

- Alignment and grouping live in `tools/mvr-map.default.json`: origin offset, rotation, flips, which fixture models go to the front, back or follow group, and default aim points. Edit that file, run the preview, and check how many fixtures land on the stage.
- Aim comes from the file's focus points when there are any; otherwise from the fixture's direction when it points at the floor; otherwise from the group default. The summary shows which source each fixture used. Check the 3D view after the first import.
- It reads only `GeneralSceneDescription.xml` from the zip, never extracts files, and rejects XML with a DOCTYPE.
- `samples/mvr/` holds three public test files (MIT, see its README). `capture_demo_show.mvr` is a Capture export with 76 fixtures; the sample stage uses it.

## Use your own set

Everything is data files at the repo root. No build step.

| File | What it holds |
|---|---|
| `songs.json` | The song list. Per song: `number`, `title`, `section`, `credit`, `notes`, `parts`, `demo` (audio path), `demoLabel`, `alternates` (`[{label, src}]` for audio, or `[{label, embed:{provider, url}}]` for a Suno or Spotify player), optional `bpm`, `lyrics` (`{lang: text}`), `charts` (`{key: path}`) |
| `stage-cues.json` | Default cues per song: `{ "cues": { "01": [{ "name", "at", "on", "solo", "hl", "note" }] } }`. `at` is seconds into the audio; `on`, `solo`, `hl` are item ids from the stage plan |
| `stage-plans.json` | The stage plan (items and positions), `partItems` (which instrument codes light up which items), lighting presets and rig, export defaults, page title, header links |
| `source-materials/drive-video-inventory.json` | The video loop list. Files live in `media/loops/<fileId>.mp4`, thumbnails in `source-materials/thumbnails/<fileId>.jpg` |

`tools/make-demo-data.py` shows one way to generate these files from audio: it detects sections from loudness changes (or reads lyric section tags) and writes sample cues and a form chart per song. The sample cues it produces are placeholders. Edit them to your arrangement in the board; changes are saved in your browser, and the stage panel's Export button saves them as JSON so you can put them back into `stage-cues.json`.

## Tests

```bash
npm install
npm run serve &        # range-capable static server on :9424
npm test               # Playwright smoke test
```

The smoke test checks: no external network requests, audio and video load, lyrics, charts and timeline render, the 3D view mounts with the imported rig and the lighting presets light fixtures, an embedded Suno version appears and is removed again (the iframe target is faked, so no network is used), the song-list button works, the report exports as a self-contained file, the phone layout does not overflow, and the repository contains no leftover private strings.

## Roadmap

1. English interface (all strings are currently Traditional Chinese).
2. Venue size and seating from `stage-plans.json` instead of a fixed room.
3. One `show.json` instead of four data files.
4. Import lighting cues (colour and level per fixture or group, per song) from a CSV. Fixture positions already import from MVR.
5. Load saved Blender venues instead of the fixed black box.

Issues and pull requests are welcome. If you run a rehearsal or a show with it, I would like to hear what broke.

## Credits and prior art

- [three.js](https://threejs.org) renders the 3D view.
- `samples/mvr/` test files come from [open-stage/python-mvr](https://github.com/open-stage/python-mvr) (MIT).
- Instrument models were generated with TRELLIS.2 and normalised in Blender.
- Free tools that overlap in part: Limelight (3D lighting and cue paperwork), TecRider and Stageplot Pro (stage plots and input lists), BandHelper (setlists and scheduling). cuesheet-board is aimed at the gap between them: the song-by-song staging and lighting of a whole set, with the audio.

## Licence

Code: MIT, see `LICENSE`. Sample media has separate terms, see `NOTICE`.
