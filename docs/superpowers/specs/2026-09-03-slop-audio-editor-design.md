# slop-audio-editor — design

**Date:** 2026-09-03
**Status:** approved (design), pending implementation plan

A browser-based multitrack audio editor: import audio onto tracks, move and trim clips, cut parts
out, copy/paste, set track and clip gain, apply fade in/out curves, and export a mixdown.

## 1. Purpose and scope

Three uses drive every decision below:

1. **Voice / narration assembly** — trim takes, cut out flubs and dead air, splice a clean read
   together, put a music bed under it.
2. **Soundtracks for slop-animator / slop-video-compositor** — build a VO + music + SFX mix and
   export it for the animator's audio lane or the compositor's audio bed.
3. **General multitrack scratchpad** — chop up any audio, get a mix out.

Music production is explicitly **not** a target. There is no tempo, no bar/beat grid, no metronome,
no quantise. Time is seconds throughout.

### In scope (v1)

- Import local audio files onto tracks (mp3, wav, flac, m4a, ogg — whatever `decodeAudioData` takes)
- Multiple tracks, multiple clips per track
- Move clips in time and between tracks; trim clip head and tail
- Cut a time range out of one or more tracks, with or without closing the gap (ripple)
- Split at playhead; copy / cut / paste / duplicate clips
- Per-track gain, mute, solo
- Per-clip gain
- Per-clip fade in / fade out with a selectable curve shape
- Transport: play, pause, stop, loop over a time range, seek
- Waveform display, zoom, snapping
- Undo / redo
- Project save/open as a self-contained zip; IndexedDB autosave
- Export a mixdown of the whole project or of the selected time range

### Out of scope (v1) — deliberate cuts, not oversights

- **Pan** — a VO + bed mix does not need it; `StereoPannerNode` is a later addition to the same graph
- **Crossfades** — requires overlapping clips, which the non-overlap invariant forbids. Fades are
  to and from silence only.
- **Per-fade curve shapes** — one `fadeShape` per clip covers both its fades
- **Silence detection / strip silence** — real feature with its own tuning UI; candidate for v2
- **Mic recording** — slop-audio-recorder already exists as a separate tool
- **Stem export** — mixdown only
- **Markers, track heights, filmstrips** — chrome that slop-video-compositor earned over time
- **Effects of any kind** — no EQ, compression, reverb, normalise

## 2. Platform and stack

**Browser**, not desktop. Everything the app does — decode, trim, cut, gain, fade curves, mixdown,
export — is native Web Audio. slop-video-compositor went Tauri because ffmpeg was unavoidable for
video decode and encode; no equivalent forcing function exists here, and a browser app costs no Rust
toolchain, no ffmpeg dependency, and gives a shareable URL.

Stack mirrors **slop-animator** exactly, so conventions and gotchas carry over:

| | |
|--|--|
| Framework | Svelte 5, runes mode (`compilerOptions.runes: true`) |
| Language | TypeScript |
| Build | Vite |
| Styling | Tailwind 4 |
| Icons | `@lucide/svelte` |
| Tests | Vitest, node env |
| Encoding | mediabunny (+ WebCodecs) |
| Zip | fflate |
| Deploy | Cloudflare Workers static assets (assets-only `wrangler.jsonc`, no Worker script) |

The build gate is slop-animator's: `svelte-check && tsc --noEmit && vite build`, **0 errors,
0 warnings**.

### Known browser limits, accepted

- Sources decode fully into RAM. Stereo 48 kHz float32 is ~11.5 MB per minute; a 30-minute import is
  ~345 MB decoded. Acceptable for the target use; the app should not pretend otherwise if it fails.
- No stable file paths, so a project file must embed its sources (see §8).
- Chromium-first. WebCodecs-backed export formats degrade per browser; WAV export always works.

## 3. Data model

Two separate stores, and the split is load-bearing.

### Media pool — session-scoped, NOT part of undo history

```ts
interface Source {
  id: string;
  name: string;           // original filename, shown on clips
  bytes: Uint8Array;      // ORIGINAL ENCODED file bytes — what goes in the project zip
  buffer: AudioBuffer;    // decoded at the project rate (48 kHz)
  peaks: Float32Array;    // interleaved min/max pairs, one pair per 256 samples
}
```

