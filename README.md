# slop-audio-editor

A browser-based multitrack audio editor for voice/narration assembly, quick soundtrack builds, and
general audio scratchwork. Import audio onto tracks, arrange it, trim and cut it, mix it with gain
and fades, and export a mixdown — entirely client-side. No server, no upload: audio never leaves
the browser.

This is not a music production tool. There is no tempo, bar/beat grid, metronome, or quantise —
time is seconds throughout.

## Stack

Svelte 5 (runes mode) + TypeScript + Vite + Tailwind 4, tested with Vitest. Audio decode, playback,
and mixdown are native Web Audio API. Non-WAV export encoding uses
[mediabunny](https://github.com/Vanilagy/mediabunny) + WebCodecs. Project files are zipped with
[fflate](https://github.com/101arrowz/fflate). Deployed as static assets on Cloudflare Workers.

## Running it

```bash
npm install
npm run dev      # Vite dev server
npm test         # Vitest — 273 tests across 27 files
npm run build    # svelte-check && tsc --noEmit && vite build — 0 errors, 0 warnings
npm run deploy   # build, then wrangler deploy
```

## Features

- **Import** local audio files (anything the browser's `decodeAudioData` accepts — mp3, wav, flac,
  m4a, ogg, …) onto tracks, via a file picker or drag-and-drop onto the window.
- **Multiple tracks, multiple clips per track.** Clips on a track never overlap; dropping one onto
  occupied time trims or removes what it lands on.
- **Move, trim, split.** Drag a clip's body to move it or its edges to trim; split every selected
  track at the playhead.
- **Cut a time range**, with or without closing the gap (ripple). Ripple is scoped to the tracks the
  range selection covers, so cutting a flub from the narration never slides the music bed out of
  sync.
- **Copy / cut / paste / duplicate** clips.
- **Per-track and per-clip gain**, mute, and solo. Solo is monitoring only — it is never saved and
  never affects an export.
- **Per-clip fade in/out** with a selectable curve: linear, equal-power, or exponential.
- **Match loudness**, a one-click button that sets every clip's gain so all clips sit at the same
  perceived loudness (ITU-R BS.1770 integrated LUFS, measured once per source at import time, target
  is the median across the project, corrections clamped to ±12 dB). Clips whose source is silent
  are left alone rather than boosted into noise.
- **Glue**, a toolbar toggle that band-limits (100 Hz–7.5 kHz) and gently compresses the master bus
  (3:1, −18 dB threshold, +3 dB makeup gain) to help audio from different sources cohere. It's a
  document setting, so it's saved with the project and applied on export, same as mute.
- **Transport:** play, pause, seek, and loop over a selected time range.
- **Undo / redo**, capped at 100 entries.
- **Waveform display**, zoom (wheel, `+`/`-`, fit-to-window), and edge/playhead snapping (hold
  Shift to disable while dragging).
- **Project save/open** as a self-contained `.slopaudio` file, plus automatic IndexedDB autosave
  that restores your last session on reload.
- **Export a mixdown** of the whole project or the selected time range.

## Keyboard shortcuts

| Key | Action |
|---|---|
| `Space` | Play / pause from the playhead |
| `S` | Split selected tracks at the playhead |
| `⌘X` / `⌘C` / `⌘V` / `⌘D` | Cut / copy / paste / duplicate |
| `Delete` / `Backspace` | Delete selection (clips, or a range leaving a gap) |
| `⇧Delete` | Delete a time-range selection and ripple |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `⌘S` | Save project |
| `←` / `→` | Nudge by 100 ms — the selected clip, or the playhead if nothing is selected |
| `⇧←` / `⇧→` | Nudge by 10 ms |
| `⌘←` / `⌘→` | Jump to the previous / next edit point |
| `+` / `-` | Zoom in / out |
| `⇧F` | Zoom to fit |
| `m` | Toggle mute on the first selected (or first) track |
| `⇧S` | Toggle solo on the first selected (or first) track |
| `l` | Toggle loop |

Shortcuts are suppressed while typing into an input field.

## Export formats

| Format | Availability |
|---|---|
| WAV (16-bit PCM or 32-bit float) | Always — a small in-repo encoder, no codec support required |
| MP3 (192 kbps) | Wherever the browser can encode it (mediabunny ships its own MP3 encoder) |
| M4A / AAC (192 kbps) | Chromium-class browsers with WebCodecs AAC support |
| WebM / Opus (192 kbps) | Chromium-class browsers with WebCodecs Opus support |

The export dialog only lists formats the current browser actually reports as encodable — an
unsupported format is hidden, never offered and failed.

## Project file format — `.slopaudio`

A `.slopaudio` file is a zip containing:

```
project.json          the document (tracks, clips, gain, fades) + a source manifest
sources/<id>.<ext>    each imported source's ORIGINAL encoded bytes
```

Sources are stored as their original encoded bytes, not decoded PCM, so a project built from
30 MB of MP3s stays close to 30 MB. Opening a project decodes each source back into memory; there
is no relinking step and no missing-media dialog because the audio always travels with the project.

## Browser requirements

Built and verified against a **Chromium-based browser** (Chrome/Edge). WAV export always works
everywhere the app runs. MP3/M4A/WebM export depend on the browser's WebCodecs/encoder support and
are simply not offered where unsupported. Audio decodes fully into memory at import — roughly
11.5 MB of RAM per minute of stereo 48 kHz audio — so very long imports (tens of minutes) can use
a large amount of memory.

## Known limitations

- **No UI to remove or reorder a track.** Both underlying operations exist and are tested, but
  nothing in the interface exposes either. An accidental "Add track" is undoable, at least.
- **Inspector number fields work at 10 ms granularity** — values display and commit at two decimal
  places, matching the nudge step, not full sample precision.
- **`⇧Delete` (delete-and-ripple) only ripples a time-range selection**, not a selection of clips.
- **Splitting or range-cutting a clip that has fades carries both fades onto each fragment** —
  a cut can introduce an audible dip at the new join, since neither fragment loses the fade it
  didn't "keep" from the original clip.
- **A saved `.slopaudio` embeds every source imported in the session**, not only those the
  document still references, so a file can be larger than the audio it actually uses.
- **The export format you last chose does not persist** between sessions — the export dialog
  always opens back on WAV.
- **Chromium-first.** WAV export is guaranteed everywhere; MP3, M4A, and WebM depend on the
  browser's own encoder support and are hidden, not offered, where it's missing.
- **Long files decode fully into RAM** rather than streaming — about 11.5 MB per minute of stereo
  48 kHz audio, so very long sessions can add up.
- **Match loudness measures the whole decoded source, not the trimmed region a clip actually
  plays.** Two clips cut from different, differently-loud parts of the same imported file get the
  same correction, since loudness is measured once per source at import time.

## Design notes

The full design spec, including the data model and the reasoning behind non-obvious decisions
(why solo isn't part of the document, why `trimStart` moves two fields by one clamped delta, why
preview and export share one scheduling function), lives in
`docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md`. `CLAUDE.md` is the shorter,
code-facing index for picking this project back up.
