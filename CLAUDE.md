# CLAUDE.md

Handoff index for `slop-audio-editor`, a browser-based multitrack audio editor. Read this before
touching the code; read `docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md` for the
full design rationale behind anything that seems surprising below.

## Commands

```bash
npm run dev      # Vite dev server
npm test         # Vitest, node environment, no DOM — 273 tests across 27 files
npm run test:watch
npm run build    # svelte-check && tsc --noEmit && vite build — bar is 0 errors, 0 warnings
npm run check    # svelte-check only
npm run deploy   # npm run build, then wrangler deploy (Cloudflare Workers static assets)
```

`tsconfig.json` has `strict`, `noUnusedLocals`, `noUnusedParameters`, and `verbatimModuleSyntax` —
an unused import or a type-only import written as a value import fails the build.

## Development workflow

- All editing logic lives as **pure functions** in `src/doc/edits.ts`: `(project, args) =>
  Project`. No DOM, no Web Audio, no `$state` in that file. Test new operations there first — it's
  the cheapest place to get a bug wrong before it reaches the UI.
- Preview and export share one scheduler, `planSchedule` (`src/audio/schedule.ts`). If you're
  adding behavior that should differ between playback and export, it does **not** belong in
  `planSchedule` — see Gotcha 3.
- The document (`Project`/`Track`/`Clip`) holds no `AudioBuffer` and no sample data, which is what
  makes undo a plain `structuredClone` snapshot instead of command objects. Don't put decoded audio
  or anything non-serializable into it.
- Media (decoded buffers, peaks, original bytes) lives in the pool (`src/audio/pool.ts`), a plain
  `Map` outside `$state` and outside undo history. The document only ever references sources by id.

## Architecture map

```
src/
  doc/
    document.ts     Project / Track / Clip types + constants (PROJECT_SAMPLE_RATE = 48000,
                     MIN_CLIP_S = 0.01, PEAK_SAMPLES_PER_PAIR = 256)
    edits.ts         every pure edit operation — the largest test surface in the project
    overlap.ts       non-overlap invariant helpers (drop-to-overwrite resolution)
    selection.ts     clip selection / time-range selection types + resolution
    clipboard.ts     copy/cut/paste, normalised to t = 0
    loudness-match.ts  matchLoudnessGains(entries) — per-clip linear gain correction toward the
                     median LUFS of a group, clamped to ±MAX_MATCH_DB; non-finite (silent) entries
                     are skipped, never boosted

  audio/
    context.ts       shared 48 kHz AudioContext, lazily constructed on first user gesture
    pool.ts          SourcePool: id -> { bytes, buffer, peaks, loudnessLufs }; decode + peak build
                     + loudness measurement on import
    peaks.ts         peak pyramid build + aggregation to a pixel width
    loudness.ts      integratedLoudness(channels, sampleRate) — ITU-R BS.1770 LUFS. K-weighting
                     coefficients are hardcoded for 48 kHz (PROJECT_SAMPLE_RATE) only. Also exports
                     the pieces (`createKWeightFilter`, `weightedBlockPower`,
                     `gatedLoudnessFromBlockPowers`) that `pool.ts`'s `computeLoudnessChunked` uses
                     to spread the same computation across yielding chunks, the way
                     `computePeaksChunked` does for peaks
    fades.ts         fadeCurve(shape, n) — linear / equalPower / exponential gain ramps
    schedule.ts      planSchedule(project, fromS, toS, soloed) — pure, the shared preview/export
                     planner; resolves mute and solo into which clips even appear in the plan.
                     Glue is master-level and does NOT go through here — see render.ts
    render.ts        renderPlan(ctx, plan, pool, project) — builds the actual node graph against
                     either an AudioContext (preview) or an OfflineAudioContext (export). When
                     `project.glue` is true, inserts a fixed highpass -> lowpass -> compressor ->
                     makeup-gain chain between the master gain and the destination; when false, the
                     graph is bit-identical to before Glue existed — those nodes are never built
    engine.ts        transport: play/stop, schedules the whole remaining project up front,
                     playhead derived from ctx.currentTime, never a counter

  state/
    appState.svelte.ts   the single $state store (document, pool handle, selection, transport,
                          view state, soloed set) + all actions (commit/beginGesture/amend/
                          endGesture, undo/redo, play/seek, toggleSolo)
    history.ts            undo/redo stack, cap 100, structuredClone snapshots

  export/
    mixdown.ts       OfflineAudioContext render via planSchedule, with solo hard-wired out
                     (see Gotcha 1)
    wav.ts           AudioBuffer -> WAV Blob (16-bit or 32-bit float), tested
    encode.ts        lazy-loaded mediabunny wrapper; capability probing (availableFormats) and
                     MP3/M4A/WebM encoding
    formats.ts       ExportFormat type, labels, extensions, MIME types, export window resolution

  persist/
    project-file.ts  .slopaudio zip read/write (fflate) — project.json + sources/<id>.<ext>,
                     versioned, tested round-trip
    project-io.svelte.ts   save/open/restore-autosave orchestration; owns loadInto (Gotcha 7)
    autosave.ts      IndexedDB: source bytes once on import, document on a 3 s debounce
                     (Gotcha 6)
    preferences.ts   localStorage: zoom, snap, track height, last export format

  lib/               Svelte components — Toolbar, Ruler, TimelineViewport, TrackHeader, TrackLane,
                     ClipView, Waveform, Playhead, RangeOverlay, Inspector, NumberField, Fader,
                     ExportDialog, KeyboardShortcuts; clip-drag.svelte.ts holds drag-gesture logic
```

