# CLAUDE.md

Handoff index for `slop-audio-editor`, a browser-based multitrack audio editor. Read this before
touching the code; read `docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md` for the
full design rationale behind anything that seems surprising below.

## Commands

```bash
npm run dev      # Vite dev server
npm test         # Vitest, node environment, no DOM — 306 tests across 28 files
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
                     MIN_CLIP_S = 0.01, PEAK_SAMPLES_PER_PAIR = 256). resolveTrackId(p,
                     preferredId) resolves a preferred track id against the project, falling back
                     to the first track when it's null or names a track that no longer exists — a
                     project always has at least one track, so callers never null-check
    edits.ts         every pure edit operation — the largest test surface in the project
    overlap.ts       non-overlap invariant helpers (drop-to-overwrite resolution)
    selection.ts     clip selection / time-range selection types + resolution
    play-range.ts    setIn/setOut(range, atS, projectEndS) — in/out play-range marker math. The
                     range this computes is session state (see `state/appState.svelte.ts`'s
                     `playRange`), never part of `Project`: it is not saved and never affects
                     export, which keeps using the time-range selection (`exportWindow`)
    clipboard.ts     copy/cut/paste, normalised to t = 0. Paste lands on the CURRENT track (see
                     `pasteAtPlayhead`), never back on the track the clips came from — a
                     multi-track copy keeps its relative track offsets below it
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
    saturation.ts    saturationCurve(amount, points) — tanh waveshaping for the master bus, pure
    ducking.ts       planDucking(project, fromS, toS) — pure. Gain envelopes for every track
                     marked `ducked`, dipping DUCK_DEPTH_DB (-12) while any unmuted, non-ducked
                     track has a clip. Derived from clip POSITIONS, not audio content, which is
                     what lets preview and export compute it identically
    fades.ts         fadeCurve(shape, n) — linear / equalPower / exponential gain ramps
    schedule.ts      planSchedule(project, fromS, toS, soloed) — pure, the shared preview/export
                     planner; resolves mute and solo into which clips even appear in the plan.
                     Glue is master-level and does NOT go through here — see render.ts
    render.ts        renderPlan(ctx, plan, pool, project) — builds the actual node graph against
                     either an AudioContext (preview) or an OfflineAudioContext (export). When
                     `project.glue` is true, inserts a fixed highpass -> lowpass -> compressor ->
                     trim-gain chain between the master gain and the destination — the trim cancels
                     the compressor's own below-threshold makeup gain (see gotcha 12), it does not
                     add one; when false, the graph is bit-identical to before Glue existed — those
                     nodes are never built
    engine.ts        transport: play/stop, schedules the whole remaining project up front,
                     playhead derived from ctx.currentTime, never a counter

  state/
    appState.svelte.ts   the single $state store (document, pool handle, selection, transport,
                          view state, soloed set, currentTrackId) + all actions
                          (commit/beginGesture/amend/endGesture, undo/redo, play/seek, toggleSolo,
                          setCurrentTrack). currentTrackId() is the read side — it resolves
                          state.currentTrackId against the live project via resolveTrackId, so
                          nothing else needs to null-check or handle a deleted track
    history.ts            undo/redo stack, cap 100, structuredClone snapshots

  export/
    limiter.ts       limitPeaks(channels, sampleRate, ceilingDbfs) — lookahead brick-wall peak
                     limiter, pure. Applied to the RENDERED BUFFER only, never the node graph
    normalise.ts     loudness targets; normaliseChannels(...) does the gain-then-limit passes
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
    preferences.ts   localStorage: zoom, snap, track height, export format, loudness target

  lib/               Svelte components — Toolbar, Ruler, TimelineViewport, TrackHeader, TrackLane,
                     ClipView, Waveform, Playhead, RangeOverlay, Inspector, NumberField, Fader,
                     ClipInspector, ContextMenu, ExportDialog, KeyboardShortcuts, MasterInspector,
                     ShortcutHelp, SidePanel, ToolbarMenu, TrackInspector; clip-drag.svelte.ts holds drag-gesture logic
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
    that a real regression (the _entry_ chunk ballooning past 700 kB) still gets caught.

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

12. **`DynamicsCompressorNode` is not a pure attenuator — it has spec-defined internal makeup
    gain, so Glue's post-compressor gain node TRIMS rather than adds.** The Web Audio spec derives
    an internal makeup gain from `threshold`/`knee`/`ratio` (chosen so the loudest possible signal
    still maps to 1.0), which shows up as a flat boost below the threshold, tapering to attenuation
    as the input gets louder. Measured for Glue's settings (`-18` dB threshold, `6` dB knee, `3:1`
    ratio): **+6.13 dB at -20 dBFS peak, +4.01 dB at -12, +0.12 dB at -6, -3.12 dB at -1.** An
    earlier version of Glue added a further `+3 dB` on top of this on the theory that "the
    compressor only reduces" — that theory was false, and the result was quiet material coming out
    of Glue about +9.3 dB louder, exactly the "toggle behaves like a volume control" failure Glue
    exists to avoid. `GLUE_TRIM_DB` in `render.ts` is `-6`, cancelling the below-threshold makeup so
    switching Glue on is level-neutral for quiet material and only the loud end gets tamed. Why it
    matters: this number is measured for THESE compressor settings — changing `threshold`, `knee`,
    or `ratio` changes the makeup gain the trim needs to cancel, so re-measure it (build the chain
    in an `OfflineAudioContext`, sweep input peak level, read the output) rather than guessing.

13b. **A loop always restarts at something VISIBLE: the IN marker, or 0 — never where playback
began.** `loopStartS()` in `appState.svelte.ts` returns `playRange.fromS` or `0`. It used to
return the press-play position, which made the loop point invisible state that moved silently
whenever playback started somewhere new, with nothing on screen saying where it would jump
back to. Every DAW cycles a visible region; the in/out markers are drawn on the ruler and the
whole project is self-evident. `onEnded` also checks `playEndS() > restartAt` before
restarting: `engine.play` signals an empty window by calling `onEnded` on a zero-delay timer,
so looping an empty project (or a zero-length range) would otherwise restart instantly and
spin forever.

13. **The in/out play-range (`state.playRange`) is session state, like solo — it is never part of
    `Project` and `exportWindow` (`src/export/formats.ts`) never looks at it.** Setting IN or OUT
    (the `i`/`o` shortcuts, or dragging a handle on the `Ruler`) only ever assigns
    `state.playRange`, never goes through `commit`, and is lost on reload same as `soloed`. It
    bounds playback (`playEndS()` in `appState.svelte.ts`) whether or not `loop` is on — loop only
    decides whether playback restarts at `playRange.fromS` once it gets there. Why it matters: if
    this ever migrated into `Project` or into `exportWindow`, a marker set for a quick preview loop
    would silently start truncating exports — the same class of bug Gotcha 1 exists to prevent for
    solo, and export must keep using the time-range selection instead.

14. **`state.currentTrackId` (session state, like `soloed`/`playRange`) must always be read
    through `currentTrackId()`, never compared or dereferenced directly.** The field alone can
    hold `null` or the id of a track that was since deleted; `currentTrackId()` resolves it against
    the live project via `resolveTrackId` (`src/doc/document.ts`) and always returns a real track
    id. It's set by `setCurrentTrack(trackId)` wherever the user touches a track: clicking its
    header (`TrackHeader.svelte`), pointer-down on one of its clips (`ClipView.svelte` /
    `clip-drag.svelte.ts`'s `startClipDrag`), or starting a range drag on its lane
    (`startRangeDrag`). Why it matters: before this existed, `KeyboardShortcuts.svelte`'s
    `firstTrackId()` read `selectedTrackIds()[0]`, which returns **every** track when the
    selection isn't a range — so it always resolved to track 1, and the `M`/`⇧S` shortcuts silently
    acted on the wrong track whenever the user had more than one. `selectedTrackIds()` (range
    selection, or every track) is a **different** concept and still drives Split deliberately — do
    not conflate the two or "fix" Split to use the current track without asking; that was
    explicitly scoped out when this was added.

15. **`Waveform.svelte` scales its drawn peaks by the clip's `gain` — the canvas does NOT show raw
    source amplitude.** `ClipView.svelte` passes `clip.gain` in as a prop, and the `$effect` reads
    it directly in its tracked scope (like `widthPx`) so the canvas redraws whenever gain changes,
    Match loudness included. The scaled `[min, max]` pair is then clamped to `[-1, 1]` before being
    mapped to pixels, so a boosted clip (e.g. +12 dB) visibly hits the ceiling of its own box
    instead of painting over the clip above or below it. Why it matters: before this, running Match
    loudness silently produced a correct-sounding but visually unchanged mix — the waveform is
    meant to show what you'll hear, and reading peaks off `source.peaks` without gain broke that.

16. **Undo history belongs to ONE document — `loadInto` resets it, and orphan pruning must
    consult every undo-reachable document.** Two halves of the same invariant, both verified in a
    browser after being found by audit:
    (a) `loadInto` (`src/persist/project-io.svelte.ts`) calls `resetHistory()` after swapping the
    pool and project. Without it, undo walks straight out of the project you just opened into the
    previous one — whose sources the pool no longer holds. The clips render as "missing audio",
    but `planSchedule` still plans them and an export of that state renders **pure silence while
    reporting success**, the same class of failure Gotcha 1 exists to prevent for solo.
    (b) `pruneUnreferencedSources` takes `Project | Project[]` and resolves it through
    `referencedSourceIdsAcross` (`src/doc/document.ts`); `Toolbar.svelte`'s New-project button
    passes `reachableProjects()` (the open document plus every undo/redo snapshot). New project is
    an undoable `commit`, so pruning against the empty document alone deletes the audio undo would
    need to restore — invisibly, because the in-memory pool still has it until the next reload,
    at which point the restored document references bytes that no longer exist in IndexedDB.
    Why it matters: these two pull in opposite directions. Reset history too eagerly and undo
    stops working; prune too eagerly and undo comes back to dead audio. The rule that satisfies
    both: replacing the document clears history, and nothing reachable through history is ever an
    orphan.

17. **The fade overlays in `ClipView.svelte` are traced from the engine's own fade curves, not
    drawn as triangles.** `fadeMaskPolygon(curve)` (`src/lib/geometry.ts`) turns a gain curve into
    a CSS `polygon()` shading the region under `1 - gain`; `ClipView` feeds it
    `fadeInCurve`/`fadeOutCurve` (`src/audio/fades.ts`) — the same functions `renderPlan` hands to
    `setValueCurveAtTime` — sampled at `FADE_MASK_POINTS` (24, vs the audio's 128). A linear fade
    reduces to the plain triangle this replaced, so that case is unchanged by construction.
    Why it matters: before this, the overlays were hardcoded `polygon(0 0, 100% 0, 0 100%)`
    triangles and `clip.fadeShape` was read in exactly ONE place in the whole UI — the Inspector's
    `<select>`, which only SETS it. All three shapes drew identically, so switching a fade to
    exponential changed what you heard and nothing you saw. Same failure as Gotcha 15: derive the
    picture from the audio's source of truth rather than maintaining a parallel guess.
    Every overlay SVG — fade and duck alike — is inset 1px on ALL FOUR sides (`inset-px` plus a
    `calc(100% - 2px)` size, or `left-px`/`right-px` with a width 1px short for the fades, which
    only touch one horizontal edge). The clip's own edge is an `outline` at `-outline-offset-1`,
    so it occupies that outermost pixel: a curve reaching x=0, x=100 or the top/bottom shares
    pixels with it and the two read as one thick smudge instead of a border and a curve. The
    vertical inset came first; the horizontal one was missed until a ducked clip — whose envelope
    starts and ends hard against both ends — made it obvious.

18. **The master meter taps `RenderedGraph.output`, not `masterGain`, and the tap lives in
    `engine.ts` rather than `renderPlan`.** Two separate rules meeting in one feature.
    `renderPlan` now returns `output`: the last node before the destination — `masterGain`, or
    Glue's trim when Glue is on. A meter on `masterGain` would read a level nobody hears, since
    Glue's compressor and trim sit after it (and per Gotcha 12 the compressor is not a pure
    attenuator). The `AnalyserNode` itself is created in `AudioEngine.play`, NOT in `renderPlan`:
    per Gotcha 3 the shared planner and graph builder carry no playback-only branches, and an
    analyser in an `OfflineAudioContext` export would measure nothing.
    The live meter and the export peak answer DIFFERENT questions and both exist on purpose. The
    meter reads the playback graph, so it honours solo and only ever sees what you actually
    played — it can never be the authority on whether a file clips (Gotcha 1 again). The export
    dialog measures the rendered mixdown itself: solo-free, whole-window, and it stops before
    writing a clipped file rather than reporting the problem afterwards. `ExportDialog` retains
    that rendered buffer so acknowledging an over costs only the encode, and an `$effect` on
    `appState.project` discards it on ANY document edit — modality does not make retention safe,
    keyboard shortcuts still reach the document behind the overlay, and a stale buffer would
    write audio for a mix that no longer exists.
    `peakAmplitude`/`amplitudeToDbfs` (`src/audio/peak.ts`) are SAMPLE peak, not true peak: no
    oversampling, so a mix reading exactly 0.0 dBFS can still overshoot a downstream converter by
    a few tenths. Deliberate — do not relabel it "true peak" without adding the oversampling.

19. **The status bar mirrors `title` attributes by delegation — it has no parallel copy of the
    help text, and it is a SEPARATE row from the Inspector.** `StatusBar.svelte` puts one
    `pointerover` listener on the document and reads `e.target.closest("[title]")`, so every
    tooltip in the app appears there for free and the two can never disagree; a `data-status`
    attribute per control would be a second copy to keep in sync, and it would drift. Hovering an
    icon inside a button resolves to the button's own title via `closest`, and moving to anything
    untitled falls back to `statusSummary` (`src/lib/status.ts`, unit-tested).
    Why the separate row: the Inspector and the status line describe DIFFERENT things — the
    Inspector the selected clip, the status line whatever the pointer is over — and they were
    sharing one 40 px bar, so selecting a clip replaced the status text with the clip's fields and
    the status line silently disappeared exactly when the user was busiest. `statusSummary` also
    labels the in/out play range as `in/out` and keeps it separate from the selection, because
    they look alike but only the selection reaches an export (Gotcha 13).

20. **Ducking is computed inside `renderPlan` from a required `window` argument — not passed in
    by callers — and it deliberately ignores solo.** `planDucking` (`src/audio/ducking.ts`) is
    pure and derives the envelope from clip POSITIONS, so no sidechain and no AudioWorklet are
    involved (Web Audio has no sidechain input; a real one would need a worklet). `renderPlan`
    calls it itself, which is why it takes `window: { fromS, toS }` as a REQUIRED parameter: a
    caller that could omit the envelope could silently render a mix that disagrees with every
    other path, and the compiler now refuses that. Contrast the metering analyser, which IS
    playback-only and therefore lives in `engine.ts` (Gotcha 18) — ducking changes the mix, so it
    belongs on the shared preview/export path.
    Solo is not a parameter of `planDucking` at all. Muted tracks are excluded (mute is in the
    document and reaches the export); solo is not, so a soloed background track still ducks. If
    solo suppressed it, auditioning the music alone would give a different mix than the export —
    the Gotcha 1 trap.
    The envelope is applied to a SEPARATE `duckGain` node, never to the track's own gain node:
    writing it onto `trackGain` would fight `setTrackGain`, so riding the fader mid-playback (the
    "mix" gesture, Gotcha 8) would cancel the ducking or be cancelled by it.
    The attack ramp sits BEFORE each foreground span, so the bed is at full depth on the voice's
    first sample rather than still ramping 80 ms into it — the consonant that carries the word
    would otherwise land over an undipped bed. A real-time sidechain needs a lookahead buffer (and
    its latency) to do this; reading clip positions from the document gets it free. Attack and
    release stay asymmetric on purpose (80 ms down, 400 ms up): symmetric ramps sound mechanical.
    The DEPTH is `project.duckDepthDb` (default -12, clamped to [-40, 0], 0 meaning off) and is
    the only exposed parameter — the timing is the part with a right answer. Its control appears
    in the toolbar only while some track is marked D.
    Foreground spans closer together than attack + release are merged, so the bed does not pump
    back up during a breath between two sentences. And the duck is drawn on the ducked clips
    (`envelopeMaskPolygon`) in the same green as the header's `D` toggle — same principle as
    Gotchas 15 and 17: the picture shows what you will hear.

21. **Multi-clip move already existed; what was missing was any way to find it — and a plain
    click inside a range selection must NOT collapse that selection.** ⌘/Ctrl-click (and now
    Shift-click) toggles a clip into `selection.clipIds`, and `startClipDrag`'s `grabbedGroup`
    moves the whole group when you grab a member. `grabbedGroup` also accepts a **range**
    selection, resolving it through `clipsInRange` (overlap-based, so a clip the range only partly
    covers still moves in full — a clip cannot be half-moved).
    The trap: `ClipView.onPointerDown` runs BEFORE `startClipDrag` and used to overwrite
    `selection` unconditionally, so a range selection was already collapsed to the single clicked
    clip by the time the drag read it — the box you drew moved one clip. A plain (non-additive)
    click inside a covering range now leaves the selection alone and goes straight to the drag.
    Discoverability is handled by `data-hint` on the clip, which `StatusBar` appends to the
    element's `title`. That attribute is the deliberate exception to Gotcha 19's "mirror `title`,
    never keep a second copy": it is ADDITIONAL text, shown only in the status bar, for guidance
    (which modifier keys apply) that would make a hover tooltip unwieldy. Never restate the title
    in it.

22. **Touch: two fingers navigate, one finger is left alone — and every drag surface needs
    `touch-action: none`.** `TimelineViewport` tracks only `pointerType === "touch"` pointers; two
    of them drive `pinchUpdate` (`src/lib/geometry.ts`), which treats pinch and pan as ONE gesture
    (spread ratio sets the scale, midpoint sets what time sits under the fingers) so no mode
    switch or threshold has to guess which the user meant. Like `clip-drag`, it computes from the
    values captured at gesture START, never the previous frame, or the timeline drifts out from
    under the fingers. A single finger is deliberately ignored there so it still reaches the clip
    and lane handlers underneath — otherwise dragging a clip would be hijacked into a scroll.
    `touch-action: none` (the `touch-none` class) is on the viewport, lanes, clips and ruler.
    Without it the browser claims a drag as page scroll or pinch-zoom and CANCELS the pointer
    stream mid-gesture, so a clip drag dies partway with no error.
    Hit zones are input-dependent: `hitTestClip` takes `MOUSE_ZONES` (6 px edges) or `TOUCH_ZONES`
    (18 px), chosen per event from `e.pointerType`, so widening for fingers costs the mouse
    nothing. Touch edges are capped at `widthPx / 3` — 18 px bands on a narrow clip would meet and
    leave no body, making the clip impossible to MOVE, which is the more common gesture.
    NOT verified, and not verifiable from this harness: single-finger clip dragging on a real
    touchscreen. Synthetic PointerEvents cannot satisfy `setPointerCapture`, which throws
    `NotFoundError` without a genuine active pointer — the drag path needs a real device. Also
    unaddressed for iPad: the remaining keyboard-only actions (nudge, jump-to-edit, select all,
    zoom to fit) and every modifier-based action (⌘/Shift-click multi-select, Shift to override
    snap), hover-only affordances (tooltips and the status-bar hint are inert on touch), iOS
    IndexedDB eviction after ~7 days, and the memory ceiling from holding every source decoded
    (~11.5 MB per minute of 48 kHz stereo float). Delete and the clipboard are no longer on that
    list — see Gotcha 39.

23. **Every clip edge without a fade gets a 5 ms declick ramp, added in `planSchedule` — it is
    NOT in the document.** Clips can never overlap (`overlap.ts` enforces drop-to-overwrite), so
    butting two together is a hard cut: the source starts and stops at whatever sample value it
    happens to be at, and that step discontinuity ticks. Measured on a splice engineered to land
    on a peak, the sample-to-sample jump was **1.599** without the declick and **0.031** with it —
    the latter being exactly the waveform's own natural step, i.e. no discontinuity at all.
    `DECLICK_S` lives in `schedule.ts` because it must apply to preview and export identically;
    per Gotcha 3 that is precisely what belongs in the shared planner, and it is not a
    playback-only branch. A clip's OWN fade always wins — the declick only fills an edge that
    `fadeSpec` returned null for, which also covers the case of a window opening mid-clip (seeking
    into the middle of audio is the same discontinuity). `declickSpec` caps the ramp at half the
    audible span, because a clip may be as short as `MIN_CLIP_S` (10 ms) — only two declicks long
    — and the existing one-sample-gap guard then keeps the two spans from touching, which
    `setValueCurveAtTime` throws on. Because it is never written to the document it cannot be
    edited, undone, or saved, and it costs nothing in the file format.

24. **Per-track EQ is three FIXED bands, and a flat EQ builds no filter nodes at all.**
    `Track.eq` (`{ lowDb, midDb, highDb }`, clamped to ±`EQ_MAX_DB`) drives a low shelf at
    `EQ_LOW_HZ` (150), a peaking band at `EQ_MID_HZ` (1200, Q `EQ_MID_Q` 0.8) and a high shelf at
    `EQ_HIGH_HZ` (6000). Frequencies and Q are deliberately not adjustable — sweepable bands are
    the "total overkill" this feature exists instead of.
    `renderPlan`'s `withEq` returns its input untouched when `isFlatEq`, so a project that never
    touches EQ renders exactly the graph it always did — the same guarantee Glue makes, and for
    the same reason: three biquads at 0 dB are not bit-transparent. Verified by instrumenting
    `createBiquadFilter`: 0 nodes when flat, 3 when shaped.
    EQ is a MIX change, not a structural one. `Inspector.svelte` uses
    `beginGesture("mix")`/`amend`/`endGesture` AND pushes the value to `engine.setTrackEq`, which
    writes straight to the retained biquads — the same two-step idiom `TrackHeader`'s fader uses
    (Gotcha 8), so a band can be swept while listening without a reschedule or a dropout. The
    bands are `BandSlider`s, not `NumberField`s: a number field is a text input with no drag, so
    tone shaping meant typing a value and listening afterwards. `BandSlider` is BIPOLAR — 0 dB
    sits at the CENTRE of the travel, unlike the gain fader where unity sits at 3/4 — and
    `snapBandDb` detents it to exactly flat within ±0.5 dB. That detent is not cosmetic: a band
    left at −0.07 dB is not `isFlatEq`, so it would silently keep three biquads in the graph
    forever. A whole sweep collapses to ONE undo entry via the `dragging` flag.
    The master bus has the SAME one-knob filter, `project.masterFilter`, built by the same
    `buildFilter` and sitting between the master EQ and Glue. It is independent of Glue's own
    FIXED band-limit — that one is part of what Glue IS, this one is a control — and independent
    of a track's filter: measured through `renderPlan`, a master high-pass at 80 Hz gives -3.0 dB
    at the corner and -24.1 at 20 Hz, and a track AND master both at 80 Hz cascade to exactly
    double (-6.0 and -48.2).
    It follows the CURRENT track (`currentTrackId()`), not the selection, because it is a track
    property — the same rule the `M`/`⇧S` shortcuts follow (Gotcha 14). That is why it lives on
    the right of the Inspector and stays visible when no clip is selected.
    Measured through `mixdown`: mid −9 dB reads exactly −9.00 dB at 1200 Hz with the other bands
    within 0.23 dB, and returning to flat restores 0.00 dB exactly.

25. **Colour comes from the shared slop palette, and component markup names ROLES, never hexes.**
    `src/app.css` declares the roles as Tailwind `@theme` `--color-*` tokens — `ground`, `panel`,
    `raised`, `line`, `text`, `muted`, `accent`, `warn`, `danger`, `ok`, `disabled` — which
    generates `bg-panel`, `border-line`, `text-muted`, `bg-accent/35` and so on. There are no
    `neutral-*` / `sky-*` / `amber-*` utilities left in `src/`; adding one back re-forks the app
    from its siblings. The palette and the rules that go with it live in
    `/Users/meigo/Projects/slop/SLOP-TIMELINE-UI.md`, deliberately OUTSIDE this repo so
    slop-animator and slop-video-compositor can adopt it without reading this codebase; that
    document is the source of truth and this gotcha is only the local summary.
    Two rules from it that are easy to undo by accident:
    (a) **State must never move the layout.** The unsaved-changes mark used to be a `•` in the
    flow beside the save icon, so every edit nudged the button and its neighbours sideways. It is
    now a recoloured glyph plus an absolutely-positioned badge, which takes no layout space.
    (b) **In/out markers are a THIN line plus a wedge**, not a thick bar — a bar reads as a clip
    and competes with the media. `hitTestRuler`'s grab threshold is independent of how wide the
    marker is drawn, so the target stayed easy to hit when the line got thinner.
    (c) **The playhead spans the ruler too**, so it is mounted beside `TimelineViewport` rather
    than inside it — which is why that column carries `relative overflow-hidden`: the viewport
    used to provide the clipping, and without it a playhead scrolled off the left edge paints
    over the track-header column (the ruler's own markers already did, unnoticed). Its head is a
    SYMMETRIC downward triangle against the in/out markers' asymmetric half-wedges, because
    `danger` red beside `warn` amber is the worst pair for the common colour blindnesses and
    colour alone would not separate them. It stays `pointer-events-none` so ruler scrubbing
    passes through it.
    `:root` also sets `color-scheme: dark` and `accent-color`: checkboxes, range thumbs and
    scrollbars are drawn by the browser and would otherwise keep the OS light palette. The FOCUS
    RING needs its own rule — `accent-color` does not reach it — so a global `:focus-visible`
    restates it in `--color-accent`; without it Chrome draws a pale OS blue that reads as a
    foreign colour on every button.

26. **Every piece of id-keyed session state must be resolved against the live project at the
    point of USE.** `currentTrackId()` does it via `resolveTrackId` (Gotcha 14); `soloed` did not,
    and `planSchedule` drops every track when the solo set is non-empty and nothing in it matches.
    Soloing a track and then deleting it — or starting a new project, which mints fresh track ids —
    silenced the entire timeline with no `S` lit anywhere to explain it and no way out but a
    reload. `activeSoloed()` filters the set against the live tracks at each `engine.play` call,
    which covers delete, New project and Open in one place. The raw `state.soloed` is still what
    `toggleSolo` and the header buttons read, so a stale id survives an undo that brings its track
    back — filtering at use, not on mutation, is what makes that work.
    Export was never affected (Gotcha 1), which is exactly why this could hide: it looked like the
    app had broken rather than like a mix problem.

27. **The declick is suppressed at a seam where clips genuinely continue each other, and the
    document-defaulting/id-adoption steps run BEFORE the decode loop in `loadInto`.** Three fixes
    with one shape — a correct-looking step in the wrong place.
    (a) `playsContinuouslyInto` (`schedule.ts`): `splitAt` leaves halves that are bit-contiguous,
    so declicking both sides of that join punched a 10 ms hole to silence into audio that had no
    discontinuity. Same source + touching + contiguous in-points + equal gain means no ramp; a gain
    step, a different source, or a window edge cutting into a clip all keep theirs.
    (b) `applyDocumentDefaults` (`project-file.ts`) is called from `loadInto`, not only from
    `unpackProject`. An IndexedDB autosave is handed to `loadInto` verbatim, so a session saved
    before `eq` existed installed a document the Inspector dereferences on render.
    (c) `adoptIds` runs before decoding, not after. Decoding yields to the event loop on every
    chunk and the UI stays live, so an import started while the loading banner is up minted an id
    the loading project already used — and `putSource` is a keyed put, which overwrote that
    source's bytes in IndexedDB.

28. **Loudness normalisation is applied to the RENDERED BUFFER, never to the node graph — it is
    the one deliberate difference between what you monitor and what you export.** `normalise.ts`
    measures the finished mixdown and scales it; `planSchedule` and `renderPlan` know nothing
    about it, because a gain stage in there would break the preview/export identity every other
    gotcha protects. Applied post-render it is a constant scale, so the mix itself is unchanged —
    and the dialog always shows the achieved LUFS, so the difference is visible rather than
    surprising.
    **Gain only, no limiter.** When the peak ceiling (`NORMALISE_CEILING_DBFS`, −1 dBFS) stops the
    target being reached, the export lands short and says so. A limiter would always hit the
    number by changing the dynamics — the file would stop being the mix that was monitored. It
    also turns a mix DOWN when its peak already exceeds the ceiling, even though the loudness
    target asked for more.
    `measureMix` calls `integratedLoudness` DIRECTLY, not `computeLoudnessChunked`: the
    dual-mono correction in Gotcha 11 applies to single-channel SOURCES, and a mixdown is always
    stereo — routing a mix through it would bias every export by ~3 dB.
    Verified end to end: −22.72 LUFS renders to exactly −16.00 with peak −15.22; a
    high-crest-factor mix stops at exactly −1.00 dBFS peak and reports falling short; silence is
    left alone rather than multiplied by infinity.

29. **Replacing a session never destroys the old one first — `openProjectFile` writes the
    replacement, then prunes.** It used to `clearAutosave()` (emptying both stores) and only then
    write the new sources, one transaction per source. Those sources are the audio that was just
    loaded — hundreds of megabytes, i.e. exactly when a quota error happens — so a failure left
    NOTHING restorable, and the document debounce then wrote the new project 3 s later
    referencing sources that were never stored: next launch restored a project whose clips
    resolve to nothing, reported as success. Same class as Gotchas 1 and 16a.
    Reordering alone does not fix it, which is the part worth remembering: per-record
    transactions fail independently, so writing sources first and clearing after would leave the
    store holding some of the new project's audio and some of the old one's — a mix that looks
    intact. `putSources` puts every record in ONE transaction and awaits the TRANSACTION, not the
    individual requests; IndexedDB aborts wholesale when any request in it fails, so it is
    genuinely all-or-nothing. Verified in a browser: a failing request in a batch rolled back the
    puts that had already succeeded and left the previous session's sources and document
    untouched, and a simulated failure during a real `openProjectFile` threw with the old session
    still restorable.
    `putDocument` exists for the same reason: `scheduleDocumentSave`'s 3 s debounce is right for
    editing (the document is rewritten constantly, so a dropped tick costs nothing) but leaves a
    window here where the doc store still describes the PREVIOUS project while the source store
    already holds this one's audio. `clearAutosave` was deleted rather than left unused — nothing
    in this path should have a one-call way to empty the stores.
    Pruning runs LAST, against the ids the store held BEFORE the write, minus the ids just
    written. Not "everything unreferenced": a `.slopaudio` can carry sources no clip references
    (`saveProjectFile` packs the whole pool), `loadInto` decodes all of them into the pool, and
    pruning by reference alone would delete bytes that are in memory and expected on disk.
    Still open: after a failed source write the in-memory session has ALREADY been swapped, so
    the user's next edit schedules a document save whose audio was never stored. The autosave is
    consistent until then. Closing that needs a session-level "autosave unavailable" state and a
    way to tell the user — deliberately not done here.

30. **A failed source write disables autosave for the session — and cancelling the save already
    queued is the half that matters.** `openProjectFile` installs the new document BEFORE it
    persists anything (Gotchas 7 and 29: a corrupt file must not destroy the open project), which
    means `loadInto`'s swap has already scheduled a document save by the time the source write
    fails. Gating only FUTURE saves lets that queued one through 3 s later — and it is precisely
    the write that does the damage, replacing a consistent backup with a document whose clips
    reference audio that was never stored. `disableDocumentSaves` (`autosave.ts`) sets the flag
    AND clears the pending timer. There is deliberately no way to re-enable it: the session's
    audio is not on disk, and only a reload can make autosave meaningful again.
    `state.autosaveBroken` is the UI's half of the same event and nothing more — the mechanism
    lives in `autosave.ts`. It recolours the SAVE button `warn` and rewrites its tooltip rather
    than adding an indicator: that is the button the user now needs to press, so the warning
    belongs on it, and reusing the glyph keeps the toolbar from shifting (Gotcha 25a).
    The import path needs none of this: `importFiles` awaits `putSource` BEFORE the `commit` that
    adds the clip, so a failed write leaves a document that never referenced the missing source.
    Found only because the browser check looked at the document store after the failure rather
    than stopping at "the open threw". Verified again after the fix by clicking the real Add-track
    button — driving `commit` from an imported module instead hits a DUPLICATE module instance
    (see the module-duplication trap) and proves nothing about the app's own store.

31. **The master meter reads each channel through a ChannelSplitter — one `AnalyserNode` on the
    output would DOWN-MIX to mono.** Measured in a browser: a 0.9 signal panned hard left reads
    0.450 through a single analyser and 0.900 through per-channel ones. So the meter sat a full
    6 dB low on the widest material and looked comfortable while one channel clipped.
    `peakAmplitude` (`peak.ts`) already took an array of channels and was already tested for the
    max across them; only the tap was wrong. `METER_CHANNELS` is 2 because this app always
    renders stereo. `engine.test.ts`'s fake `AudioContext` models the down-mix — an analyser fed
    a stereo node sees the channels averaged, one fed from a splitter output sees its channel
    alone — because without that distinction no test can tell a per-channel meter from a
    down-mixing one. Still sample peak, not true peak (Gotcha 18).

32. **`saveProjectFile` packs only the audio the document references.** `packCurrentProject`
    (`project-file.ts`), not `packProject` with `pool.records()` — the pool holds every source
    imported this session, including ones whose clips were all deleted, so a shared `.slopaudio`
    used to carry audio the user had removed. Nothing in the file can need those bytes: undo
    history is not saved (`loadInto` resets it, Gotcha 16a), so no document reachable from the
    file references them. Note this is the OPPOSITE of the pruning rule in Gotcha 16b — pruning
    happens in a live session where undo can still reach a document, and packing does not.

33. **The shortcut overlay's list is checked against the parser by tests, not maintained beside
    it.** `SHORTCUTS` (`src/lib/shortcuts.ts`) is a table of `{group, keys, label, event,
command}` that `ShortcutHelp.svelte` renders. `resolveShortcut` was deliberately NOT
    refactored to consume it: that parser is small, pure and well tested, and turning it into a
    data-driven dispatcher so it could generate its own documentation would put the riskier code
    in the more important place. Two tests join them instead:
    (a) every entry's `event` really resolves to the `command` it claims — so the overlay cannot
    advertise a key that does nothing;
    (b) a sweep of the key space (letters in both cases, digits, arrows, Space, Delete/Backspace,
    `+ - = _ ? /`, × four modifier states) collects every command the parser can produce and
    asserts the set equals the documented set — so a shortcut cannot be added without being
    documented. A switch statement cannot be reflected over; sweeping is what makes this
    detectable at all. It works: the first draft of the table lumped cut/copy/paste into one row
    and (b) failed with two undocumented commands.
    What NO test can catch is a wrong `label` — "Undo" written next to ⌘Y. That stays on the
    author.
    The overlay opens on `?` (a normal `showHelp` command, so its own key is documented like
    everything else) and from a toolbar button — the point is to reach people who do not know the
    shortcuts, so reaching it must not require knowing one. While it is open,
    `KeyboardShortcuts.svelte` returns early for everything except Esc and `?`: editing the
    project behind a modal is not a feature. `ExportDialog` still does NOT do this (Gotcha 18
    records it); that was left alone deliberately rather than swept in.
    Layout note: the sections are CSS `columns-2`, not a 2-column grid — grid rows are as tall as
    the tallest section in the row, which left a large gap under the short columns. And the key
    chips need `justify-self-start`, or each one stretches to the width of its column's widest
    entry and "L" renders as a box the width of "Space".

34. **Undo/redo history is `$state`, and it has to be — the toolbar buttons read it through a
    function.** `canUndoNow()`/`canRedoNow()` are called inside `disabled={!canUndoNow()}`, and
    Svelte 5 tracks what an expression READS. While `history` was a plain module-level `let`,
    those effects had no dependencies at all, so they ran once at first render and never again:
    the Undo and Redo buttons were permanently greyed out no matter how many edits were made,
    while ⌘Z worked perfectly, because `KeyboardShortcuts` calls `undoEdit` without asking
    whether it can. That asymmetry is why it survived so long — the feature worked, only its
    affordance was dead.
    The general rule: any module-level value a component reads THROUGH A FUNCTION must be
    `$state`, or the read is invisible to the tracker. A plain `let` is only safe for something no
    component displays. This has now bitten TWICE — `history` behind `canUndoNow()`, and
    `clipboard` behind `canPaste()`, which left the context menu's Paste row greyed out after a
    copy until something unrelated happened to invalidate the derived. Both are `$state` now.

35. **Master EQ is the SAME three bands as a track's, built by the SAME function, and sits
    between the master fader and Glue.** `Project.masterEq` is an `EqBands` (the type is no longer
    called `TrackEq`, because it is no longer only a track's). `renderPlan`'s `buildEq` serves
    both — one builder, so the "a flat EQ builds NO nodes" guarantee of Gotcha 24 cannot hold for
    tracks and quietly lapse for the master. Verified in `render.test.ts`: 0 biquads when flat, 3
    when shaped, 6 when a track and the master are both shaped (independent chains, not shared).
    Placement is before Glue so the compressor reacts to the shaped signal rather than fighting
    it, which is the usual mastering order. Measured through a real `OfflineAudioContext`: master
    mid at −9 dB reads exactly −9.00 dB at 1200 Hz, +6 reads +6.00, master −9 stacked with track
    −3 reads −12.00, and returning to flat renders a bit-identical result.
    It is a MIX change (Gotcha 8): `beginGesture("mix")`/`amend`/`endGesture` plus
    `engine.setMasterEq` onto the retained biquads, so a band can be swept while listening. A
    whole sweep is one undo entry — verified through the UI, five input events and one release.
    **The meter and the master fader deliberately stay in the toolbar**, outside the collapsible
    mix panel. The meter is a safety device and the fader gets ridden during playback; neither should
    be reachable only by expanding something. The panel holds what you set and leave — EQ and
    Glue. Its toggle is pinned to the panel's RIGHT edge: the panel grows leftwards, so its left
    edge moves by the full width it opens by while the right edge does not move at all, and the
    collapsed rail is 30 px rather than 28 so flex cannot shrink the button and shift it by a
    pixel or two.

36. **The toolbar and the inspector were both over budget, and the fix was to sort controls by
    HOW OFTEN they are pressed.** Measured in a 1235 px window: the toolbar needed 1190 px and the
    inspector row needed 1271 px — the inspector was already scrolling horizontally with a clip
    selected. Two moves, no controls removed:
    (a) **A `File ▾` menu** (`ToolbarMenu.svelte`, borrowed from slop-animator along with the
    `clickOutside` action) replaces five icon buttons — New, Open, Save, Import, Export. None of
    them is pressed mid-edit, unlike the transport and undo, which stay as buttons. Hiding Save
    behind a menu would also hide that there is something to save, so the unsaved mark moved onto
    the File trigger, still out of flow (Gotcha 25a) — verified as 0 px of movement when it
    appears.
    (b) **Track EQ moved from the inspector into the mix panel**, next to the master EQ. It was
    566 px of the inspector's 1271 — 45% of the row — and it never belonged beside the clip
    fields: it follows the CURRENT TRACK while everything else in that row describes the SELECTED
    CLIP. Duck depth moved to the same panel, being a project-wide mix parameter. The inspector
    now describes only the selected clip, which is what its name promises.
    Result: toolbar 1005 px, inspector 802 px, both measured. The cost is that track EQ is hidden
    while the panel is collapsed — accepted, because it is a set-and-leave control like every
    other control in there.
    `clickOutside` attaches to a wrapper holding BOTH the trigger and the dropdown, or clicking
    the trigger to dismiss counts as "outside" and the menu closes and instantly reopens; it
    listens in the CAPTURE phase because the timeline's own pointer handlers stop propagation.

37. **16-bit WAV export is dithered, and the same change had to fix that it TRUNCATED.**
    `setInt16` truncates toward zero on its own, so `encodeWav` biased every sample toward silence
    by up to a full LSB and collapsed everything below one LSB to code 0 — a deadband that is the
    same defect dither exists to remove. Rounding and dither belong in one change; either alone is
    half a fix.
    TPDF: two independent uniforms SUMMED, giving a triangular distribution over ±1 LSB. A single
    uniform value would not do — its error still varies with the signal. Measured over a 997 Hz
    tone: total error goes from −98.67 dBFS undithered to −95.35 dBFS (0.560 LSB RMS) dithered.
    The noise floor RISES by ~3.3 dB, and that is the trade: the undithered error is smaller but
    CORRELATED with the signal, which is distortion rather than noise. The payoff is visible on a
    0.34 LSB signal — dithered it quantises to codes {−1, 0, 1}, undithered to {0}, i.e. it
    vanishes completely.
    Order is clamp float → scale → dither → ROUND → clamp integer. The final clamp is not
    optional: dither on a full-scale sample would otherwise push past 32767 and wrap a peak into a
    click. Dither also legitimately moves a full-scale sample to ±32767, which is why two
    long-standing tests had to start injecting a neutral RNG — with `Math.random` they would have
    passed only most of the time.
    16-bit only (float export has no quantisation step) and automatic (nobody wants to decide it
    per export). A wholly silent buffer is left bit-exact rather than filled with hiss, checked
    over the WHOLE buffer — skipping quiet samples individually would reintroduce exactly the
    signal-dependent correlation dither removes. `random` is injectable purely so the tests assert
    exact codes instead of statistics with loose bounds.

38. **The limiter is a hand-written lookahead peak limiter on the RENDERED BUFFER, and the ceiling
    is guaranteed by construction rather than by trusting the smoothing.** A
    `DynamicsCompressorNode` cannot do this job: knee, soft ratio, spec-defined internal makeup
    gain (Gotcha 12) and no lookahead mean it cannot hold a ceiling. Offline rendering is what
    makes a proper limiter easy — a real-time one needs a delay line and pays its latency, while
    `limiter.ts` simply reads ahead in a buffer it already holds.
    The proof matters, because a limiter that leaks is silent clipping: `req[i]` is the gain
    sample `i` needs; `winMin[i]` is the minimum of `req` over `[i, i+L]`; `gain[i]` is a TRAILING
    average of `winMin` over `L`. Every term of that average is a `winMin` whose own window
    contains `i`, so every term is `<= req[i]` and so is their mean. The release only moves the
    gain up toward that envelope, never past it. One envelope from the loudest channel drives all
    of them — per-channel gain would swing the stereo image on every transient.
    **One pass cannot reach a loudness target**, because limiting removes energy and therefore
    loudness. Measured on a high-crest mix aiming at −16 LUFS, the passes land at −19.53, −16.19,
    −16.01 — hence `normaliseChannels` loops up to `NORMALISE_MAX_PASSES` (4), stopping within
    `NORMALISE_TOLERANCE_DB`. With the limiter on, the normalisation gain is computed with an
    INFINITE ceiling: capping the gain as well would leave the target unreachable, which is the
    very thing the limiter was switched on to fix.
    It is **opt-in and reports what it cost** (deepest reduction in dB, shown in `warn` past 6 dB).
    Gotcha 28 says normalisation refuses to include a limiter because that would change the
    dynamics of a mix the user monitored; the difference here is consent — a box they tick.
    Two pieces of this were dead code found by mutation testing, not by reading: the release
    clamp in `limitPeaks` (the release branch cannot overshoot, since `target >= g` there) and a
    silence guard in the loop (`normalisationGain` already returns a gain of 1 for a non-finite
    measurement, which trips the convergence break). Both removed.

39. **The context menu exists because delete had NO pointer affordance at all**, and its actions
    live in `appState` so the keyboard and the menu cannot drift. `deleteClips`/`deleteRange` were
    reachable only from `KeyboardShortcuts.svelte`'s switch, which meant a clip could not be
    deleted on a device without a keyboard — the app could import, arrange, mix and export, but not
    remove anything. `deleteSelection` and `duplicateSelection` moved into `appState` FIRST, and
    the keyboard path now calls them; a second implementation behind the menu is exactly the kind
    of copy that drifts.
    Items are DISABLED, never hidden: a menu that changes shape between openings moves its own
    rows under the pointer, and a greyed row still teaches that the action exists — which on touch
    is the only way to discover the clipboard at all. Cut/copy/duplicate need a CLIP selection
    (the clipboard holds whole clips); a time range can be deleted but not copied.
    Opening on a clip that is not in the selection selects it first; on one that is, the group is
    kept, so "select three, right-click, delete" works. `contextItems` and `clampMenuPosition` are
    pure and unit-tested; the menu FLIPS to the other side of the pointer at a viewport edge
    rather than sliding along it, because sliding leaves it covering the clip that was clicked.
    Long-press (500 ms, cancelled by 8 px of movement) opens it on touch. That same pointerdown
    also starts a clip drag, which is deliberately left running: a drag that never moves commits
    nothing, thanks to the exact-equality no-op guards in `edits.ts`, and a cancel path through
    `clip-drag` could not be tested without real touch hardware. Right-click is verified; the
    long-press path is NOT — `setPointerCapture` rejects synthetic pointer events.

40. **Varispeed: `Clip.speed` scales the TIMELINE length and keeps the source region, and
    `start()`'s duration argument is in BUFFER time — measured, not assumed.** The measurement is
    the load-bearing fact: at `playbackRate` 2, `start(0, 0, 1)` produces 0.5 s of output, and at
    0.5 it produces 2 s. So `duration` is source seconds, and `planSchedule` passes
    `timelineSpan * speed` while `renderPlan` sets `playbackRate` — the two together are what make
    a clip sound for exactly the span it occupies. Setting one without the other is silent: the
    first attempt here changed clip lengths and left the pitch untouched, because the `renderPlan`
    edit had silently failed to match a line Prettier had rewrapped, and only a browser render
    caught it (492 unit tests did not).
    `durS` stays TIMELINE seconds. That is what lets every overlap check, drag, drawing and
    selection calculation remain speed-agnostic; the source consumed is `durS * speed`. The cost
    is that four places converting between the two timebases have to scale, and all four are
    mutation-tested: `sliceClip` (which is where BOTH `splitAt` and drop-to-overwrite compute a
    new in-point), `trimClipStart` (the in-point moves by `d * speed` while `startS` moves by `d`
    — Gotcha 2's one-clamped-delta rule still holds, the two fields just scale differently),
    `trimClipEnd`'s source-remaining clamp, and `planSchedule`'s window clipping.
    `setClipSpeed` rescales `durS` inversely so the SOURCE REGION survives: speeding a clip up
    makes it shorter, as tape does. The alternative — fixed length, eating more source — makes a
    clip trimmed to the whole file impossible to speed up at all. Growing is clamped against the
    next clip exactly as `trimClipEnd` is.
    `playsContinuouslyInto` requires EQUAL speeds and compares source-scaled in-points: two split
    halves at different rates are a genuine pitch discontinuity and must keep their declick ramps.
    Verified through the real render path: 1x/2x/0.5x/4x give 500/999/250/1998 Hz from a 500 Hz
    tone, with timeline spans of 4/2/8/1 s and audio filling each exactly.
    No resampling quality control, deliberately. The browser interpolates how it likes; that is
    the character, not a defect.

41. **`BiquadFilterNode.Q` is in DECIBELS for `lowpass` and `highpass` — the textbook 0.707 asks
    for a resonant bump.** The spec converts it as `Q_linear = 10^(Q_dB/20)`, so setting the
    Butterworth quality factor 0.707 means 0.7 dB of RESONANCE: measured at an 80 Hz corner it
    gives +0.71 dB AT the corner and +1.25 dB just above it — a lift sitting exactly where a
    high-pass is meant to be cleaning up. Butterworth is `20*log10(0.7071)` = **-3.01 dB**, which
    measures -3.01 at the corner and then -0.97 / -0.26 / -0.02 at 113 / 160 / 320 Hz: monotonic,
    no bump. `FILTER_Q` is -3.0103 for that reason.
    Peaking and shelf types take a REAL quality factor, which is why `EQ_MID_Q` is 0.8 and this is
    not. Same shape of trap as Gotcha 12's compressor makeup gain: a spec behaviour that looks
    like the textbook parameter and is not, caught only by measuring.
    Worth repeating how it was found, because the first two measurements were wrong: a peak-based
    reading gave nonsense, and the RMS reading looked wrong until a FLAT control proved the method
    exact (0.00 dB at every frequency). Only then was the +0.7 dB real enough to chase, and
    `getFrequencyResponse` confirmed the render matched the browser's own filter exactly — so the
    graph was right all along and the constant was wrong.

42. **The one-knob track filter is what the three-band EQ structurally cannot do.** A shelf
    PLATEAUS: the low shelf at -12 dB leaves 20 Hz only 12 dB down, however far it is pushed. A
    high-pass keeps falling at 12 dB/octave. Measured through `renderPlan` at 20 Hz: low shelf
    -12.0 dB, high-pass at 80 Hz **-24.1 dB**. Removing rumble and plosive thump is the commonest
    corrective move on voice and the EQ alone cannot make it.
    ONE bipolar knob, not two controls: centre is bypass, left sweeps a high-pass up from 20 Hz,
    right sweeps a low-pass down from 20 kHz. It cannot do both ends at once, which is the
    deliberate simplification — the shelves cover the rest.
    The DOCUMENT stores `{ kind, hz }`, never the knob position: "high-pass at 120 Hz" keeps its
    meaning if the mapping curve is ever retuned, where a stored -0.42 would silently change what
    a saved project sounds like. `filterFromPosition`/`filterPosition` (`geometry.ts`) are that
    mapping and its inverse, unit-tested for round-trip.
    `{ kind: "off" }` builds NO node, the same guarantee EQ and Glue make. Cascaded linear filters
    commute, so its position relative to the EQ is arbitrary. `engine.setTrackFilter` sweeps it
    live on the retained biquad — a biquad's `type` can change in place, so crossing the centre
    needs no new node — with the same caveat as EQ: a filter that was OFF at schedule time built
    nothing, so the sweep is silent until the next play.

43. **One side panel with two tabs replaced the split between a bottom Inspector bar and a right
    mix panel — and the tabs divide by WHAT YOU SELECTED, not by kind of control.** Clip
    properties were in a horizontal bar under the timeline while track and master mixing were in
    a panel on the right, so editing one clip meant looking in two places. Everything now lives in
    `SidePanel.svelte`.
    THREE tabs — Clip, Track, Master — one per level of the document, and **the panel follows
    whatever you last touched**: a clip shows Clip, a track header or empty lane space shows
    Track, and Master is only reached by asking for it. `focusPanel` is called from exactly three
    places: `ClipView`'s pointer-down, `TrackLane`'s (empty space, since a clip stops
    propagation), and `TrackHeader`'s click. It is deliberately NOT inside `setCurrentTrack`,
    because clicking a clip sets the current track too and would then land on the wrong tab.
    Two earlier shapes were wrong. "Clip fields here, all mixing there" put a track's tone control
    a tab away from the clip on that track. Folding the track INTO the Clip tab then made one tab
    mean two levels, which stops scaling the moment more track-wide effects arrive.
    Touching a clip or track always leaves Master, so mastering while auditioning costs a click to
    come back. Accepted deliberately: one rule with no exceptions is worth more than one
    workflow's convenience, and mastering is mostly pressing Space rather than clicking clips.
    The header click also switching tabs is what makes it a single rule rather than two special
    cases — the header is the most deliberate "I am working on this track" gesture there is.
    Fields are grouped with rules between them — where the clip sits and how fast it plays, then
    its level and the envelope shaping that level. Seven fields in a flat column read as a list to
    scan rather than three things to adjust. The rule between the clip and its track spans the
    full width while the within-tab rules are inset, which is the hierarchy: tab section versus
    field group.
    The bar's removal gives ~40 px of height back to the timeline, and the vertical column suits
    `NumberField` better than the bar did, where seven fields competed for one line and it
    scrolled sideways.
    **No auto-switch to the Clip tab on selection.** Clips are clicked constantly just to move
    them; switching tabs on selection would make the panel flicker during ordinary dragging.

44. **The panel's width is resizable, and the arithmetic is a pure function because the pointer
    plumbing cannot be tested here.** `panel-layout.ts` mirrors slop-animator's module of the same
    name: `clampPanelWidth` holds [MIN, half the viewport] with MIN always winning, so a narrow
    window cannot produce a panel narrower than its own sliders and a stored width from a bigger
    screen cannot leave the timeline with nothing.
    `resizedPanelWidth(gripStartW, gripStartX, clientX, viewportW)` exists as its own tested
    function for two reasons. It recomputes from the values captured at pointer-DOWN rather than
    accumulating per frame, or rounding walks the edge away from the pointer over a long drag —
    the same rule the pinch gesture follows. And the subtraction looks wrong and is not: the panel
    is docked RIGHT, so moving the grip LEFT must make it WIDER, which is the classic bug with a
    right-docked panel and is now pinned by a test.
    NOT verified: the drag itself. `setPointerCapture` rejects synthetic pointer events, and this
    harness delivers no real button presses to the grip — a `left_click` on it produced only a
    `pointermove`. The clamp and the arithmetic are tested; the wiring between them needs a human.

45. **Tracks reorder by dragging a GRIP, not the row — and `reorderTrack` had been sitting unused
    with passing tests.** The pure edit existed in `edits.ts` with three tests and zero callers
    outside them: another capability with no affordance, the same shape as clip-delete before the
    context menu.
    A dedicated handle rather than a row-wide drag. The header's click sets the current track and
    the name's double-click opens the rename editor, so dragging the row would need a movement
    threshold PLUS an exclusion for every control inside it (M/S/D, the fader, the name) — a pile
    of conditions that can only be got subtly wrong. The grip does one thing, advertises that the
    row moves, and works on touch. `gripDown` stops propagation or the row's click fires on
    release and steals the current track.
    **Track order affects NO audio.** Nothing in the engine indexes tracks by position; everything
    sums to the master bus, and ducking derives from the ducked flag and clip positions. That is
    why the drag reorders LIVE under the pointer instead of drawing a drop indicator, and why it
    is a `"mix"` gesture: rescheduling playback would cost an audible gap for a change that cannot
    alter a single sample. The whole drag is one undo entry.
    The header carries `data-track-header`, NOT `data-track-id`. The lanes already use the latter
    and `App.svelte`'s file-drop hit test resolves it with `closest("[data-track-id]")` — putting
    it on headers too would have quietly made that lookup ambiguous.
    The gesture runs on WINDOW listeners, deliberately NOT `setPointerCapture`. Reordering live
    moves the grip's own element — Svelte's keyed `{#each}` relocates the existing node rather
    than rebuilding it, and taking a node out of the document RELEASES its pointer capture. With
    capture, the first swap silently ended the drag and the grip had to be re-grabbed for every
    single row. Any list that reorders under the pointer has this problem; capture only survives a
    drag when the element stays put, which is why `clip-drag` can still use it (a clip moves by
    CSS `left`, not by moving in the DOM).
    That bug shipped, and the reason is worth keeping: it was "verified" in a browser with
    `setPointerCapture`/`hasPointerCapture` STUBBED, because synthetic pointer events cannot
    satisfy them. The stub replaced the exact mechanism that was broken, so the test passed on
    code that failed on the first swap in real use. A stub that stands in for the thing under test
    proves nothing. Without capture the gesture needs no stub at all, so it is now verified on the
    real path: one continuous drag walks a track through every position, in both directions, and
    collapses to one undo entry.
    `trackDropIndex` is pure and tested because every header is the same height, so the drop row
    is arithmetic rather than hit-testing.

46. **Panel fields share ONE grid, and the column definition is inline because Tailwind will not
    generate it.** Every row was its own flex, so the input box started wherever that row's label
    happened to end — `in` and `fade out` put four different left edges down the column. Rows now
    render `display: contents` (`NumberField`, `BandSlider`, `FilterSlider`) so their label, control
    and readout become cells of the PARENT's grid.
    Two traps, both of which shipped a broken layout for a moment:
    (a) `grid-cols-[auto_minmax(0,1fr)_auto]` produces NOTHING. Tailwind cannot generate an
    arbitrary value containing a comma, so the class silently vanishes and the element is a
    one-column grid — every label, slider and readout on a row of its own. It is set with a plain
    `style="grid-template-columns: …"` instead, which cannot be mis-parsed.
    (b) `display: contents` inside a FLEX COLUMN does the same thing for a different reason: the
    three children become flex items and stack. The container has to actually be the grid.
    One grid per TAB, not per group: separate grids size their label columns independently, so
    "fade out" pushed the second group's boxes right and the halves no longer lined up across the
    divider. The dividers are full-width rows (`col-span-3`) inside the same grid.
    The middle column is `minmax(0, 1fr)`, so controls fill whatever width the panel has been
    dragged to — a band slider measures 87 px at the 190 px minimum and 297 px at 400.

47. **Number fields scrub.** Press and drag horizontally to change the value; a press that never
    moves still puts a caret in to type, so nothing about typing changed. That is the convention
    every creative tool uses, and it is the answer to "adjusting these is uncomfortable" — a value
    you want to feel your way to is the wrong job for a keyboard.
    The document is written ONCE, on release: the scrub only assigns to `draft`, so a whole gesture
    is one undo entry and playback is not rescheduled on every pixel. `step` is per unit (0.01 for
    seconds, 0.1 for dB) and Shift is the fine step, matching the timeline's nudge. Arrow keys step
    the value while the field has focus, with Shift as the COARSE direction there because the base
    step is already small.
    Like the track-reorder grip, the gesture runs on WINDOW listeners rather than
    `setPointerCapture` — which also means it is testable here, since synthetic pointer events
    cannot satisfy capture. Verified: 50 px at 0.01/px moves 1.50 to 2.00, Shift moves it 0.05,
    and one undo reverts the whole scrub.

48. **Panning is a hand-built balance network, NOT `StereoPannerNode` — measured, because the
    obvious choice clips.** `StereoPannerNode` applies two different laws depending on its input:
    a MONO input gets textbook equal power, but a STEREO input gets the spec's folding algorithm,
    which mixes the far channel into the near one. That matters here because a track carrying both
    a mono clip and a stereo clip sums to two channels at its gain node — and panning that hard
    left measured **+12.04 dB**. The same case through the balance network measures +6.02 dB,
    which is just two sources summing.
    The network is `widen → splitter → gainL/gainR → merger`. The `widen` gain (channelCount 2,
    `explicit`, `speakers`) is not optional: a `ChannelSplitter` up-mixes DISCRETELY, so feeding it
    a mono signal leaves the RIGHT CHANNEL SILENT. That one is invisible to the node-level tests —
    the fake context cannot model channel mixing — so the three properties are pinned structurally
    instead, and the behaviour itself was found by rendering.
    **The law is normalised to unity at CENTRE**, i.e. `sqrt(2) * cos/sin`, not the textbook
    `cos/sin`. A centred track builds no pan nodes at all (the "neutral builds nothing" rule), so
    it renders at unity; a textbook law puts its centre at -3.01 dB, which made nudging pan off
    centre drop the level by 3 dB with an audible step. Normalising makes the bypass and the
    network agree exactly. The cost is that hard-panned material peaks +3.01 dB in the channel it
    lands in — visible on the meter and caught by the export peak check. Verified through
    `renderPlan`: total power is 0.00 dB at every position from hard left to hard right.
    The slider detents to dead centre within 0.03, for the same reason the EQ bands and the filter
    do: a track left at 0.02 is not centred, so it would keep five nodes in the graph forever.
    Ordering is free — pan, duck and the track fader are all gains, so they commute.

49. **Master saturation is `tanh` normalised so the SLOPE AT ZERO is 1, and its hardness was
    chosen by measuring LEVEL, not by looking at the curve.** `tanh(k*x)` has a slope of `k` near
    zero, so using it raw would multiply quiet material by `k` — a volume control wearing a
    different name, which is the exact failure Glue's trim exists to prevent (Gotcha 12).
    Dividing by `k` leaves small signals untouched and bends only the peaks. Measured through
    `renderPlan` with a 200 Hz tone: at an input of 0.02 the change is 0.00 dB at ANY drive; at
    0.3 it is -0.96 dB at full drive; at 0.9 it is -5.58, with the third harmonic rising from
    -77 dB to -16 dB as level and drive increase. That progression IS the effect.
    `SATURATION_MAX_K` took THREE goes, and the sequence is the lesson. 8 was picked because
    `tanh` stops changing SHAPE above it — true and irrelevant, and it took 12.7 dB off a hot mix
    at moderate drive. 2 fixed that and made the control inaudible: slope-at-zero normalisation
    only bends material approaching full scale, so a mix peaking around -10 dBFS never reaches the
    interesting part of the curve, and the ENTIRE range moved the level 0.72 dB with about -31 dB
    of third harmonic. It took a user saying "I can't hear any difference" to surface that; no test
    of mine was going to.
    6 plus `saturationMakeup` is the answer. The makeup restores the RMS the shaping removes at a
    reference programme level, so drive changes TIMBRE rather than loudness — measured at
    -10 dBFS, full drive holds the level at 0.00 dB while producing -15.9 dB of third harmonic,
    about 16%. Without makeup, "more drive" is heard as "everything got quieter", which is
    indistinguishable from a control that does nothing.
    Because the makeup is calibrated at ONE level, drive also acts as a gentle leveller: at full
    drive -20 dBFS comes out +3.9 dB, the reference unchanged, -3 dBFS out -5.6 dB. And the shaped
    curve tops out at 0.28, so full drive puts a ceiling near -11 dBFS on the master — it cannot
    clip, but it can make a loud mix quieter, which export normalisation puts back.
    `oversample: "4x"`, because a waveshaper generates harmonics above Nyquist that fold back as
    inharmonic tones. Low fidelity is a fine character; aliasing is a defect, and one master-bus
    node can afford it.
    It sits LAST, after Glue — tape goes after the bus compressor — which makes it the graph's
    `output`, so the meter reads through it (Gotcha 18's rule, applied again). Zero drive builds
    no node at all, and the curve has an ODD point count so silence maps to an exact zero rather
    than an interpolated one.

## Testing

Vitest, `node` environment, no DOM (`src/**/*.test.ts`, see `vite.config.ts`). Pure logic
(`doc/edits.ts`, `doc/loudness-match.ts`, `doc/play-range.ts`, `audio/schedule.ts`, `audio/ducking.ts`,
`audio/fades.ts`,
`audio/peaks.ts`, `audio/loudness.ts`, `audio/pool.ts`'s `computeLoudnessChunked`/`computePeaksChunked`,
`export/wav.ts`, `export/normalise.ts`, `persist/project-file.ts` (including
`packCurrentProject`), `persist/autosave.ts`'s `disableDocumentSaves`, `persist/preferences.ts`,
`lib/geometry.ts`,
`lib/panel-layout.ts`, `lib/hit-test.ts` (including `hitTestRuler`), `lib/shortcuts.ts`, `lib/status.ts`, `state/history.ts`) is
unit-tested. Canvas rendering, drag interactions (the `Ruler`'s in/out marker drag included), the master
meter's animation (its scale mapping is `meterFillPct`, which IS tested; the `requestAnimationFrame`
loop cannot run in a backgrounded tab, so the bar and peak-hold need a foreground eyeball), real
playback timing, and WebCodecs export are not covered by automated tests and need a manual pass in
a browser — see the acceptance-pass checklist in the task-29 brief/report for what that covers and
what has and hasn't been run.
