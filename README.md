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
- The 3D venues are simple generated rooms (a black box with seats, a small club, a hall, an open stage). Loading a modelled venue from Blender is not built yet.

## What it does

- **Per-section staging.** Each song has sections (cues). Each cue says who is on stage, who is soloing, who is highlighted, plus a note for the crew.
- **2D plan and timeline.** Drag items on the plan, scrub the timeline, the playhead jumps between sections.
- **3D lighting preview.** Colour presets, custom colour and strength per light group, three spots that follow soloists, haze. Fixed camera presets, free orbit, audience seat view.
- **Rehearsal audio and video loops.** Several versions per song (for example instrumental and vocal), loops play in sync with the audio.
- **Suno and Spotify tracks in the set list.** A song row can be a Suno or Spotify track, with a small `SUNO` or `SPOTIFY` mark. It plays in a player inside the page. No pop-up, no download. Paste a link with `+ Add Suno/Spotify song`, or list it in `songs.json`. See [Suno and Spotify tracks](#suno-and-spotify-tracks).
- **Venue picker.** The 3D toolbar has a venue list. Each venue is a stage plan with its own stage size, room and light positions. See [Venues](#venues).
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
| Suno and Spotify tracks | Rows T1 and T2 are Suno songs, T3 and T4 are Spotify tracks. Each has a small mark and plays inside the board. Try `+ Add Suno/Spotify song` at the bottom of the list |
| Venues | Stage view, `僅 3D`, then the venue list in the 3D toolbar: black box, jazz club, concert hall, open stage |
| Loops | Songs have three sample video loops. Pick one in the loop panel |
| Lyrics and form chart | Song 01 has lyrics and a generated form chart |
| One-click report | `輸出`, tick sections, get a self-contained HTML file |
| Phone layout | Open it on a phone, or narrow the window to 390 px |

![Embedded Suno player inside the board](docs/board-embed.png)

## Suno and Spotify tracks

A set list row can be a track played by Suno or Spotify instead of an audio file. Two ways to add one:

- In the board: `+ Add Suno/Spotify song` under the list, paste the link, optionally type a title. It is stored in your browser only, and the `x` button removes it.
- In `songs.json`, for tracks that should always be there:

```json
{ "number": "T1", "title": "My Suno song", "section": "Suno", "track": { "url": "https://suno.com/song/<uuid>" } }
```

- Only `https`, and only `suno.com` and `open.spotify.com` (song, album, playlist, episode), are accepted. Anything else is refused.
- The player is created when you pick the row and removed when you pick another song. Local audio pauses while a track plays.
- Tracks do not take part in auto-next, the timeline playhead or the exported report.
- Suno pages cannot be framed, so the board uses `suno.com/embed/<uuid>`. Spotify shows a 30-second preview to visitors who are not logged in to Spotify.
- Suno limits how many songs your account can download each month. Embedding a link does not use that allowance.
- A song can still carry a player as a version chip: add `{ "label": "suno", "embed": { "provider": "suno", "url": "..." } }` to its `alternates`.

![Embedded Suno player inside the board](docs/board-embed.png)

## Venues

When `stage-plans.json` has more than one plan, the 3D toolbar shows a venue list. A plan has its own `stage` (size and screen), optional `room` (walls and optional seats) and optional `lighting` (a rig for that venue).

`tools/add-venues.py` builds the extra venues from the first plan by scaling the instruments, platforms and light positions:

```bash
python3 tools/add-venues.py            # preview: prints the venues, writes nothing
python3 tools/add-venues.py --apply    # writes stage-plans.json (a .bak copy is made first)
```

Venue sizes live in `tools/venues.default.json`. Run it after an MVR import so the lights it scales are the imported ones.

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

The smoke test checks: no external network requests, audio and video load, lyrics, charts and timeline render, the 3D view mounts with the imported rig and the lighting presets light fixtures, Suno and Spotify rows play in a player that appears and is removed again, pasting a link adds a row (the iframe target is faked, so no network is used), the venue list changes the stage and the light positions, the song-list button works, the report exports as a self-contained file, the phone layout does not overflow, and the repository contains no leftover private strings.

## Roadmap

1. English interface (all strings are currently Traditional Chinese).
2. Venue size and seating from `stage-plans.json` instead of a fixed room.
3. One `show.json` instead of four data files.
4. Import lighting cues (colour and level per fixture or group, per song) from a CSV. Fixture positions already import from MVR.
5. Load saved Blender venues (modelled rooms) instead of the generated ones.

Issues and pull requests are welcome. If you run a rehearsal or a show with it, I would like to hear what broke.

## Credits and prior art

- [three.js](https://threejs.org) renders the 3D view.
- `samples/mvr/` test files come from [open-stage/python-mvr](https://github.com/open-stage/python-mvr) (MIT).
- Instrument models were generated with TRELLIS.2 and normalised in Blender.
- Free tools that overlap in part: Limelight (3D lighting and cue paperwork), TecRider and Stageplot Pro (stage plots and input lists), BandHelper (setlists and scheduling). cuesheet-board is aimed at the gap between them: the song-by-song staging and lighting of a whole set, with the audio.

## Licence

Code: MIT, see `LICENSE`. Sample media has separate terms, see `NOTICE`.
