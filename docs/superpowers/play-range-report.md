# Play-range in/out markers — implementation report

Branch `main`, starting HEAD `d62e4b3`, ending HEAD `5696da7`. Four commits, one per piece, as
specified.

## Piece 1 — `src/doc/play-range.ts` + test

**RED.** Wrote `src/doc/play-range.test.ts` (14 tests: creation from null for `setIn`/`setOut`,
degenerate refusal for both, clamping IN past OUT and OUT past IN with an explicit
`fromS < toS` assertion, clamping at 0 and at `projectEndS`, and the same-object no-op contract),
then ran it against the not-yet-existing module:

```
$ npx vitest run src/doc/play-range.test.ts
 FAIL  src/doc/play-range.test.ts [ src/doc/play-range.test.ts ]
Error: Cannot find module './play-range' imported from
.../src/doc/play-range.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

Failed for the right reason: the module didn't exist yet, not a logic error.

**GREEN.** Implemented `src/doc/play-range.ts` (`PlayRange`, `MIN_PLAY_RANGE_S = 0.05`, `setIn`,
`setOut`), then:

```
$ npx vitest run src/doc/play-range.test.ts
 Test Files  1 passed (1)
      Tests  14 passed (14)
```

`setIn`/`setOut` clamp the moved end against the other end (`toS - MIN_PLAY_RANGE_S` /
`fromS + MIN_PLAY_RANGE_S`) rather than swapping, with a comment pointing at
`trimClipStart`/`trimClipEnd` in `edits.ts` as the precedent for that convention. Both floor at 0
and cap at `projectEndS`; both return the same object on a no-op move.

## Piece 2 — `hitTestRuler` in `src/lib/hit-test.ts` + tests

**RED.** Added 6 tests to `src/lib/hit-test.test.ts` (each handle hit, a miss, nearer-wins when
both are in range, nulls never hit, exact-threshold boundary):

```
$ npx vitest run src/lib/hit-test.test.ts
 ❯ hitTestRuler > reports the in handle within threshold of its position
TypeError: hitTestRuler is not a function
 ... (6 failures total, all "hitTestRuler is not a function")
 Tests  6 failed | 6 passed (12)
```

The 6 pre-existing `hitTestClip` tests kept passing; all 6 new ones failed because the function
didn't exist — the right reason.

**GREEN.** Added `RulerZone` and `hitTestRuler(xPx, inPx, outPx, thresholdPx = 6)` to
`src/lib/hit-test.ts`, following `hitTestClip`'s shape:

```
$ npx vitest run src/lib/hit-test.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## Piece 3 — shortcuts

**RED.** Added 3 tests to `src/lib/shortcuts.test.ts` (bare `i`/`o` map to `setIn`/`setOut`;
`⌘I`/`Ctrl+I` map to `clearPlayRange`; a test pinning that `⌘I` isn't read as plain `i`, mirroring
the existing `⌘S` test):

```
$ npx vitest run src/lib/shortcuts.test.ts
 ❯ resolveShortcut > maps bare i/o to setIn/setOut
AssertionError: expected null to deeply equal { kind: 'setIn' }
 ❯ resolveShortcut > maps ⌘I/Ctrl+I to clearPlayRange
AssertionError: expected null to deeply equal { kind: 'clearPlayRange' }
 ❯ resolveShortcut > does not confuse ⌘I with the setIn key
AssertionError: expected null to deeply equal { kind: 'clearPlayRange' }
 Tests  3 failed | 9 passed (12)
```

All 3 new tests failed with `null` (unmapped key) — the right reason; the 9 pre-existing tests
were untouched and green.

**GREEN.** Added the three `Command` variants and their cases to `resolveShortcut`: `i`/`o` in the
bare-key `switch`, and `i` in the modifier branch (which is checked first, so `⌘I` never falls
through to the bare `i` case):

```
$ npx vitest run src/lib/shortcuts.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)
```

## Piece 4 — wiring (not unit-tested by design; DOM/runes code)

Changed, per the spec:

