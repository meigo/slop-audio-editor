# Loudness matching + Glue — implementation report

Branch: `main`, starting HEAD `788d088`. Baseline: 255 tests / 25 files, `npm run build` clean
(0 errors / 0 warnings). After the first three commits: 273 tests / 27 files. After the fix-round-1
commit below: **274 tests / 27 files**. `npm run build` clean throughout (0 errors / 0 warnings, no
chunk-size notice).

Four commits, in order:

1. `ec1bb29` — `feat(audio): add BS.1770 integrated loudness measurement` (Piece 1)
2. `97db1d2` — `feat(doc): add matchLoudnessGains for automatic loudness matching` (Piece 2)
3. `daccaea` — `feat: wire up loudness matching and the Glue master-bus toggle` (Piece 3)
4. `e1eb3b8` — `fix(audio): upmix mono to dual-mono before measuring loudness` (fix round 1 — see
   the dedicated section at the end of this report)

---

## Piece 1 — `src/audio/loudness.ts`

`integratedLoudness(channels, sampleRate)`: ITU-R BS.1770 K-weighting (two biquads, hardcoded
coefficients, **48 kHz only** — noted in the file's own doc comment and in `CLAUDE.md`), 400 ms /
75%-overlap blocks, two-stage gating (absolute −70 LUFS, then relative −10 LU).

### RED

Test file written first (`src/audio/loudness.test.ts`), six tests, before `loudness.ts` existed.

```
$ npx vitest run src/audio/loudness.test.ts
 ❯ src/audio/loudness.test.ts (0 test)
 FAIL  src/audio/loudness.test.ts [ src/audio/loudness.test.ts ]
Error: Cannot find module './loudness' imported from
  /Users/meigo/Projects/slop/slop-audio-editor/src/audio/loudness.test.ts
 ❯ src/audio/loudness.test.ts:2:1
      1| import { describe, expect, it } from "vitest";
      2| import { integratedLoudness } from "./loudness";
       | ^
 Test Files  1 failed (1)
      Tests  no tests
```

Failed for the right reason: the implementation did not exist yet, not a typo or a wrong
assertion.

### GREEN

```
$ npx vitest run src/audio/loudness.test.ts --reporter=verbose
 ✓ integratedLoudness > measures a 997 Hz tone at -20 dBFS RMS as -20 LUFS (the standard calibration point) 6ms
 ✓ integratedLoudness > raises the result by +6.02 dB when the amplitude doubles 7ms
 ✓ integratedLoudness > returns -Infinity for digital silence 2ms
 ✓ integratedLoudness > returns -Infinity rather than throwing when input is shorter than one 400 ms block 0ms
 ✓ integratedLoudness > sums per-channel power rather than averaging: identical-channel stereo reads 10*log10(2) louder than mono 5ms
 ✓ integratedLoudness > returns -Infinity for an empty channel list 0ms
 Test Files  1 passed (1)
      Tests  6 passed (6)
```

The −20 LUFS compliance test (a 997 Hz tone at amplitude `0.1*sqrt(2)`, RMS = 0.1 = −20 dBFS,
`toBeCloseTo(-20, 1)`) passed on the first real implementation — this is the standard calibration
check, and it's what validates the whole chain (coefficients, gating, and the `-0.691` offset)
end to end rather than any one piece in isolation.

### A deliberate deviation from the brief's wording — flagged, not silently "fixed"

The brief's bullet said: *"Stereo with identical channels measures **the same as** the mono
equivalent (channel summing is a sum of weighted power, not an average — check this deliberately,
it is easy to get wrong by averaging)."*

That combination is mathematically inconsistent. Given the algorithm's own formula (`G_c = 1.0`
for both L and R, weighted power = `Σ_channels G_c * meanSquare_c`), a stereo signal with the
identical content in both channels has weighted power `2*z` where a mono channel of that content
has `z`. Loudness is `-0.691 + 10*log10(power)`, so the stereo case comes out **10*log10(2) ≈
+3.01 dB louder** than the mono case — not the same. This is a well-documented, intentional
property of BS.1770 (summing, not averaging, is exactly why dual-mono content reads louder than
true mono at the same per-channel level; it's the reason a mistaken "average instead of sum"
implementation is a real, recurring bug in loudness meters).

