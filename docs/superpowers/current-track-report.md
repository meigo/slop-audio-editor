# Current-track feature — implementation report

Branch `main`, starting at `32cda95`. Four commits:

```
25c2296  Add resolveTrackId: resolve a preferred track id against a project
e5d141b  Add current-track session state to the store
9b191f8  Wire up current-track selection across the UI
2fc7106  Document the current-track concept in README and CLAUDE.md
```

## TDD evidence for `resolveTrackId`

Tests were added to `src/doc/document.test.ts` first, before any implementation existed in
`src/doc/document.ts`.

**RED** — `npx vitest run src/doc/document.test.ts`, before `resolveTrackId` was added to
`document.ts`:

```
 FAIL  src/doc/document.test.ts > resolveTrackId > returns the preferred id when it exists
TypeError: resolveTrackId is not a function
 ❯ src/doc/document.test.ts:136:12
    134|     p = addTrack(p, "Track 2");
    135|     const wanted = p.tracks[1].id;
    136|     expect(resolveTrackId(p, wanted)).toBe(wanted);
       |            ^

 FAIL  src/doc/document.test.ts > resolveTrackId > falls back to the first track when the preferred id is unknown
TypeError: resolveTrackId is not a function
 ❯ src/doc/document.test.ts:141:12

 FAIL  src/doc/document.test.ts > resolveTrackId > falls back to the first track when preferredId is null
TypeError: resolveTrackId is not a function
 ❯ src/doc/document.test.ts:146:12

 FAIL  src/doc/document.test.ts > resolveTrackId > falls back to the first track when the preferred track was the one removed
TypeError: resolveTrackId is not a function
 ❯ src/doc/document.test.ts:154:12

 Test Files  1 failed (1)
      Tests  4 failed | 13 passed (17)
```

**Implementation added** (`src/doc/document.ts`):

```ts
export function resolveTrackId(p: Project, preferredId: string | null): string {
  if (preferredId !== null && findTrack(p, preferredId)) return preferredId;
  return p.tracks[0].id;
}
```

**GREEN** — `npx vitest run src/doc/document.test.ts`, after:

```
 Test Files  1 passed (1)
      Tests  17 passed (17)
```

Full suite after: `npm test -- --run` → **306 tests passing, 28 files** (302 pre-existing + 4 new
`resolveTrackId` tests). `npm run build` → `0 ERRORS 0 WARNINGS`, Vite build clean, no chunk-size
notice.

## What changed, per file

### Commit 1 — resolver
- `src/doc/document.ts` — added `resolveTrackId(p, preferredId)`.
- `src/doc/document.test.ts` — four new tests (preferred id exists; unknown preferred id falls
  back; `null` preferred id falls back; preferred track was the one removed falls back).

### Commit 2 — store state and actions
- `src/state/appState.svelte.ts`
  - Added `currentTrackId: string | null` to the `$state` object, initialised `null`. Comment
    marks it session state, same as `soloed`/`playRange`: not in the document, not saved, not
    undoable.
  - Added `currentTrackId(): string` — the read side, resolving `state.currentTrackId` against
    `state.project` via `resolveTrackId`. Everything downstream reads through this, never the raw
    field, so a deleted "current" track never leaks a dangling id.
  - Added `setCurrentTrack(trackId: string): void` — the only writer.
  - Changed `pasteAtPlayhead(trackId: string)` to `pasteAtPlayhead()` — it now resolves its own
    fallback via `currentTrackId()` instead of trusting a caller-supplied `trackId` (which, prior
    to this feature, was always effectively `tracks[0]`, since `selectedTrackIds()` returns every
    track outside a range selection).