Keeping `bytes` (encoded) rather than the decoded buffer is what keeps a project zip the size of the
files you imported: a 30 MB mp3 stays 30 MB instead of becoming ~300 MB of PCM.

The pool is append-only within a session. Sources are dropped only when a different project is
opened. An undo that removes the last clip referencing a source leaves the source in the pool, so
redo needs no re-decode.

### Document — plain data, `structuredClone`-able, kilobytes

```ts
interface Project {
  name: string;
  tracks: Track[];
  masterGain: number;     // linear
}

interface Track {
  id: string;
  name: string;
  clips: Clip[];          // INVARIANT: sorted by startS, non-overlapping
  gain: number;           // linear; the fader displays dB
  muted: boolean;         // affects EXPORT — see §5 on why solo is not here
}

interface Clip {
  id: string;
  sourceId: string;
  startS: number;         // position on the timeline
  inS: number;            // offset into the source buffer
  durS: number;           // length on the timeline == length of source consumed
  gain: number;           // linear
  fadeInS: number;        // 0 = no fade
  fadeOutS: number;
  fadeShape: 'linear' | 'equalPower' | 'exponential';
}
```

The document holds no `AudioBuffer` and no sample data. That is what makes undo a plain snapshot
(§5) and the project JSON small.

**Non-overlap invariant.** Clips on one track never overlap. Dropping a clip onto occupied time
**overwrites**: the dragged clip wins, and what it lands on is trimmed at the boundary or removed
entirely if fully covered. This is slop-video-compositor's same-track rule.

The project's timeline length is `max(clip.startS + clip.durS)` across all tracks, computed, never
stored.

**Solo is not in the document.** `muted` is a real edit: it is saved with the project and it
silences the track in the export. Solo is *monitoring* — it must never change what an export
contains. It therefore lives in view state as a `Set<trackId>`, is not saved, and is not undoable.
slop-video-compositor draws the same line ("track solo — preview only").

### Fixed constants

- **Project sample rate: 48 000 Hz.** The shared `AudioContext` is constructed at 48 kHz, so
  `decodeAudioData` resamples every import to it on the way in. One rate everywhere means the
  mixdown never resamples and the engine never drifts. 48 kHz is accepted by both AAC and Opus, the
  same reason slop-animator picked it.
- **Channels: stereo** for mix and export. Mono sources are decoded as mono buffers and connect to a
  stereo destination unchanged.
- **Peak resolution: one min/max pair per 256 samples** (~188 pairs/second).
- **`MIN_CLIP_S` = 0.01** — a clip may never be trimmed shorter than 10 ms. Zero would be an
  invisible clip with a draggable edge.

## 4. Editing operations

All edits are **pure functions** in `src/doc/edits.ts`, typed `(project, args) => Project`. No DOM,
no Web Audio, no `$state`. This module plus §6's `planSchedule` are the substance of the test suite.

| Operation | Notes |
|---|---|
| `addClip(trackId, sourceId, atS)` | Places a whole source; overwrite resolves collisions |
| `moveClips(clipIds, deltaS, deltaTrackIndex)` | Caller has already resolved snapping |
| `trimStart(clipId, deltaS)` | See invariant below |
| `trimEnd(clipId, deltaS)` | Capped at the source extent, floored at `MIN_CLIP_S` |
| `splitAt(trackIds, atS)` | Splits every clip crossing `atS` on those tracks |
| `deleteClips(clipIds)` | Leaves a gap |
| `deleteRange(trackIds, fromS, toS, ripple)` | See below |
| `copyClips` / `cutClips` / `paste(trackId, atS)` | Clipboard normalised to `t = 0` |
| `setClipGain`, `setClipFade` | |
| `addTrack`, `removeTrack`, `reorderTrack`, `renameTrack` | |
| `setTrackGain`, `toggleMute`, `toggleSolo`, `setMasterGain` | |

### `trimStart` invariant

`startS` and `inS` move by the **same delta**, so they cancel in timeline terms and the audio you
keep stays under the same timeline position it was already under. You trim a head because the sync
is already right; a head trim that re-syncs the clip is a bug. slop-animator documents exactly this
rule for its `trimHead`, and it is worth restating because it is not the obvious implementation.