I implemented the algorithm exactly as specified (sum, not average) and wrote the test to assert
the mathematically-necessary result: `stereo - mono ≈ 10*log10(2)`, not `stereo === mono`. The
test's own comment explains why. I did not change the formula to make "measures the same" literally
true, since the formula was given explicitly and unambiguously and doing so would contradict it —
per the brief's own instruction to report rather than improvise when something looks wrong.

---

## Piece 2 — `src/doc/loudness-match.ts`

`matchLoudnessGains(entries)`: targets the median LUFS of the finite entries, returns a linear
gain correction per entry, clamped to ±`MAX_MATCH_DB` (12), skipping non-finite entries entirely.

### RED

```
$ npx vitest run src/doc/loudness-match.test.ts
 ❯ src/doc/loudness-match.test.ts (0 test)
 FAIL  src/doc/loudness-match.test.ts [ src/doc/loudness-match.test.ts ]
Error: Cannot find module './loudness-match' imported from
  /Users/meigo/Projects/slop/slop-audio-editor/src/doc/loudness-match.test.ts
 Test Files  1 failed (1)
      Tests  no tests
```

### GREEN (with one self-caught bug on the way)

First implementation run:

```
 ✓ targets the median LUFS: below-median clips are turned down, above-median turned up 1ms
 × uses the mean of the two middle values as the median for an even count 1ms
   → expected 3.9810717055349722 to be close to 5.623413251903491, received difference is 1.642341546368519
 ✓ clamps a correction of 40 dB down to MAX_MATCH_DB, never boosting past the clamp 0ms
 ✓ skips non-finite entries entirely — silence is never boosted 0ms
 ✓ returns [] for an empty list 0ms
 ✓ returns [] when every entry is non-finite 0ms
 ✓ gives a single entry unity gain — it is its own median 0ms
 Tests  1 failed | 6 passed (7)
```

That one failure was my test's own arithmetic error, not the implementation's: the fixture used
entries needing a +15 dB correction, which is legitimately clamped to +12 dB by `MAX_MATCH_DB` —
I had asserted the unclamped value. Fixed the fixture to use corrections that stay inside the
clamp so the test actually isolates "even-count median," then reran:

```
$ npx vitest run src/doc/loudness-match.test.ts --reporter=verbose
 ✓ targets the median LUFS: below-median clips are turned down, above-median turned up 1ms
 ✓ uses the mean of the two middle values as the median for an even count 0ms
 ✓ clamps a correction of 40 dB down to MAX_MATCH_DB, never boosting past the clamp 0ms
 ✓ skips non-finite entries entirely — silence is never boosted 0ms
 ✓ returns [] for an empty list 0ms
 ✓ returns [] when every entry is non-finite 0ms
 ✓ gives a single entry unity gain — it is its own median 0ms
 Test Files  1 passed (1)
      Tests  7 passed (7)
```

---

## Piece 3 — wiring

Not subject to the TDD mandate (that applied only to `loudness.ts` and `loudness-match.ts`), but
existing tests were extended where the type changes required it, plus a couple of new
consistency checks:

- **`src/audio/pool.ts`** — `Source.loudnessLufs: number`; `decodeSource` now runs two chunked
  passes over the decoded channels (`computePeaksChunked`, then the new `computeLoudnessChunked`),
  each yielding to the event loop, with import progress split across the two halves.
  `computeLoudnessChunked` K-weights each channel in ~1M-sample chunks (filter state carried
  across chunk boundaries via a small stateful object — an IIR filter cannot be split any other
  way), then accumulates block power in chunks of 256 blocks. To support this without duplicating
  the DSP math, `loudness.ts` was refactored (pure refactor, no behavior change) to expose
  `createKWeightFilter`, `weightedBlockPower`, and `gatedLoudnessFromBlockPowers` — the same
  pieces `integratedLoudness` itself now composes. Re-ran `loudness.test.ts` after the refactor:
  all 6 still green, confirming no behavior drift.
  Added to `pool.test.ts`: an equivalence test between `computeLoudnessChunked` and
  `integratedLoudness` over a 45 s signal (crosses the K-weight chunk boundary twice and the
  256-block chunk boundary), plus the empty-channels and shorter-than-one-block edge cases —
  mirroring the existing `computePeaksChunked` vs `computePeaks` equivalence tests.
