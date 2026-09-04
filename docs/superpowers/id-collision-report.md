# Id-collision-after-reload bug: fix report

## Root cause (as given)

`newId` in `src/doc/document.ts` is a module-level counter that resets to 0 on every page load.
Nothing advanced it when a project was loaded, so after a reload the next `newId("src")`/
`newId("clip")` call could re-mint an id already present in the restored document. Since
`SourcePool.add` is a `Map.set`, a colliding source id silently **replaced** an existing source
(an unrelated clip starts playing the newly imported audio); a colliding clip id made two clips
share one id (selection/move/trim/delete on one hits both).

## Piece 1 — `adoptIds` (commit `f9c7ba4`)

### RED — failing test written first

Added to `src/doc/document.test.ts`, *before* `adoptIds` existed:

```ts
describe("id collision after a simulated reload (regression)", () => {
  it("newId mints ids that collide with a previously-restored project, unless adopted", () => {
    let p = createProject();
    p = addTrack(p, "Track 2");
    p = addClip(p, p.tracks[0].id, makeClip("src-1", 0, 1));
    p = addClip(p, p.tracks[1].id, makeClip("src-1", 2, 1));

    const existingIds = new Set<string>([
      ...p.tracks.map((t) => t.id),
      ...p.tracks.flatMap((t) => t.clips.map((c) => c.id)),
      "src-1",
    ]);

    __resetIds(); // simulated reload

    const newSrcId = newId("src");
    const newClipId = newId("clip");

    expect(existingIds.has(newSrcId)).toBe(false);
    expect(existingIds.has(newClipId)).toBe(false);
  });
});
```

Actual RED output (`npx vitest run src/doc/document.test.ts`):

```
 FAIL  src/doc/document.test.ts > id collision after a simulated reload (regression) > newId mints ids that collide with a previously-restored project, unless adopted
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/doc/document.test.ts:95:39
     93|     const newClipId = newId("clip");
     94|
     95|     expect(existingIds.has(newSrcId)).toBe(false);
       |                                       ^
     96|     expect(existingIds.has(newClipId)).toBe(false);
     97|   });

 Test Files  1 failed (1)
      Tests  1 failed | 9 passed (10)
```

The colliding ids: after `__resetIds()`, `newId("src")` mints `"src-1"`, which the restored
project already used as a `sourceId` (added to `existingIds` explicitly, standing in for a source
minted in an earlier session) — the exact "wrong clip plays the new import" corruption from the
report. The test fails at the first assertion, before the clip-id check even runs.

### GREEN

Added to `src/doc/document.ts`:

```ts
/** Advance the id counter past every id in `ids`. ... */
export function adoptIds(ids: Iterable<string>): void {
  for (const id of ids) {
    const match = /-(\d+)$/.exec(id);
    if (!match) continue;
    const n = Number(match[1]);
    if (n > idCounter) idCounter = n;
  }
}
```

Then updated the same test to call `adoptIds(existingIds)` right after the simulated reload, and
added three direct unit tests for `adoptIds` itself (advances past the highest suffix; ignores ids
with no numeric suffix; never rewinds the counter for a lower number).

Result (`npx vitest run src/doc/document.test.ts`): 13/13 passed.

## Piece 2 — wire into `loadInto` (commit `f136551`)

`loadInto` in `src/persist/project-io.svelte.ts` is the single choke point both `openProjectFile`
and `restoreAutosave` funnel through. Added, inside the existing "past this line nothing can fail,
so the swap is effectively atomic" region, immediately before `pool.clear()`:

```ts
const ids: string[] = [];
for (const t of project.tracks) {
  ids.push(t.id);
  for (const c of t.clips) ids.push(c.id);
}
for (const d of decoded) ids.push(d.id);
adoptIds(ids);
```

This collects every track id, every clip id on every track, and every decoded source id, and
adopts all of them before the pool/project swap. The decode-before-touching-state ordering (Gotcha
7) is untouched — `adoptIds` is a synchronous, non-throwing call placed after the decode loop and
before any mutation, so it doesn't reopen the atomicity gap that ordering exists to close.

### Regression test (`src/persist/project-io.test.ts`)

Round-trips a project through `packProject`/`unpackProject`, then simulates a reload and adopts
the loaded ids the same way `loadInto` does, then mints a new source id and clip id and checks
neither collides.

Because `idCounter` is a single counter shared across all prefixes, the Nth `newId()` call after a
reset always mints number N regardless of prefix — so a naive round-trip through
`createProject`/`addTrack`/`addClip` doesn't reliably collide (a first attempt at this test passed
even with the `adoptIds()` call commented out, because the "natural" ids from those helpers didn't
land on the same numbers the post-reset calls would mint). To make the test load-bearing, the
loaded document's ids are pinned to `"src-1"` and `"clip-2"` — exactly what a bare post-reset
`newId("src")` then `newId("clip")` sequence mints — so the test is a guaranteed collision without
the fix, not a lucky one.

Verified by temporarily commenting out the `adoptIds(loadedIds)` line in the test and re-running:

```
 FAIL  src/persist/project-io.test.ts > id adoption on load (regression) > adopting every track/clip/source id from a round-tripped project prevents the next mint from colliding
AssertionError: expected true to be false // Object.is equality

- Expected
+ Received

- false
+ true

 ❯ src/persist/project-io.test.ts:117:39
```

Then restored the `adoptIds` call — passes. Full suite: 302/302 passed, `npm run build` 0
errors / 0 warnings, no chunk-size notice.

## Test counts

- Before: 297 tests / 28 files.
- After: 302 tests / 28 files (4 new in `document.test.ts`: the regression test + 3 `adoptIds`
  unit tests; 1 new in `project-io.test.ts`).
- No existing test's expectations were changed. In particular, the pre-existing
  `newId`/`__resetIds` tests in `document.test.ts` (which assert literal ids like `"clip-1"`,
  `"track-3"`) still pass unmodified, since `adoptIds` only raises the counter when explicitly
  called — it has no effect on tests that never call it.

## What was NOT verified (no browser available)

- `openProjectFile` and `restoreAutosave` were not exercised end-to-end in a real browser — the
  fix is unit-tested at the `loadInto`-logic level (id collection + `adoptIds`) but not through an
  actual `.slopaudio` file open or an actual IndexedDB autosave restore, since `decodeSource`
  requires a real `AudioContext`.
- The originally-reported symptom (import after reload plays the wrong file / clips become
  "connected") was not re-reproduced live in the app; it was reproduced at the id-counter level in
  both automated tests above, which is where the root cause lives.
- No manual check that the fix also correctly prevents corruption on a *second* consecutive reload
  (reload -> import -> reload again -> import again) — the counter's monotonic "never rewind"
  behavior should handle this by construction (each `adoptIds` call only raises the counter), and
  is covered by the "never rewinds the counter for a lower number" unit test, but wasn't exercised
  through the full persistence round trip a second time.