## Gotchas

1. **Solo is view state, never in the document — `mixdown` cannot see it.** `mixdown`
   (`src/export/mixdown.ts`) has no solo parameter at all; it calls `planSchedule` with a
   module-private, unexported `NO_SOLO` empty set, so no caller can substitute a different one.
   Why it matters: if solo ever leaked into export, auditioning one track and then exporting would
   silently produce a mixdown with every other track dropped — a mix-destroying bug that would
   look like a successful export. Verified end-to-end in a browser.

2. **`trimClipStart` moves `startS` and `inS` by the same clamped delta — clamp the delta, not the
   fields.** In `src/doc/edits.ts`, the delta is computed once (`d`), clamped against both the
   in-point floor and the neighbour boundary, and then applied identically to `startS` and `inS`.
   Why it matters: clamping the two fields separately lets them end up moved by different amounts,
   which silently breaks the sync between "position on the timeline" and "offset into the source" —
   the clip would visually stay put but start playing from the wrong point in the source audio.

3. **`planSchedule` is shared by preview and export — it has no playback-only branches.** Any
   special case that should apply only while playing (or only while exporting) belongs in
   `renderPlan`'s caller, never inside the plan itself. Why it matters: the whole reason preview and
   export can't drift apart is that they run the exact same plan through the exact same node-graph
   builder against two different context types (`AudioContext` vs `OfflineAudioContext`). One
   playback-only `if` inside `planSchedule` would reopen that gap.

4. **`state.soloed` must be a `SvelteSet`, not a plain `Set`.** A plain `Set` mutated with
   `.add`/`.delete` produces no reactivity in Svelte 5 runes mode — the UI and the retained-node
   mute/solo logic would silently stop updating, with no error. `appState.svelte.ts` imports
   `SvelteSet` from `svelte/reactivity` specifically for this field.

5. **A component using the `$state` rune must import the store as `import { state as appState }
   from "./state/appState.svelte"`.** Importing it as bare `state` collides with the `$state` rune
   identifier and trips Svelte's `store_rune_conflict` compiler error. Every component and
   `.svelte.ts` module in this codebase follows the `as appState` convention — keep new files
   consistent with it rather than rediscovering the error.

6. **Autosave writes source bytes exactly once, on import; only the document is on the debounce.**
   `putSource` (`src/persist/autosave.ts`) runs at import time and never again — sources are
   immutable and can be hundreds of megabytes. `scheduleDocumentSave` runs on a 3 s debounce because
   the document itself is kilobytes. Why it matters: conflating the two cadences would mean
   rewriting the entire media pool to IndexedDB every few seconds, which for a real project would be
   a serious performance and storage-churn problem for no benefit — the sources never change after
   import.