- **`src/doc/document.ts`** / **`src/doc/edits.ts`** — `Project.glue: boolean` (default `false`
  in `createProject`); `setGlue(p, glue)`, pure, same-object-on-no-op. Test added to
  `edits.test.ts`.
- **`src/state/appState.svelte.ts`** — `matchLoudness()`: walks every track/clip, looks up each
  clip's source in the pool (skipping clips whose source is missing), calls `matchLoudnessGains`,
  and applies every resulting `setClipGain` inside one `commit` call — one undo step for the
  whole operation. Not unit-tested (this module has no test file in the project, by existing
  convention — it's `$state`/Svelte-coupled).
- **`src/audio/render.ts`** — when `project.glue`, builds
  `highpass(100Hz) → lowpass(7500Hz) → DynamicsCompressorNode(threshold -18dB, knee 6, ratio 3,
  attack 0.02s, release 0.25s) → gain(+3dB makeup)` between the master gain and `ctx.destination`.
  When `glue` is false, the code path is exactly what it was before Glue existed
  (`masterGain.connect(ctx.destination)`), and the glue nodes are never constructed — verified by
  re-running `render.test.ts` (all `glue: false` fixtures) unchanged and green. The error-cleanup
  path was extended to also disconnect the glue chain if a later node in the graph throws, matching
  the existing "disconnect whatever was built so far" pattern.
- **`src/persist/project-file.ts`** — `unpackProject` defaults `glue` to `false` when absent (old
  files); no version bump. Test added: packs a project object with the `glue` key stripped, confirms
  `unpackProject(...).project.glue === false`.
- **`src/lib/Toolbar.svelte`** — a "Glue" checkbox next to Snap, applied through `commit`
  (`setGlue`) since it's a document field affecting export, like mute; a "Match loudness" button
  (Lucide `Scale` icon) calling `matchLoudness()`.
- **`README.md`** / **`CLAUDE.md`** — documented both features, including the loudness-match
  caveat (measured per source at import time, not per clip's trimmed region) and the K-weighting
  coefficients' 48 kHz-only assumption. Fixed a stale test count in both files (234/23 → 273/27).

### Full-suite verification after Piece 3

```
$ npm test
 Test Files  27 passed (27)
      Tests  273 passed (273)

$ npm run build
svelte-check: 0 ERRORS 0 WARNINGS
vite build: ✓ built in 934ms
dist/assets/src-DlHGd8JW.js   668.39 kB │ gzip: 168.63 kB   (unchanged order of magnitude — no new
                                                              chunk-size warning)
```

---

## What could not be verified

Per the task's constraints, no browser was run. Not verified by ear or eye:

- That the Glue chain sounds like gentle cohesion rather than something audibly wrong (frequency
  response, compressor character, makeup gain balance) — only the node-graph wiring and parameter
  values were checked against the spec.
- That the "Match loudness" button and "Glue" checkbox render and behave correctly in the actual
  UI (layout, click targets, checkbox state reflecting `appState.project.glue` after undo/redo).
- That a real multi-minute import doesn't visibly stutter — `computeLoudnessChunked`'s chunking and
  yielding was verified logically (matches `computePeaksChunked`'s shape, has an equivalence test
  proving it produces the same numeric result as the unchunked path) but not profiled in a browser.
- `svelte-check`/`tsc`/`vite build` all passed, which is the project's stated bar for UI/graph code
  that isn't otherwise unit-tested — per the brief, this is by design.

---

## Fix round 1 — mono/stereo playback correction (`e1eb3b8`)

The coordinator confirmed the contradiction flagged above (brief said "measures the same" *and*
"sum, not average" — mutually exclusive) and gave the actual resolution: neither of my two options.
The real reason "measures the same" felt right is that **Web Audio upmixes a mono buffer to stereo
by duplication, not attenuation**, and this app always renders stereo (`AudioContext`'s default
destination; `OfflineAudioContext(2, …)` for export). So a mono file and its dual-mono equivalent
sound identical *through this app*, even though a faithful BS.1770 meter correctly measures them
3.01 dB apart. Left alone, "Match loudness" would over-boost every mono clip by ~3 dB in exactly
the mixed mono/stereo projects the feature exists for.

Ruling: keep `integratedLoudness` exactly as it was (faithful BS.1770, proved by its own compliance
test) and upmix at the call site that knows about playback context — `computeLoudnessChunked` in
`pool.ts`.

### RED

Test written first, in `pool.test.ts`, before touching `pool.ts`:

```
$ npx vitest run src/audio/pool.test.ts --reporter=verbose
 ✓ computeLoudnessChunked > matches unchunked integratedLoudness exactly across multiple K-weight and block chunk boundaries
 ✓ computeLoudnessChunked > returns -Infinity for an empty channel list
 ✓ computeLoudnessChunked > returns -Infinity rather than throwing for input shorter than one 400 ms block
 × computeLoudnessChunked > upmixes mono to dual-mono before measuring, matching Web Audio's own
   mono->stereo playback upmix (duplication, not attenuation) — removing that upmix would reopen
   the naked BS.1770 gap and make a mono measurement read 10*log10(2) (~3.01 dB) quieter than its
   dual-mono equivalent
   → expected -29.030884485250603 to be close to -26.02058452861079, received difference is
     3.0102999566398125, but expected 0.005

 Tests  1 failed | 10 passed (11)
```

Failed for exactly the right reason: the gap measured is **3.0103 dB** — the precise
`10*log10(2)` BS.1770 signature — confirming the test is catching the intended bug (no upmix,
mono under-measured relative to what's actually heard), not some unrelated mistake.

### GREEN

Added the upmix in `computeLoudnessChunked`: after K-weighting, `measured = weighted.length === 1
? [weighted[0], weighted[0]] : weighted`, then block power is computed from `measured` instead of
`weighted`. `weighted[0]` is referenced twice, not duplicated, so a mono file's memory footprint is
unchanged.

```
$ npx vitest run src/audio/pool.test.ts src/audio/loudness.test.ts --reporter=verbose
 ✓ loudness.test.ts > integratedLoudness > measures a 997 Hz tone at -20 dBFS RMS as -20 LUFS ...
 ✓ loudness.test.ts > integratedLoudness > raises the result by +6.02 dB when the amplitude doubles
 ✓ loudness.test.ts > integratedLoudness > returns -Infinity for digital silence
 ✓ loudness.test.ts > integratedLoudness > returns -Infinity rather than throwing when input is shorter than one 400 ms block
 ✓ loudness.test.ts > integratedLoudness > PINNED BS.1770 behavior — sums per-channel power rather
   than averaging: identical-channel stereo reads 10*log10(2) louder than mono. [...]
 ✓ loudness.test.ts > integratedLoudness > returns -Infinity for an empty channel list
 ✓ pool.test.ts > SourcePool (5 tests)
 ✓ pool.test.ts > computePeaksChunked (2 tests)
 ✓ pool.test.ts > computeLoudnessChunked > matches unchunked integratedLoudness exactly across ...
 ✓ pool.test.ts > computeLoudnessChunked > returns -Infinity for an empty channel list
 ✓ pool.test.ts > computeLoudnessChunked > returns -Infinity rather than throwing for input shorter ...
 ✓ pool.test.ts > computeLoudnessChunked > upmixes mono to dual-mono before measuring, ...

 Test Files  2 passed (2)
      Tests  17 passed (17)
```

`loudness.test.ts`'s stereo-vs-mono test was kept with its exact original assertion
(`stereo - mono ≈ 10*log10(2)`) — only its name/comment changed, to state explicitly that this gap
is intentional and pinned at that layer, and that `computeLoudnessChunked` corrects for it one
layer up. Re-running it confirms the +3.01 dB behavior is unchanged in `integratedLoudness` itself.

Added a numbered gotcha (11) to `CLAUDE.md` explaining the split: `integratedLoudness` stays
faithful (compliance test proves it); `computeLoudnessChunked` corrects for Web Audio's mono→stereo
duplication upmix; moving the correction into `integratedLoudness` would break its own compliance
test, and leaving it out of `computeLoudnessChunked` would silently over-boost every mono clip.

### Full-suite verification

```
$ npm test
 Test Files  27 passed (27)
      Tests  274 passed (274)

$ npm run build
svelte-check: 0 ERRORS 0 WARNINGS
vite build: ✓ built in 973ms — chunk sizes unchanged, no new warning
```

### What could not be verified (fix round 1)

Same limitation as before: no browser was run, so the audible claim ("a mono file and its
dual-mono stereo equivalent sound identical through this app") rests on the documented behavior of
Web Audio's default "speakers" channel-interpretation upmix, not on listening to it in this app.

---

## Fix round 2 — the compressor's own makeup gain (`c79ea36`)

The coordinator built the Glue chain by hand in an `OfflineAudioContext` and measured each stage
with a 1 kHz sine sitting inside the passband, finding the design premise behind the original
`+3 dB` makeup gain was wrong:

```
after highpass:         +0.05 dB   (transparent, as expected)
after highpass+lowpass: +0.13 dB   (transparent, as expected)
after the compressor:   +6.26 dB   <- the compressor BOOSTS
```

Identical for mono and stereo, so not a channel-count effect. Sweeping input peak level through
the compressor alone (threshold -18 dB, knee 6 dB, ratio 3:1):

| input peak (dBFS) | compressor output (dB) |
|---|---|
| -34 | +6.13 |
| -26 | +6.13 |
| -20 | +6.13 |
| -12 | +4.01 |
| -6  | +0.12 |
| -1  | -3.12 |

`DynamicsCompressorNode` is not a pure attenuator: the Web Audio spec gives it an internal makeup
gain derived from threshold/knee/ratio, chosen so the loudest possible signal still maps to 1.0.
Below the threshold this shows up as a flat boost, tapering to attenuation as input gets louder.
It's spec-defined and deterministic for fixed settings — portable across compliant browsers, not a
Chrome quirk.

**The brief's original justification for `GLUE_MAKEUP_DB = +3` ("the compressor only reduces") was
false.** My implementation of it was correct given that premise; the premise was the defect. The
practical effect: quiet material (most of what a compressor with an -18 dBFS threshold ever
touches) came out of Glue about `+6.13 + 3 = +9.3` dB louder — exactly the "toggle behaves like a
volume control" failure Glue was designed to avoid, just in the boost direction instead of cut.

### The fix

Cancel the compressor's own below-threshold makeup instead of adding to it. In `render.ts`:

```ts
const GLUE_TRIM_DB = -6;
const GLUE_TRIM_GAIN = 10 ** (GLUE_TRIM_DB / 20);
```

(`-6` rather than the measured `-6.13` — the coordinator's ruling used a round number close to the
measured value; both are well inside what a "gentle" master-bus effect calls for exact precision
on.) The `makeup` gain node and variable were renamed to `trim` so the name doesn't keep the
disproven "adds gain" mental model alive for the next reader. No other part of the chain changed:
filters, compressor settings, `planSchedule`, and the bit-identical-when-Glue-is-off behavior are
all exactly as before — the coordinator verified the off-path separately (byte-identical render
output).

This constant is not unit-tested, consistent with the project's existing position that
`render.ts`'s node graph is build-gate-verified rather than unit-tested — it was derived by
building the chain in an `OfflineAudioContext` and measuring rendered output, not by a Vitest
assertion. `README.md` and `CLAUDE.md` (a new gotcha 12) were updated to state the corrected
mental model — trim, not makeup — and to preserve the measured table above so a future settings
change knows to re-measure rather than guess.

### Full-suite verification

```
$ npm test
 Test Files  27 passed (27)
      Tests  274 passed (274)

$ npm run build
svelte-check: 0 ERRORS 0 WARNINGS
vite build: ✓ built in 896ms — chunk sizes unchanged, no new warning
```

### What could not be verified (fix round 2)

No browser was run on my end for this round either — the measured table above is the
coordinator's own measurement, taken by hand-building the Glue chain in an `OfflineAudioContext`,
not something I reproduced independently. I verified the code change matches the ruling exactly
(constant value, sign, node rename) and that the rest of the chain is untouched, but I have not
independently re-measured the compressor's makeup curve.
