# Changelog

## Unreleased

- New logo: a rounded stage frame with a terracotta brush stroke flowing through it, in the board's own accent colour; light and dark versions, a favicon, and a new social preview image.
- Sample audio is now instrumental tracks generated with Lyria RealTime (prompts in `tools/sample-audio-prompts.md`), with original sample lyrics. No Suno files or private Suno links in the repository; paste your own Suno or Spotify link with `+ Add song`.
- 3D view: one `2D`/`3D` switch instead of three mode buttons; the `聚焦` button and the sample caption are gone; the stop-video button is an icon.
- Musicians: outfit presets and custom colours (`服裝`); each musician faces their instrument (the vocalist faces the audience); no floating hands when a player is off stage. New `qa/figures.mjs` checks this for every section.
- Lighting: dots show only for the zone or light you are editing; lights split into depth zones (`燈區`); `heightLift` in `lighting/mvr-map.json` raises hung fixtures to the screen top and the 3D view draws hanging rods. Four generated looks (`capture-look-*.mvr`) carry colour and level.
- Sample charts are lead sheets (melody, chords, form) instead of form charts.
- Lighting files: dots mark each light, per-light controls (on, colour, level), and a `檔案原狀` look that uses the colour and dimmer stored in the `.mvr`. A file with only positions loads with the lights off and says so.
- Load `.mvr` lighting files in the board: pick from the `lighting/` folder or choose a file from your computer. New `lighting/` folder (all `.mvr`, the alignment map and `index.json`), `tools/mvr-index.py`, and two generated sample rigs.
- Renamed from cuesheet-board to **Flowboard**. Browser storage keys change with the name, so a saved layout from the old name is not carried over.
- Removed the Night rock sample loop; added moody sample loops.
- Add songs from an audio file (mp3, wav, m4a, flac), stored in the browser.
- Add your own videos to the loop library, with a first-frame thumbnail.
- Suno and Spotify rows in the set list, with a `SUNO` or `SPOTIFY` mark; compact player (80 to 96 px) instead of a large embed.
- Spotify embed lets the login window open; Suno shows a note when the page is not on `https://` or `localhost`.
- Venue picker: black box, jazz club, concert hall, open stage; a list in the stage bar when there are more than three venues.
- Stage view fits the middle column without extra scroll bars; songs without a loop no longer show an empty video box.
- `tools/add-venues.py` builds the extra venues from the first stage plan.
- Branding: logo, social preview, CONTRIBUTING, TRADEMARKS.

## 0.1.0

- First public sample: per-section 2D plan, 3D lighting preview, timeline, loops, lyrics, charts, one-click report, MVR lighting rig import, phone layout.