7. **`loadInto` decodes every source before touching the pool or the project.** In
   `src/persist/project-io.svelte.ts`, the full decode loop runs first, and only after every source
   has decoded successfully does it clear the pool and install the new sources and document ("past
   this line nothing can fail, so the swap is effectively atomic"). Why it matters: the pool is a
   plain `Map` that Svelte cannot track for rollback. Clearing it before decoding finished, then
   hitting a corrupt file partway through, would strand the currently-open project referencing
   sources that no longer exist — one bad import would destroy the whole open session, including
   its own autosave backup.

8. **Gesture classes decide whether a commit reschedules playback, and mute/solo deliberately
   don't use the non-rescheduling path.** `beginGesture()` (default, "structural") reschedules
   playback on `endGesture()`; `beginGesture("mix")` does not, so a fader can be ridden live during
   playback without a dropout. Mute (via `commit`) and solo (via `toggleSolo`) always reschedule —
   not because they're structural edits in the same sense as a trim, but because `planSchedule`
   drops muted/non-soloed tracks from the plan **entirely**. There is no live node to turn down for
   a track that was never scheduled, so a "mix"-style live gain tweak can't express mute/solo; only
   a reschedule can.

9. **`NumberField` guards against committing its own displayed value as a no-op.** It shows
   `value.toFixed(2)` but the underlying value can carry finer precision from a pointer drag.
   `commitDraft()` compares the draft string against `value.toFixed(2)` and bails if they match, so
   merely tabbing through the inspector without changing anything can't push a few-millisecond
   "edit." Why it matters: `edits.ts`'s exact-equality no-op guards (`d === 0`, `c.gain === g`)
   can't catch a delta that small but nonzero — without this guard, focusing and blurring a field
   would create a junk undo entry and, mid-playback, force an audible reschedule.

10. **mediabunny is lazily loaded, and `vite.config.ts`'s `chunkSizeWarningLimit: 700` exists
    solely to accommodate its own lazy chunk.** `src/export/encode.ts` only `import()`s
    `mediabunny` + `@mediabunny/mp3-encoder` when the export dialog first needs them, keeping them
    out of the initial bundle (the entry chunk is ~92 kB gzip). The lazy chunk itself is ~668 kB
    (that's `mediabunny` itself; the MP3 encoder extension is a separate ~311 kB chunk). The build's
    default 500 kB warning threshold would flag that as a problem it can't be reduced, so the limit
    is raised just above it — high enough to silence that specific unactionable warning, low enough
    that a real regression (the *entry* chunk ballooning past 700 kB) still gets caught.

11. **`integratedLoudness` (`src/audio/loudness.ts`) is a faithful, uncorrected BS.1770 meter; the
    mono/stereo playback correction lives one layer up, in `pool.ts`'s `computeLoudnessChunked`.**
    BS.1770 sums per-channel power at G=1.0, so it genuinely (and correctly) measures a stereo
    signal with identical L/R content as 10·log10(2) ≈ 3.01 dB louder than the same content in
    mono — this is pinned by a test in `loudness.test.ts` and must stay that way, since it's what
    the −20 LUFS compliance test in the same file is proving faithful to. But Web Audio upmixes a
    mono buffer to stereo by **duplication, not attenuation** (the default "speakers" channel
    interpretation), and this app always renders stereo (`AudioContext`'s default destination,
    `OfflineAudioContext(2, …)` for export) — so a mono file and its dual-mono equivalent sound
    **identical** through this app despite that 3.01 dB measurement gap. `computeLoudnessChunked`
    corrects for this by measuring a mono channel as dual-mono (see its own test asserting
    `computeLoudnessChunked([ch])` ≈ `computeLoudnessChunked([ch, ch])`). Why it matters: moving
    that correction into `integratedLoudness` itself would make it a non-faithful implementation of
    the standard and break its own compliance test; leaving it out of `computeLoudnessChunked`
    would make "Match loudness" systematically over-boost every mono clip by ~3 dB in exactly the
    kind of mixed mono/stereo project the feature exists for.

## Testing

Vitest, `node` environment, no DOM (`src/**/*.test.ts`, see `vite.config.ts`). Pure logic
(`doc/edits.ts`, `doc/loudness-match.ts`, `audio/schedule.ts`, `audio/fades.ts`, `audio/peaks.ts`,
`audio/loudness.ts`, `audio/pool.ts`'s `computeLoudnessChunked`/`computePeaksChunked`,
`export/wav.ts`, `persist/project-file.ts`, `persist/preferences.ts`, `lib/geometry.ts`,
`lib/hit-test.ts`, `lib/shortcuts.ts`, `state/history.ts`) is unit-tested. Canvas rendering, drag interactions, real
playback timing, and WebCodecs export are not covered by automated tests and need a manual pass in
a browser — see the acceptance-pass checklist in the task-29 brief/report for what that covers and
what has and hasn't been run.
