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
                     ExportDialog, KeyboardShortcuts, ShortcutHelp; clip-drag.svelte.ts holds drag-gesture logic
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
    unaddressed for iPad: every keyboard shortcut and every modifier-based action (⌘/Shift-click
    multi-select, ⌘A), hover-only affordances (tooltips and the status-bar hint are inert on
    touch), iOS IndexedDB eviction after ~7 days, and the memory ceiling from holding every source
    decoded (~11.5 MB per minute of 48 kHz stereo float).

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
    `:root` also sets `color-scheme: dark` and `accent-color`: checkboxes, range thumbs and
    scrollbars are drawn by the browser and would otherwise keep the OS light palette.

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

## Testing

Vitest, `node` environment, no DOM (`src/**/*.test.ts`, see `vite.config.ts`). Pure logic
(`doc/edits.ts`, `doc/loudness-match.ts`, `doc/play-range.ts`, `audio/schedule.ts`, `audio/ducking.ts`,
`audio/fades.ts`,
`audio/peaks.ts`, `audio/loudness.ts`, `audio/pool.ts`'s `computeLoudnessChunked`/`computePeaksChunked`,
`export/wav.ts`, `export/normalise.ts`, `persist/project-file.ts` (including
`packCurrentProject`), `persist/autosave.ts`'s `disableDocumentSaves`, `persist/preferences.ts`,
`lib/geometry.ts`,
`lib/hit-test.ts` (including `hitTestRuler`), `lib/shortcuts.ts`, `lib/status.ts`, `state/history.ts`) is
unit-tested. Canvas rendering, drag interactions (the `Ruler`'s in/out marker drag included), the master
meter's animation (its scale mapping is `meterFillPct`, which IS tested; the `requestAnimationFrame`
loop cannot run in a backgrounded tab, so the bar and peak-hold need a foreground eyeball), real
playback timing, and WebCodecs export are not covered by automated tests and need a manual pass in
a browser — see the acceptance-pass checklist in the task-29 brief/report for what that covers and
what has and hasn't been run.