`trimStart` cannot move `inS` below 0 and cannot leave fewer than `MIN_CLIP_S` seconds. The delta
itself is clamped before it is applied to either field, so the two can never be clamped by different
amounts and break the invariant.

### `deleteRange` — "cut out a part"

1. Split every clip on `trackIds` crossing `fromS` and `toS`.
2. Delete clips fully inside `[fromS, toS)` on those tracks.
3. If `ripple`, shift every clip starting at or after `toS` on those tracks left by `toS - fromS`.

**Ripple is scoped to `trackIds`, never global.** A global ripple would slide a music bed out of sync
with the narration you were editing. The default `trackIds` is the set of tracks the time-range
selection covers, so rippling a narration edit leaves the bed alone unless you selected it too.

### Fade clamping

`fadeInS + fadeOutS <= durS`. Dragging one fade handle past the other pushes the other one back
rather than rejecting the drag. A trim that shortens a clip below its fades scales both down
proportionally.

## 5. State and undo

`src/state/appState.svelte.ts` holds the single `$state` store — the document, the media pool, the
selection, the transport state, and the view (zoom, scroll). Same single-source-of-truth pattern as
slop-animator's `appState.svelte.ts`.

Every user-visible edit goes through an action that: applies a pure `edits.ts` function, pushes the
**previous** document onto the undo stack (`structuredClone`), and clears the redo stack. Cap at 100
entries. Because the document holds no sample data, a snapshot is kilobytes — no command objects, no
inverse operations, no structural sharing.

Continuous gestures (dragging a clip, dragging a fader) mutate live and commit **one** history entry
on pointer-up.

Not in history: selection, playhead, zoom, scroll, and **solo** — all view/monitoring state, none of
it saved with the project. **Mute is in history**, because it is part of the document and changes
what an export contains (§3).

## 6. Audio engine

### The central commitment

Preview and export share one pure planner:

```ts
// pure — no ctx, no DOM. Node-testable. The bulk of engine test coverage.
function planSchedule(project: Project, fromS: number, toS: number): ScheduledClip[]

interface ScheduledClip {
  trackId: string;       // which track GainNode to connect to
  sourceId: string;
  when: number;          // seconds from the start of the render window
  sourceOffset: number;  // seconds into the source buffer
  duration: number;      // seconds to play
  gain: number;          // the CLIP's own gain only — track gain is a separate node
  fadeIn: { atS: number; durS: number; shape: FadeShape } | null;
  fadeOut: { atS: number; durS: number; shape: FadeShape } | null;
}

// thin, imperative, ~30 lines, not unit-tested
function renderPlan(
  ctx: BaseAudioContext, plan: ScheduledClip[], pool: SourcePool, project: Project,
): { trackGains: Map<string, GainNode>; masterGain: GainNode }
```

`planSchedule` takes solo as a parameter, not from the document: `planSchedule(project, from, to,
soloed: Set<string>)`. Live playback passes the view state's solo set; **mixdown passes an empty
set**, which is what guarantees solo can never leak into an export.

Live playback calls `renderPlan` with an `AudioContext`; mixdown calls it with an
`OfflineAudioContext`. Same plan, same code, so **what you hear and what you export cannot drift
apart**. slop-animator achieved this with a comment asserting that `audioExportPlan` mirrors
`AudioEngine.play` "exactly"; here it is structural instead.

`planSchedule` is also where **mute and solo are resolved**: a muted track is always dropped; if the
`soloed` set is non-empty, every track outside it is dropped too. One rule, one place.

Clips fully outside `[fromS, toS)` are omitted. A clip straddling `fromS` is entered partway
(`sourceOffset` advanced, `duration` reduced); one straddling `toS` is truncated.

### Node graph

Per scheduled clip:

```
AudioBufferSourceNode → GainNode (clip: gain + fade automation) → GainNode (track)
                                                                → GainNode (master) → destination
```

Track and master gain nodes are created **once per render** and reused across that track's clips.
Keeping them as real nodes — rather than folding track gain into each clip's gain — is what lets the
faders work *during* playback (see below).