- **`src/state/appState.svelte.ts`**: added `state.playRange: PlayRange | null` (initialised
  `null`), alongside `soloed` — not read or written by `commit`/`undo`/autosave, so it can never
  reach export or a saved project. Added `setPlayIn(atS = state.playheadS)`,
  `setPlayOut(atS = state.playheadS)`, `clearPlayRange()`, all going through `doc/play-range.ts`'s
  `setIn`/`setOut` and then `restartIfPlaying()` (the same private helper `commit`/`undo`/`toggleSolo`
  already use — no second restart path was invented). `playEndS()` now returns
  `state.playRange.toS` when a range exists, else `projectDurationS`, and no longer reads
  `state.selection` at all. `togglePlay` starts at
  `Math.max(range.fromS, Math.min(state.playheadS, range.toS))` when a range exists (else the raw
  playhead), and its loop-restart branch now reads `state.playRange.fromS` fresh (falling back to
  the original start position when there's no range) rather than the old
  `state.selection`-based branch.
- **`src/lib/KeyboardShortcuts.svelte`**: dispatches `setIn`/`setOut`/`clearPlayRange` to the new
  actions.
- **`src/lib/Ruler.svelte`**: renders the range (when set) as a translucent amber band between the
  markers, a 1px handle at each edge, and "I"/"O" labels. `onPointerDown` hit-tests once via
  `hitTestRuler` (mirroring how `ClipView` hit-tests once and hands the zone to
  `startClipDrag`), then either drags that marker (calling `setPlayIn`/`setPlayOut` with the
  pointer's time on every move) or seeks exactly as before. Drag listeners are added to `window`
  on pointer-down and removed on pointer-up, alongside `releasePointerCapture`, following
  `clip-drag.svelte.ts`'s pattern — a single `<!-- svelte-ignore a11y_no_static_element_interactions -->`
  is kept on the root div, as before.
- **`README.md`/`CLAUDE.md`**: documented the feature (new bullet under Features, three rows in
  the shortcuts table, a "not saved with the project" line under Known limitations), and added
  Gotcha 13 to `CLAUDE.md` explaining `playRange` is session state like solo and must never reach
  `exportWindow`. Updated the stale `npm test` test-count comments in both files to the new
  totals.

### Full-suite and build verification after every piece

```
$ npm test
 Test Files  28 passed (28)
      Tests  297 passed (297)

$ npm run build
1788514083046 COMPLETED 4146 FILES 0 ERRORS 0 WARNINGS 0 FILES_WITH_PROBLEMS
✓ built in 968ms
```

297 = 274 (baseline) + 14 (`play-range.test.ts`) + 6 (`hitTestRuler`) + 3 (shortcuts). No file
under `src/export/` changed (`git diff --stat src/export/` is empty), so `exportWindow` and the
mixdown path are untouched — export still resolves its window from `state.selection` only.

Also started the dev server (`npm run dev -- --port 5183`), confirmed `GET /` returns `200` with
no console/log errors visible in the server log, then killed it before finishing.

## What could not be verified

No browser and no audio in this environment, so the following are implemented and read correctly
against the spec but **not manually exercised**:

- Actually dragging an in/out handle on the `Ruler` and watching the band/labels update, or
  watching a real hit-test radius feel right at various zoom levels.
- Real playback: that a loop genuinely restarts audio at `playRange.fromS`, that a non-looping
  play genuinely stops audio at `playRange.toS`, and that moving a marker mid-playback audibly
  reschedules without a glitch.
- Visual check of the amber band/handle contrast against the existing dark ruler and the sky-blue
  `RangeOverlay` selection band (chosen deliberately to be a different hue so markers don't read as
  a selection, per the spec, but not seen rendered).
- Keyboard shortcuts firing correctly from a live `KeyboardShortcuts.svelte` (`isTextTarget`
  suppression, `preventDefault`, etc.) — the dispatch code path was written to match the existing
  `case` pattern exactly, but not run in a DOM.

These are exactly the categories `CLAUDE.md`'s own Testing section already calls out as needing a
manual browser pass (canvas rendering, drag interactions, real playback timing).