### Commit 3 — component wiring
- `src/lib/TrackHeader.svelte` — clicking the header calls `setCurrentTrack(track.id)`
  (`a11y_no_static_element_interactions` and `a11y_click_events_have_key_events` suppressed on
  that element, matching the codebase's existing per-element `svelte-ignore` convention). Added a
  `border-l-2` accent stripe, toggled between `border-l-transparent` (default) and
  `border-l-violet-400` (when `currentTrackId() === track.id`) so the 2px width reservation never
  shifts layout on toggle. Violet was chosen to stay visually distinct from the existing amber
  (mute) and sky (solo) indicators in the same header. Verified the generated CSS: Tailwind emits
  `.border-l-transparent`/`.border-l-violet-400` after `.border-neutral-800` in the built
  stylesheet, so the accent color correctly wins the cascade over the base `border-neutral-800`
  side-color.
- `src/lib/ClipView.svelte` — added a required `trackId: string` prop, passed through to
  `startClipDrag`.
- `src/lib/TrackLane.svelte` — passes `trackId={track.id}` to `ClipView`.
- `src/lib/clip-drag.svelte.ts`
  - `startClipDrag` gained a `trackId` parameter and calls `setCurrentTrack(trackId)` at the start
    of the gesture (pointer-down on a clip).
  - `startRangeDrag` calls `setCurrentTrack(trackId)` at the start of the gesture (starting a
    range drag on a lane) — it already received `trackId` as a parameter.
- `src/lib/Toolbar.svelte` — the file-picker `onchange` handler now calls
  `importFiles(files, currentTrackId(), appState.playheadS)` instead of hardcoding
  `appState.project.tracks[0].id`.
- `src/App.svelte`
  - Added `dropTargetTrackId(e: DragEvent): string`, which finds
    `document.elementFromPoint(e.clientX, e.clientY)?.closest("[data-track-id]")` and reads
    `dataset.trackId`, falling back to `currentTrackId()` when the drop lands outside any lane
    (`TrackLane.svelte`'s root div already carries `data-track-id`, unchanged).
  - `onDrop`'s non-project-file branch now calls
    `importFiles(files, dropTargetTrackId(e), appState.playheadS)`.
- `src/lib/KeyboardShortcuts.svelte`
  - Removed `firstTrackId()` (`selectedTrackIds()[0] ?? tracks[0].id` — the source of the M/⇧S
    bug, since `selectedTrackIds()` returns every track outside a range selection, so `[0]` was
    always track 1).
  - `toggleMute` and `toggleSolo` cases now call `currentTrackId()`.
  - `paste` and `duplicate` cases now call the no-arg `pasteAtPlayhead()`.
  - `split` (the `"split"` case) and `jumpEdit` are **unchanged** — both still call
    `selectedTrackIds()` directly, per the explicit "leave Split as-is" instruction.

### Commit 4 — docs
- `README.md` — updated the Import and "Multiple tracks" bullets to describe current-track
  targeting and the drop-target-under-cursor behavior and the accent stripe; updated the `m`/`⇧S`
  shortcut table rows; updated the test count (297 → 306, which was already stale before this
  task — the actual pre-task count was 302; now 306).
- `CLAUDE.md` — added `resolveTrackId` to the `doc/document.ts` architecture-map entry; added
  `currentTrackId`/`setCurrentTrack` to the `state/appState.svelte.ts` entry; added **Gotcha 14**
  explaining why `state.currentTrackId` must always be read through `currentTrackId()` and why
  `selectedTrackIds()` (which still drives Split) is a deliberately separate concept; updated the
  test count.

## Explicitly not touched

- `S` (split) still uses `selectedTrackIds()`, unchanged — per instruction.
- No multi-track selection, no per-file new-track mode, no import placement menu.
- `src/export/` untouched.
- `Toolbar.svelte`'s "Split at playhead" button also still uses `selectedTrackIds()` (it was
  already consistent with the keyboard shortcut before this task and is out of scope for the same
  reason).

## What could not be verified (no browser)

This environment has no browser, so the following are implemented and pass the build/type-check
gate but are **not visually or interactively confirmed**:

- Clicking a track header actually sets it current and the accent stripe renders at the intended
  position/color/contrast in both the default and current states.
- Pointer-down on a clip sets its track current before the drag gesture proceeds (drag itself is
  unchanged logic, already outside the automated test surface per `CLAUDE.md`'s Testing section).
- Starting a range-select drag on a lane sets that lane's track current.
- The import file-picker and toolbar button land audio on the visually-highlighted current track.
- Drag-and-drop from the OS actually resolves `elementFromPoint` to the correct lane under the
  cursor at drop time, including edge cases like dropping over a clip (clips are absolutely
  positioned over the lane `div` that carries `data-track-id`, so `closest` should still find it,
  but this was not exercised in a browser) or over the ruler/header column (should fall back to
  the resolved current track).
- The `M`/`⇧S` shortcuts now visibly acting on the correct (current) track in a multi-track
  project.
- No dev server was started or left running by this work (a pre-existing `vite`/`npm run dev`
  process was already running before this session started, was not started by this task, and was
  left as-is).

Everything else — `resolveTrackId`'s logic, the store's `currentTrackId()`/`setCurrentTrack`
plumbing, and every call site's TypeScript types — is covered by the build gate
(`svelte-check && tsc --noEmit && vite build`, 0 errors / 0 warnings / no chunk-size notice) and
the full Vitest suite (306/306 passing).