### Transport

`play(fromS)` builds and schedules the **entire** remaining project up front. Sample-accurate by
construction, no timer, no drift.

Edits split into two classes while playing:

- **Structural** (move, trim, split, delete, paste, import) — stop and restart from the current
  position. The accepted cost of scheduling up front.
- **Mix** (track gain, master gain, mute, solo) — applied **live** by setting `.gain.value` on the
  retained track/master `GainNode`s. No restart. This is the whole reason track gain is its own node:
  balancing a mix means riding a fader while it plays, and a restart on every fader move would make
  that unusable.

If a real project stutters under the node count, the upgrade path is a look-ahead scheduler
(100 ms timer, ~1 s horizon — the "two clocks" pattern) behind the same `planSchedule`. Not built
until measured.

Loop: when a time range is selected and loop is on, playback restarts the whole plan at the range
start on reaching the range end.

Playhead position while playing is derived from `ctx.currentTime`, never from a counter.

### Fades

One pure function, `fadeCurve(shape, n): Float32Array`, produces the gain ramp; `renderPlan` feeds it
to `setValueCurveAtTime` with `n = 128`. Preview and mixdown get byte-identical curves.

| Shape | Curve | Use |
|---|---|---|
| `linear` | `t` | Neutral default for short fades |
| `equalPower` | `sin(t·π/2)` | Constant perceived loudness; the sane default for longer fades |
| `exponential` | `t²` | Slow start, fast finish — for ducking a bed under speech |

`setValueCurveAtTime` is chosen over chained `linearRampToValueAtTime` calls because it expresses any
shape with one call and one shared source of truth.

## 7. Selection

Two selection kinds. Both are needed: clip selection for move/trim/gain/fade, time-range selection
for cut/ripple/loop/export-selection.

- **Clip selection** — click a clip; ⌘/Ctrl-click to add or remove; drag the body to move;
  ⌥-drag to copy.
- **Time-range selection** — drag on the ruler (covers all tracks) or drag across empty track area
  (covers the tracks the drag crossed). Shows as a translucent band with draggable edges.

Setting one clears the other. The inspector shows the selected clip; range-scoped commands are
disabled without a range and vice versa.

## 8. Persistence

### Project file — `.slopaudio` (zip, via fflate)

```
project.json          the Project document + a source manifest (id, name, filename)
sources/<id>.<ext>    each source's ORIGINAL encoded bytes
```

Self-contained and portable: no relinking, no missing-media dialogs, no file paths. Open decodes each
source back into the pool. Save is a browser download; open is a file picker (and drag-drop onto the
window).

A project built from large WAV imports produces a large zip. That is the accepted cost of
self-containment, and the same trade slop-animator makes.

`project.json` carries a `version` integer. v1 readers reject unknown future versions with a clear
message rather than half-loading.

### Autosave — IndexedDB

Two different write cadences, and conflating them would be a performance bug:

- **Source bytes are written once, on import**, keyed by source id. They are immutable, and a
  project with 300 MB of sources must not be rewritten every few seconds.
- **The document is written on a ~3 s debounce.** It is kilobytes, so this is free.

On load, the document is restored and its sources are re-read and re-decoded from IndexedDB. Same
shape as slop-animator's `src/persist/autosave.ts`. A reload never loses work; clearing site data
does, which is what project files are for.

### Preferences — localStorage

Zoom level, snap on/off, last export format, track height. Not part of a project.

## 9. Export

Mixdown renders the same `planSchedule` output into
`new OfflineAudioContext(2, ceil(lengthS × 48000), 48000)`.

Range: the whole project (0 → timeline length), or the selected time range if one exists.

| Format | Path | Availability |
|---|---|---|
| **WAV** | Small in-repo encoder — 16-bit PCM, plus a 32-bit float option | Always. The guaranteed path. |
| **M4A / AAC** | mediabunny + WebCodecs | Chromium; the format slop-animator already uses |
| **WebM / Opus** | mediabunny + WebCodecs | Chromium |
| **MP3** | mediabunny + `@mediabunny/mp3-encoder` | Any browser (the extension carries its own encoder) |

