# Slop Audio Editor

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![GitHub](https://img.shields.io/badge/github-meigo%2Fslop--audio--editor-181717?logo=github)](https://github.com/meigo/slop-audio-editor)
[![Live demo](https://img.shields.io/badge/demo-slop--audio--editor.meigo.workers.dev-5b8cff)](https://slop-audio-editor.meigo.workers.dev)

Browser-based **multitrack audio editor**: drop in voice and music, cut and fade, duck the bed
under the voice, and export a mastered file — all locally, with no upload and no server.

**→ [slop-audio-editor.meigo.workers.dev](https://slop-audio-editor.meigo.workers.dev)**

![Slop Audio Editor — five tracks of waveforms with ducking envelopes drawn on the music beds, the mix fade-in and fade-out curves arcing across the whole timeline, an in/out loop range on the ruler, and the master EQ, filter, saturation, Glue and mix fades in the side panel](docs/screenshot.webp)

**Stack:** Svelte 5 (runes) + TypeScript + Vite + Tailwind 4, on the Web Audio API.

|                 |                                                                   |
| --------------- | ----------------------------------------------------------------- |
| **License**     | MIT                                                               |
| **Runs**        | In the browser. Nothing is uploaded; audio never leaves the tab   |
| **Import**      | Anything the browser decodes — MP3, WAV, M4A/AAC, FLAC, OGG, WebM |
| **Export**      | WAV (16-bit / 32-bit float), MP3, M4A, WebM                       |
| **Sample rate** | 48 kHz throughout                                                 |
| **Storage**     | Autosave to IndexedDB; `.slopaudio` project files                 |

## Features

### Timeline

- Multi-track: import, move, trim in/out, split at the playhead, delete, ripple delete
- Clips can never overlap — a dragged clip **overwrites** what it lands on
- Fades in and out with three shapes: **linear**, **equal power**, **exponential**, drawn from the
  same curves the engine plays
- Multi-select with ⌘/Shift-click or a range drag; a whole group moves together
- Snap to clip edges, the playhead and t=0 (hold Shift to override)
- Copy / cut / paste / duplicate, from the keyboard or a right-click (long-press) menu —
  paste lands on the current track at the playhead
- **Varispeed** per clip, 0.25x to 4x — speed and pitch together, like tape; the clip's length on
  the timeline changes to match
- Waveforms scaled by clip gain, so the picture shows what you will hear
- In/out markers for looping a section, kept separate from the selection that bounds an export
- Reorder tracks by dragging the grip in a track header
- Number fields scrub: drag one sideways to change it, click to type
- Zoom to fit the selection (F), a drawn range, or the whole project (⇧F) — from the keyboard,
  the toolbar or the right-click menu
- Three track heights, adjustable zoom, and two-finger pan/pinch on a trackpad or touchscreen

### Mixing

- Per-track gain, pan, mute, solo, and a three-band EQ (150 Hz shelf, 1.2 kHz peak, 6 kHz shelf)
- A sweepable **filter** per track — one knob, high-pass left and low-pass right. A shelf
  plateaus; a filter keeps falling, which is what actually removes rumble
- **Ducking**: mark a track `D` and it dips under any other track that has audio playing.
  Derived from clip positions, not a sidechain, so the dip is already at full depth on the voice's
  first consonant — and it is drawn on the clip
- **Match loudness**: sets clip gains so everything sits at the group's median LUFS
- Master gain, master EQ, a master filter, tape-style **saturation**, **Glue**, and mix
  **fade in/out** that fade everything playing, drawn across the tracks — a fixed band-limit and gentle bus compressor
- Live peak meter, per channel, so a hard-panned mix cannot read low
- Undo/redo across every edit, 100 steps deep

### Export

- **Loudness normalisation** to −14 (streaming), −16 (podcast) or −23 LUFS (EBU R128), measured
  with a compliant ITU-R BS.1770 meter
- Optional **brick-wall limiter** so a target can be reached rather than fallen short of — it
  reports how much it pulled down, because 1 dB is transparent and 8 dB is not
- **TPDF dither** on 16-bit output
- Peak check that stops before writing a clipped file
- Export the whole project, or just a selected time range

## How it works

A few decisions shape the whole codebase:

- **Preview and export run the same code.** One scheduler plans the timeline and one builder turns
  that plan into a Web Audio graph, against a live `AudioContext` for playback and an
  `OfflineAudioContext` for export. Anything that would apply to only one of them is kept out of
  both, so what you hear is what you get.
- **The document holds no audio.** Decoded buffers, waveform peaks and original bytes live in a
  pool outside the document, which is what makes undo a plain snapshot instead of command objects.
- **Solo and the in/out markers are session state**, deliberately unreachable from an export —
  auditioning one track must never silently produce a mixdown missing every other one.
- **Editing is pure functions.** Every operation is `(project, args) => project` with no DOM and no
  audio, which is why most of the behaviour is covered by fast unit tests.

## Development

```bash
npm install
npm run dev       # Vite dev server
npm test          # Vitest — 554 tests
npm run check     # svelte-check
npm run lint      # ESLint
npm run format    # Prettier
npm run build     # svelte-check && tsc --noEmit && vite build
```

The build gate is **0 errors and 0 warnings**.

## Project files

`.slopaudio` is a zip holding `project.json` plus the original, unmodified source files. Opening
one restores the session exactly; the audio is stored as imported, so a 30 MB MP3 stays 30 MB
rather than becoming PCM.

Save writes back to the file you chose, so saving twice overwrites rather than filling your
downloads folder with copies — in browsers without the File System Access API (Firefox,
Safari) it falls back to a plain download.

## Limitations

- One sample rate (48 kHz) — files are resampled on import
- No crossfades between clips; butted clips get a short declick ramp instead
- No sidechain input (Web Audio has none) — ducking is computed from clip positions
- Varispeed changes pitch with speed; there is no independent pitch shift or time stretch
- Touch covers pan, zoom, and a long-press context menu; some actions are still keyboard-only
- Browser storage can be evicted, so save a `.slopaudio` for anything you want to keep

## Credits

Built by [Meigo Kukk](https://github.com/meigo), with [Claude](https://claude.ai/code) (Anthropic)
as co-author. Commits include:

```text
Co-Authored-By: Claude Opus 5 (1M context) <noreply@anthropic.com>
```

Encoding by [mediabunny](https://github.com/Vanilagy/mediabunny), zip handling by
[fflate](https://github.com/101arrowz/fflate), icons by [Lucide](https://lucide.dev).

## License

MIT — see [LICENSE](LICENSE).