> **RESOLVED 2026-09-03, during planning.** This section previously flagged MP3 as unresolved,
> because WebCodecs ships no MP3 *encoder*. It does not — but mediabunny publishes an official
> extension package, `@mediabunny/mp3-encoder`, whose `registerMp3Encoder()` installs one. MP3 is
> therefore in v1 scope with no third-party library and no separate decision.

The export UI offers only formats the browser reports as supported; unsupported ones are hidden
rather than offered and failed.

## 10. UI

```
┌───────────┬──────────────────────────────────────────────────────────────┐
│ File▾ Import │ ⏮ ▶ ⏹ ↻   00:01:23.456   Zoom −/Fit/+   Snap   Export▾   │
├───────────┼──────────────────────────────────────────────────────────────┤
│           │ 0s      5s      10s     15s     20s          ▮ playhead      │
├───────────┼──────────────────────────────────────────────────────────────┤
│ VO    M S │ [~~~take1~~~]        [~~~take2~~~][~t3~]                     │
│ ──●────── │                                                              │
├───────────┼──────────────────────────────────────────────────────────────┤
│ Music M S │        [~~~~~~~~~~~~~~ bed ~~~~~~~~~~~~~~~~~~~]              │
│ ─●─────── │                                                              │
├───────────┴──────────────────────────────────────────────────────────────┤
│ take2.wav   in 4.20  out 9.75  gain −2.0 dB  ⤢ 0.05  ⤡ 0.30  [equal-power ▾] │
└──────────────────────────────────────────────────────────────────────────┘
```

**Direct manipulation is the primary path**: clip corners are fade handles, clip edges are trim
handles, the body drags to move. The bottom inspector exists for typing exact numbers, and is a
supplement, never the only way to do something.

Components, one job each (`src/lib/`): `Toolbar`, `Ruler`, `Timeline`, `TrackHeader`, `TrackLane`,
`Clip`, `Playhead`, `RangeSelection`, `Inspector`, `ExportDialog`.

**Waveforms** are drawn on canvas from `Source.peaks`, aggregated to the current pixels-per-second.
One canvas per clip.

**Snapping** targets clip edges, the playhead, range edges, and t = 0, within a pixel threshold.
**Shift disables snapping** during a drag.

**Zoom** is pixels-per-second, driven by ⌘/Ctrl-wheel, `+`/`−`, and Fit.

### Keyboard

| Key | Action |
|---|---|
| `Space` | Play / pause from the playhead |
| `S` | Split selected tracks at the playhead |
| `⌘X` / `⌘C` / `⌘V` / `⌘D` | Cut / copy / paste / duplicate |
| `Delete` | Delete selection (clips, or range leaving a gap) |
| `⇧Delete` | Delete range and ripple |
| `⌘Z` / `⇧⌘Z` | Undo / redo |
| `←` / `→` | Nudge by 100 ms — the playhead, or the selected clip if there is one |
| `⇧←` / `⇧→` | Nudge by 10 ms |
| `⌘←` / `⌘→` | Jump to previous / next edit point |
| `+` / `−` / `⇧F` | Zoom in / out / fit |
| `M` / `⇧S` | Mute / solo the selected track |
| `L` | Toggle loop |

## 11. Module map

```
src/
  audio/
    context.ts      shared 48 kHz AudioContext, lazily constructed on first user gesture
    decode.ts       File → Source (bytes kept, buffer decoded, peaks computed)
    peaks.ts        peak pyramid build + aggregation to a pixel width          [tested]
    fades.ts        fadeCurve(shape, n)                                        [tested]
    schedule.ts     planSchedule()                                             [tested]
    engine.ts       transport; renderPlan() against an AudioContext
  doc/
    document.ts     Project / Track / Clip types, ids, invariant helpers
    edits.ts        every pure edit operation                                  [tested]
    selection.ts    selection types + range↔clip resolution                    [tested]
  state/
    appState.svelte.ts   the $state store, actions, undo/redo
  export/
    mixdown.ts      OfflineAudioContext render via planSchedule
    wav.ts          AudioBuffer → WAV Blob                                     [tested]
    encode.ts       mediabunny wrappers, capability probing
  persist/
    project-file.ts zip read/write                                             [tested]
    autosave.ts     IndexedDB
    preferences.ts  localStorage
  lib/              Svelte components (see §10)
```

## 12. Testing

Vitest, **node environment, no DOM** — the same line slop-animator draws. Pure logic is unit-tested;
canvas and Web Audio code is not.

Covered:

- **`edits.ts`** — the largest suite. Every operation, plus: the `trimStart` invariant, overwrite
  resolution on drop, ripple scoping to selected tracks only, fade clamping under trim, clipboard
  normalisation, the sorted/non-overlapping invariant after every operation.
- **`planSchedule`** — clips straddling the window at both ends, solo resolution, mute, gain
  multiplication, empty project, clip entirely outside the window.
- **`fadeCurve`** — endpoints, monotonicity, shape distinctness.
- **`peaks.ts`** — aggregation correctness, degenerate widths, silence.
- **`wav.ts`** — header fields, sample round-trip, mono and stereo.
- **`project-file.ts`** — zip round-trip preserves the document and source bytes byte-for-byte;
  unknown version rejected.

Not covered by unit tests, verified by hand: playback timing, waveform rendering, drag interactions,
WebCodecs export.

## 13. Risks and open items

| Item | Handling |
|---|---|
| **Peak resolution at deep zoom** — 188 pairs/s is ~5 ms per pair, coarse when zoomed to a word | Ship one level, measure. If it is visibly blocky, add a finer level or read the buffer directly below a zoom threshold. |
| **Node count** when scheduling a large project up front | Measure before optimising. Upgrade path (look-ahead scheduler) is behind `planSchedule` and needs no model change. |
| **Long-file memory** — 30 min stereo ≈ 345 MB decoded | Accepted. Fail loudly rather than silently degrade. |
| **Peak computation blocks the main thread** on import of a long file | Chunked loop that yields to the event loop between chunks, with import progress shown. Not a Worker: an `AudioBuffer` cannot be transferred, so a Worker means copying every channel across, and the copy costs about what the computation does. |

## 14. Decisions log

Choices made during brainstorming, with the reason, so a later reader does not relitigate them:

- **Browser, not Tauri** — nothing here needs ffmpeg or real file paths; the compositor's reason for
  going desktop does not apply.
- **Clip-based non-destructive, not Audacity-style destructive** — instant edits on long files,
  trivial undo, and a cut can be re-opened later.
- **Overwrite on drop, non-overlapping clips** — matches slop-video-compositor; the cost is no
  crossfades in v1.
- **Ripple scoped to selected tracks** — a global ripple desyncs a bed from the narration.
- **Schedule the whole project up front, not a look-ahead scheduler** — sample-accurate with no
  timer; measure before adding complexity.
- **One `planSchedule` shared by preview and export** — makes preview/export drift structurally
  impossible rather than a convention to remember.
- **Zip project files with embedded sources** — a browser has no stable paths to relink to.
- **No pan, no crossfades, no effects, no recording in v1** — YAGNI against the three stated uses.
- **MP3 via `@mediabunny/mp3-encoder`** — the one open question at design time; answered during
  planning (see §9). WAV remains the guaranteed, dependency-free path.

## 15. Suggested milestone order

The spec is one coherent app, but not one sitting. A natural staging, each milestone leaving
something you can actually use:

1. **Scaffold** — Vite + Svelte 5 + TS + Tailwind 4 + Vitest + the build gate, deployable empty shell.
2. **Import and see** — media pool, decode, peaks, one track, waveform on canvas, zoom, ruler.
3. **Hear it** — `planSchedule` + `renderPlan` + transport, playhead from `ctx.currentTime`.
4. **Edit it** — `edits.ts` and the full pure test suite, driven by drag/trim/split/delete on canvas.
5. **Mix it** — multiple tracks, faders, mute, solo, clip gain, fades.
6. **Keep it** — zip project files, IndexedDB autosave, undo/redo.
7. **Ship it** — mixdown, WAV encoder, mediabunny formats, export dialog, Cloudflare deploy.

Undo (6) arriving that late is deliberate: it is a wrapper around `edits.ts`, so it is near-free once
the edits are pure, and building it earlier would mean maintaining it through every step above.
