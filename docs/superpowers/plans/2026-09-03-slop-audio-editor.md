# slop-audio-editor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A browser-based multitrack audio editor — import audio onto tracks, move/trim/cut/copy-paste clips, set track and clip gain, apply fade curves, and export a mixdown.

**Architecture:** Clip-based non-destructive editing. A tiny plain-data document (no sample data) holds tracks and clips; a separate session-scoped media pool holds decoded `AudioBuffer`s. All editing is pure functions over the document, so undo is a `structuredClone` snapshot. One pure `planSchedule()` turns the document into a list of scheduled clips; live playback renders it against an `AudioContext` and export renders the same plan against an `OfflineAudioContext`, so preview and export cannot drift apart.

**Tech Stack:** Svelte 5 (runes mode), TypeScript, Vite, Tailwind 4, Vitest (node env), `@lucide/svelte`, fflate, mediabunny, Cloudflare Workers static assets.

**Spec:** `docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md`

## Global Constraints

Copied verbatim from the spec. Every task's requirements implicitly include this section.

- **Build gate:** `npm run build` = `svelte-check && tsc --noEmit && vite build`. The bar for every task is **0 errors, 0 warnings**.
- **Svelte 5 runes mode** — `svelte.config.js` sets `compilerOptions.runes: true`. All components are runes-mode.
- **Svelte `$state` import-alias rule** (inherited gotcha from slop-animator): a component that uses the **`$state` rune** must NOT `import { state } from "...appState.svelte"` — it trips `store_rune_conflict`. Use `import { state as appState }`. `$effect`/`$derived`/`$props` do not collide.
- **Project sample rate: 48000 Hz**, fixed. The shared `AudioContext` is constructed at this rate so `decodeAudioData` resamples every import on the way in.
- **Export channels: 2 (stereo).**
- **`MIN_CLIP_S = 0.01`** — a clip may never be shorter than 10 ms.
- **`PEAK_SAMPLES_PER_PAIR = 256`** — one min/max peak pair per 256 samples.
- **Undo history cap: 100 entries.**
- **Tests are Vitest, node environment, no DOM.** Only pure logic is unit-tested. Canvas / Web Audio / drag code is verified by hand — those tasks carry explicit manual verification steps instead of test code.
- **Solo is never in the document.** It is view state, passed into `planSchedule` as a parameter. Mixdown passes an empty set.
- **Time is seconds (float64) everywhere.** No frames, no bars, no samples in the document.
- **Timeline `<div>`s carry pointer handlers** and will trip `a11y_no_static_element_interactions`
  and `a11y_click_events_have_key_events`. Because the build gate is 0 warnings, put an explicit
  `<!-- svelte-ignore a11y_no_static_element_interactions -->` (and the click-events one where it
  fires) directly above each such element. The timeline is a pointer surface with a complete
  keyboard layer of its own (Task 26), so these warnings are genuinely not actionable — suppress
  them per element, never by disabling the check globally.
- **`$state.snapshot` and store imports are only legal in `.svelte` / `.svelte.ts` files.** A plain
  `.ts` module that needs a snapshot takes one as an argument instead.

## Task ordering

Tasks 1–16 are pure and node-testable: real TDD, real review gates, no browser. Tasks 17–29 assemble the browser app on top of that core. This deliberately reorders the spec's §15 milestones, which interleaved untestable canvas work into every stage.

**Module-map refinements over spec §11**, all splits rather than additions of scope: decoding lives
with the media pool in `src/audio/pool.ts` (not a separate `decode.ts`); the node-graph builder is
split out of the engine into `src/audio/render.ts` so the mixdown can share it; and four pure
helpers earn their own tested modules — `src/doc/overlap.ts` (clip slicing and overwrite),
`src/doc/clipboard.ts`, `src/lib/geometry.ts`, `src/lib/hit-test.ts` and `src/lib/shortcuts.ts`.

---

### Task 1: Project scaffold

**Files:**
- Create: `package.json`, `vite.config.ts`, `svelte.config.js`, `tsconfig.json`, `tsconfig.node.json`, `index.html`, `src/main.ts`, `src/App.svelte`, `src/app.css`, `wrangler.jsonc`, `.gitignore` (exists), `README.md`
- Test: `src/__tests__/scaffold.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: a working `npm run dev` / `npm run build` / `npm test`, and the `src/` layout every later task writes into.

- [ ] **Step 1: Create `package.json`**

```json
{
  "name": "slop-audio-editor",
  "private": true,
  "version": "0.0.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "svelte-check && tsc --noEmit && vite build",
    "preview": "vite preview",
    "deploy": "npm run build && wrangler deploy",
    "test": "vitest run",
    "test:watch": "vitest",
    "check": "svelte-check"
  },
  "devDependencies": {
    "@sveltejs/vite-plugin-svelte": "^7.0.0",
    "@tailwindcss/vite": "^4.2.2",
    "svelte": "^5.55.1",
    "svelte-check": "^4.4.6",
    "tailwindcss": "^4.2.2",
    "typescript": "~5.9.3",
    "vite": "^8.0.1",
    "vitest": "^4.1.2",
    "wrangler": "^4.115.0"
  },
  "dependencies": {
    "@lucide/svelte": "^1.3.0",
    "@mediabunny/mp3-encoder": "^1.0.0",
    "fflate": "^0.8.3",
    "mediabunny": "^1.46.0"
  }
}
```

- [ ] **Step 2: Create the config files**

`svelte.config.js`:
```js
import { vitePreprocess } from "@sveltejs/vite-plugin-svelte";

export default {
  preprocess: vitePreprocess(),
  compilerOptions: { runes: true },
};
```

`vite.config.ts`:
```ts
import { defineConfig } from "vite";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
```

`tsconfig.json`:
```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "bundler",
    "lib": ["ES2022", "DOM", "DOM.Iterable"],
    "strict": true,
    "noUnusedLocals": true,
    "noUnusedParameters": true,
    "noUncheckedIndexedAccess": false,
    "skipLibCheck": true,
    "isolatedModules": true,
    "verbatimModuleSyntax": true,
    "noEmit": true,
    "types": ["vite/client"]
  },
  "include": ["src/**/*.ts", "src/**/*.svelte"]
}
```

`wrangler.jsonc` (assets-only — no `main`, so no Worker invocations are billed):
```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "slop-audio-editor",
  "compatibility_date": "2026-09-01",
  "assets": { "directory": "./dist" }
}
```

- [ ] **Step 3: Create the app entry**

`index.html`:
```html
<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>slop-audio-editor</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

`src/app.css`:
```css
@import "tailwindcss";

html, body, #app { height: 100%; margin: 0; }
body { overscroll-behavior: none; }
```

`src/main.ts`:
```ts
import { mount } from "svelte";
import "./app.css";
import App from "./App.svelte";

export default mount(App, { target: document.getElementById("app")! });
```

`src/App.svelte`:
```svelte
<div class="flex h-full items-center justify-center bg-neutral-900 text-neutral-400">
  slop-audio-editor
</div>
```

- [ ] **Step 4: Write a test that proves the harness runs**

`src/__tests__/scaffold.test.ts`:
```ts
import { describe, expect, it } from "vitest";

describe("test harness", () => {
  it("runs in a node environment with no DOM", () => {
    expect(typeof document).toBe("undefined");
  });
});
```

- [ ] **Step 5: Install and verify**

Run: `npm install && npm test && npm run build`
Expected: 1 test passes; build completes with **0 errors, 0 warnings**.

- [ ] **Step 6: Write `README.md`**

```markdown
# slop-audio-editor

Browser-based multitrack audio editor: import audio onto tracks, move/trim/cut/copy-paste clips,
set track and clip gain, apply fade curves, export a mixdown.

**Stack:** Svelte 5 + TypeScript + Vite + Tailwind 4 + Vitest. No server, no upload — audio never
leaves the browser.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `svelte-check && tsc --noEmit && vite build` (bar: 0 errors, 0 warnings)
- `npm test` — Vitest
- `npm run deploy` — build, then `wrangler deploy` to Cloudflare Workers static assets

## Design

See `docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md`.
```

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "chore: scaffold Vite + Svelte 5 + Tailwind 4 + Vitest"
```

---

### Task 2: Document types and derived values

**Files:**
- Create: `src/doc/document.ts`
- Test: `src/doc/document.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `PROJECT_SAMPLE_RATE = 48000`, `MIN_CLIP_S = 0.01`, `PEAK_SAMPLES_PER_PAIR = 256`
  - `type FadeShape = "linear" | "equalPower" | "exponential"`
  - `interface Clip`, `interface Track`, `interface Project` (fields exactly as written below)
  - `newId(prefix: string): string`, `__resetIds(): void`
  - `createProject(name?: string): Project`, `createTrack(name: string): Track`
  - `clipEndS(c: Clip): number`, `trackDurationS(t: Track): number`, `projectDurationS(p: Project): number`
  - `findTrack(p: Project, trackId: string): Track | undefined`
  - `findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined`

- [ ] **Step 1: Write the failing test**

`src/doc/document.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import {
  __resetIds, clipEndS, createProject, createTrack, findClip, findTrack,
  newId, projectDurationS, trackDurationS, type Clip,
} from "./document";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: newId("clip"), sourceId: "src-1", startS: 0, inS: 0, durS: 1,
    gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear", ...over,
  };
}

beforeEach(() => __resetIds());

describe("newId", () => {
  it("is unique and prefixed", () => {
    expect(newId("clip")).toBe("clip-1");
    expect(newId("clip")).toBe("clip-2");
    expect(newId("track")).toBe("track-3");
  });
});

describe("createProject", () => {
  it("starts with one empty track and unity master gain", () => {
    const p = createProject();
    expect(p.tracks).toHaveLength(1);
    expect(p.tracks[0].clips).toEqual([]);
    expect(p.masterGain).toBe(1);
  });
});

describe("createTrack", () => {
  it("is unmuted at unity gain with no clips", () => {
    const t = createTrack("VO");
    expect(t).toMatchObject({ name: "VO", gain: 1, muted: false, clips: [] });
  });
});

describe("clipEndS", () => {
  it("is startS + durS", () => {
    expect(clipEndS(clip({ startS: 2.5, durS: 1.25 }))).toBe(3.75);
  });
});

describe("trackDurationS", () => {
  it("is 0 for an empty track", () => {
    expect(trackDurationS(createTrack("x"))).toBe(0);
  });

  it("is the end of the last clip", () => {
    const t = createTrack("x");
    t.clips = [clip({ startS: 0, durS: 1 }), clip({ startS: 5, durS: 2 })];
    expect(trackDurationS(t)).toBe(7);
  });
});

describe("projectDurationS", () => {
  it("is the maximum track duration, not the sum", () => {
    const p = createProject();
    p.tracks[0].clips = [clip({ startS: 0, durS: 3 })];
    p.tracks.push(createTrack("b"));
    p.tracks[1].clips = [clip({ startS: 0, durS: 10 })];
    expect(projectDurationS(p)).toBe(10);
  });

  it("is 0 for a project with no clips", () => {
    expect(projectDurationS(createProject())).toBe(0);
  });
});

describe("lookups", () => {
  it("finds a track and a clip, and returns undefined for unknown ids", () => {
    const p = createProject();
    const c = clip();
    p.tracks[0].clips = [c];
    expect(findTrack(p, p.tracks[0].id)).toBe(p.tracks[0]);
    expect(findTrack(p, "nope")).toBeUndefined();
    expect(findClip(p, c.id)).toEqual({ track: p.tracks[0], clip: c });
    expect(findClip(p, "nope")).toBeUndefined();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/document.test.ts`
Expected: FAIL — `Failed to resolve import "./document"`.

- [ ] **Step 3: Write the implementation**

`src/doc/document.ts`:
```ts
/** Core document model. Plain data only — no AudioBuffer, no sample data, no DOM.
 *  This is what undo snapshots and what project.json serialises. */

export const PROJECT_SAMPLE_RATE = 48000;
/** A clip may never be trimmed shorter than this. Zero would be an invisible draggable edge. */
export const MIN_CLIP_S = 0.01;
export const PEAK_SAMPLES_PER_PAIR = 256;

export type FadeShape = "linear" | "equalPower" | "exponential";

export interface Clip {
  id: string;
  sourceId: string;
  /** Position on the timeline, seconds. */
  startS: number;
  /** Offset into the source buffer, seconds. */
  inS: number;
  /** Length on the timeline == length of source consumed, seconds. */
  durS: number;
  /** Linear. */
  gain: number;
  fadeInS: number;
  fadeOutS: number;
  fadeShape: FadeShape;
}

export interface Track {
  id: string;
  name: string;
  /** INVARIANT: sorted by startS, non-overlapping. */
  clips: Clip[];
  /** Linear; the fader displays dB. */
  gain: number;
  /** Affects EXPORT. Solo does not live here — it is view state (see the spec, §3). */
  muted: boolean;
}

export interface Project {
  name: string;
  tracks: Track[];
  masterGain: number;
}

let idCounter = 0;

export function newId(prefix: string): string {
  return `${prefix}-${++idCounter}`;
}

/** Test-only: makes ids deterministic per test. Never called by app code. */
export function __resetIds(): void {
  idCounter = 0;
}

export function createTrack(name: string): Track {
  return { id: newId("track"), name, clips: [], gain: 1, muted: false };
}

export function createProject(name = "Untitled"): Project {
  return { name, tracks: [createTrack("Track 1")], masterGain: 1 };
}

export function clipEndS(c: Clip): number {
  return c.startS + c.durS;
}

export function trackDurationS(t: Track): number {
  let end = 0;
  for (const c of t.clips) end = Math.max(end, clipEndS(c));
  return end;
}

/** The project's length is the LAST clip end across all tracks — computed, never stored. */
export function projectDurationS(p: Project): number {
  let end = 0;
  for (const t of p.tracks) end = Math.max(end, trackDurationS(t));
  return end;
}

export function findTrack(p: Project, trackId: string): Track | undefined {
  return p.tracks.find((t) => t.id === trackId);
}

export function findClip(p: Project, clipId: string): { track: Track; clip: Clip } | undefined {
  for (const track of p.tracks) {
    const clip = track.clips.find((c) => c.id === clipId);
    if (clip) return { track, clip };
  }
  return undefined;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/document.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify the build gate**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/doc/document.ts src/doc/document.test.ts
git commit -m "feat: document model — Project/Track/Clip types and derived lengths"
```

---

### Task 3: Clip slicing and the overwrite primitive

The trickiest pure function in the codebase, so it gets its own task. `sliceClip` is reused by split, delete-range and overwrite; `insertClip` is what makes the non-overlap invariant true.

**Files:**
- Create: `src/doc/overlap.ts`
- Test: `src/doc/overlap.test.ts`

**Interfaces:**
- Consumes: `Clip`, `MIN_CLIP_S`, `clipEndS`, `newId` from `./document`
- Produces:
  - `clampFades(c: Clip): Clip`
  - `sliceClip(c: Clip, fromS: number, toS: number): Clip | null` — the part of `c` within `[fromS, toS)` in TIMELINE seconds, with `inS` advanced to match. Keeps `c.id`; callers producing two pieces must reassign one.
  - `insertClip(clips: Clip[], incoming: Clip): Clip[]` — sorted, non-overlapping, incoming wins.

- [ ] **Step 1: Write the failing test**

`src/doc/overlap.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, newId, type Clip } from "./document";
import { clampFades, insertClip, sliceClip } from "./overlap";

function clip(over: Partial<Clip> = {}): Clip {
  return {
    id: newId("clip"), sourceId: "src-1", startS: 0, inS: 0, durS: 10,
    gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear", ...over,
  };
}

beforeEach(() => __resetIds());

describe("clampFades", () => {
  it("leaves fades that fit alone, returning the same object", () => {
    const c = clip({ durS: 10, fadeInS: 1, fadeOutS: 2 });
    expect(clampFades(c)).toBe(c);
  });

  it("scales overlapping fades down proportionally to fill exactly the duration", () => {
    const c = clampFades(clip({ durS: 3, fadeInS: 2, fadeOutS: 4 }));
    expect(c.fadeInS).toBeCloseTo(1);
    expect(c.fadeOutS).toBeCloseTo(2);
    expect(c.fadeInS + c.fadeOutS).toBeCloseTo(3);
  });

  it("clamps a single fade longer than the clip", () => {
    expect(clampFades(clip({ durS: 2, fadeInS: 5, fadeOutS: 0 })).fadeInS).toBe(2);
  });
});

describe("sliceClip", () => {
  it("returns the clip unchanged when the window contains it", () => {
    const c = clip({ startS: 2, durS: 3 });
    expect(sliceClip(c, 0, 100)).toEqual(c);
  });

  it("advances inS by the amount cut off the head", () => {
    const c = clip({ startS: 2, inS: 5, durS: 10 });
    const s = sliceClip(c, 6, 100)!;
    expect(s.startS).toBe(6);
    expect(s.inS).toBe(9); // 5 + (6 - 2)
    expect(s.durS).toBe(6);
  });

  it("shortens durS without touching inS when only the tail is cut", () => {
    const c = clip({ startS: 2, inS: 5, durS: 10 });
    const s = sliceClip(c, 0, 8)!;
    expect(s).toMatchObject({ startS: 2, inS: 5, durS: 6 });
  });

  it("returns null when nothing survives", () => {
    expect(sliceClip(clip({ startS: 0, durS: 5 }), 10, 20)).toBeNull();
  });

  it("returns null rather than a sliver shorter than MIN_CLIP_S", () => {
    expect(sliceClip(clip({ startS: 0, durS: 5 }), 4.999, 20)).toBeNull();
  });

  it("clamps fades that no longer fit the slice", () => {
    const s = sliceClip(clip({ startS: 0, durS: 10, fadeInS: 4, fadeOutS: 4 }), 0, 3)!;
    expect(s.fadeInS + s.fadeOutS).toBeCloseTo(3);
  });
});

describe("insertClip", () => {
  it("keeps clips that do not overlap and sorts by startS", () => {
    const a = clip({ startS: 20, durS: 5 });
    const b = clip({ startS: 0, durS: 5 });
    expect(insertClip([a], b).map((c) => c.startS)).toEqual([0, 20]);
  });

  it("treats touching edges as no overlap", () => {
    const a = clip({ startS: 0, durS: 5 });
    const b = clip({ startS: 5, durS: 5 });
    expect(insertClip([a], b)).toHaveLength(2);
  });

  it("trims the tail of a clip the incoming one lands on", () => {
    const a = clip({ startS: 0, inS: 0, durS: 10 });
    const b = clip({ startS: 6, durS: 4 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: a.id, startS: 0, inS: 0, durS: 6 });
  });

  it("trims the head of a clip the incoming one lands on, advancing inS", () => {
    const a = clip({ startS: 5, inS: 2, durS: 10 });
    const b = clip({ startS: 0, durS: 8 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(2);
    expect(out[1]).toMatchObject({ id: a.id, startS: 8, inS: 5, durS: 7 });
  });

  it("removes a clip the incoming one fully covers", () => {
    const a = clip({ startS: 2, durS: 3 });
    const b = clip({ startS: 0, durS: 10 });
    expect(insertClip([a], b)).toEqual([b]);
  });

  it("splits a clip the incoming one lands inside, giving the tail a NEW id", () => {
    const a = clip({ startS: 0, inS: 0, durS: 10 });
    const b = clip({ startS: 4, durS: 2 });
    const out = insertClip([a], b);
    expect(out).toHaveLength(3);
    expect(out[0]).toMatchObject({ id: a.id, startS: 0, inS: 0, durS: 4 });
    expect(out[1]).toBe(b);
    expect(out[2]).toMatchObject({ startS: 6, inS: 6, durS: 4 });
    expect(out[2].id).not.toBe(a.id);
  });

  it("resolves overlaps against several existing clips at once", () => {
    const a = clip({ startS: 0, durS: 4 });
    const b = clip({ startS: 4, durS: 4 });
    const c = clip({ startS: 8, durS: 4 });
    const incoming = clip({ startS: 2, durS: 8 });
    const out = insertClip([a, b, c], incoming);
    expect(out.map((x) => [x.startS, x.durS])).toEqual([[0, 2], [2, 8], [10, 2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/overlap.test.ts`
Expected: FAIL — `Failed to resolve import "./overlap"`.

- [ ] **Step 3: Write the implementation**

`src/doc/overlap.ts`:
```ts
import { MIN_CLIP_S, clipEndS, newId, type Clip } from "./document";

/** Fades must fit inside the clip and must not overlap each other — `setValueCurveAtTime` throws
 *  on overlapping curves, so this is what keeps the audio engine legal, not just tidy. */
export function clampFades(c: Clip): Clip {
  let fi = Math.max(0, Math.min(c.fadeInS, c.durS));
  let fo = Math.max(0, Math.min(c.fadeOutS, c.durS));
  const total = fi + fo;
  if (total > c.durS && total > 0) {
    const k = c.durS / total;
    fi *= k;
    fo *= k;
  }
  return fi === c.fadeInS && fo === c.fadeOutS ? c : { ...c, fadeInS: fi, fadeOutS: fo };
}

/** The part of `c` lying within `[fromS, toS)` in TIMELINE seconds, or null if nothing survives.
 *
 *  `inS` advances by exactly the amount cut off the head, so the audio that survives stays under
 *  the same timeline position it was already under. The id is KEPT — a caller producing two pieces
 *  from one clip must reassign one of them (see `insertClip`). */
export function sliceClip(c: Clip, fromS: number, toS: number): Clip | null {
  const s = Math.max(c.startS, fromS);
  const e = Math.min(clipEndS(c), toS);
  const durS = e - s;
  if (durS < MIN_CLIP_S) return null;
  return clampFades({ ...c, startS: s, inS: c.inS + (s - c.startS), durS });
}

/** Place `incoming` into `clips`, overwriting whatever it lands on: the dragged clip wins.
 *  Returns a new array, sorted by startS, with the non-overlap invariant restored. */
export function insertClip(clips: Clip[], incoming: Clip): Clip[] {
  const inEnd = clipEndS(incoming);
  const out: Clip[] = [];
  for (const c of clips) {
    if (clipEndS(c) <= incoming.startS || c.startS >= inEnd) {
      out.push(c);
      continue;
    }
    const head = sliceClip(c, -Infinity, incoming.startS);
    const tail = sliceClip(c, inEnd, Infinity);
    if (head) out.push(head);
    // The tail is a second clip born from one original, so it needs its own identity.
    if (tail) out.push({ ...tail, id: newId("clip") });
  }
  out.push(incoming);
  return out.sort((a, b) => a.startS - b.startS);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/overlap.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/doc/overlap.ts src/doc/overlap.test.ts
git commit -m "feat: clip slicing and the overwrite-on-drop primitive"
```

---

### Task 4: Track edits

**Files:**
- Create: `src/doc/edits.ts`
- Test: `src/doc/edits.test.ts`

**Interfaces:**
- Consumes: `Project`, `Track`, `createTrack`, `findTrack` from `./document`
- Produces (all pure, `(project, ...) => Project`, never mutating the input):
  - `addTrack(p: Project, name?: string): Project`
  - `removeTrack(p: Project, trackId: string): Project`
  - `renameTrack(p: Project, trackId: string, name: string): Project`
  - `reorderTrack(p: Project, trackId: string, toIndex: number): Project`
  - `setTrackGain(p: Project, trackId: string, gain: number): Project`
  - `setTrackMuted(p: Project, trackId: string, muted: boolean): Project`
  - `setMasterGain(p: Project, gain: number): Project`
  - Internal helper `mapTrack(p, trackId, fn: (t: Track) => Track): Project`, exported for later tasks in this file.

- [ ] **Step 1: Write the failing test**

`src/doc/edits.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, findTrack } from "./document";
import {
  addTrack, removeTrack, renameTrack, reorderTrack,
  setMasterGain, setTrackGain, setTrackMuted,
} from "./edits";

beforeEach(() => __resetIds());

describe("addTrack", () => {
  it("appends a track without mutating the input project", () => {
    const p = createProject();
    const next = addTrack(p, "Music");
    expect(p.tracks).toHaveLength(1);
    expect(next.tracks).toHaveLength(2);
    expect(next.tracks[1].name).toBe("Music");
  });

  it("auto-names from the new track count when no name is given", () => {
    expect(addTrack(createProject()).tracks[1].name).toBe("Track 2");
  });
});

describe("removeTrack", () => {
  it("removes the named track", () => {
    const p = addTrack(createProject(), "Music");
    const id = p.tracks[0].id;
    expect(findTrack(removeTrack(p, id), id)).toBeUndefined();
  });

  it("refuses to remove the last track — a project always has at least one", () => {
    const p = createProject();
    expect(removeTrack(p, p.tracks[0].id)).toBe(p);
  });
});

describe("renameTrack", () => {
  it("renames without touching other fields", () => {
    const p = createProject();
    const t = renameTrack(p, p.tracks[0].id, "VO").tracks[0];
    expect(t).toMatchObject({ name: "VO", gain: 1, muted: false });
  });
});

describe("reorderTrack", () => {
  it("moves a track to the given index", () => {
    let p = addTrack(addTrack(createProject(), "B"), "C");
    const names = () => p.tracks.map((t) => t.name);
    expect(names()).toEqual(["Track 1", "B", "C"]);
    p = reorderTrack(p, p.tracks[2].id, 0);
    expect(names()).toEqual(["C", "Track 1", "B"]);
  });

  it("clamps an out-of-range index instead of throwing", () => {
    const p = addTrack(createProject(), "B");
    expect(reorderTrack(p, p.tracks[0].id, 99).tracks.map((t) => t.name)).toEqual(["B", "Track 1"]);
  });
});

describe("gain and mute", () => {
  it("sets track gain, clamped to >= 0", () => {
    const p = createProject();
    expect(setTrackGain(p, p.tracks[0].id, 0.5).tracks[0].gain).toBe(0.5);
    expect(setTrackGain(p, p.tracks[0].id, -3).tracks[0].gain).toBe(0);
  });

  it("sets mute", () => {
    const p = createProject();
    expect(setTrackMuted(p, p.tracks[0].id, true).tracks[0].muted).toBe(true);
  });

  it("sets master gain, clamped to >= 0", () => {
    expect(setMasterGain(createProject(), 2).masterGain).toBe(2);
    expect(setMasterGain(createProject(), -1).masterGain).toBe(0);
  });
});

describe("unknown ids", () => {
  it("return the project unchanged rather than throwing", () => {
    const p = createProject();
    expect(renameTrack(p, "nope", "x")).toBe(p);
    expect(setTrackGain(p, "nope", 0.5)).toBe(p);
    expect(reorderTrack(p, "nope", 0)).toBe(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/edits.test.ts`
Expected: FAIL — `Failed to resolve import "./edits"`.

- [ ] **Step 3: Write the implementation**

`src/doc/edits.ts`:
```ts
/** Every editing operation, as a pure function `(project, ...) => Project`.
 *  No DOM, no Web Audio, no $state. This module is the heart of the test suite. */

import { createTrack, type Project, type Track } from "./document";

/** Replace one track by id. Returns the SAME project object when the id is unknown or the
 *  callback is a no-op, so callers can cheaply detect "nothing changed". */
export function mapTrack(p: Project, trackId: string, fn: (t: Track) => Track): Project {
  const i = p.tracks.findIndex((t) => t.id === trackId);
  if (i < 0) return p;
  const next = fn(p.tracks[i]);
  if (next === p.tracks[i]) return p;
  const tracks = p.tracks.slice();
  tracks[i] = next;
  return { ...p, tracks };
}

export function addTrack(p: Project, name?: string): Project {
  return { ...p, tracks: [...p.tracks, createTrack(name ?? `Track ${p.tracks.length + 1}`)] };
}

/** A project always has at least one track, so removing the last one is a no-op. */
export function removeTrack(p: Project, trackId: string): Project {
  if (p.tracks.length <= 1) return p;
  const tracks = p.tracks.filter((t) => t.id !== trackId);
  return tracks.length === p.tracks.length ? p : { ...p, tracks };
}

export function renameTrack(p: Project, trackId: string, name: string): Project {
  return mapTrack(p, trackId, (t) => (t.name === name ? t : { ...t, name }));
}

export function reorderTrack(p: Project, trackId: string, toIndex: number): Project {
  const from = p.tracks.findIndex((t) => t.id === trackId);
  if (from < 0) return p;
  const to = Math.max(0, Math.min(toIndex, p.tracks.length - 1));
  if (to === from) return p;
  const tracks = p.tracks.slice();
  const [moved] = tracks.splice(from, 1);
  tracks.splice(to, 0, moved);
  return { ...p, tracks };
}

export function setTrackGain(p: Project, trackId: string, gain: number): Project {
  const g = Math.max(0, gain);
  return mapTrack(p, trackId, (t) => (t.gain === g ? t : { ...t, gain: g }));
}

export function setTrackMuted(p: Project, trackId: string, muted: boolean): Project {
  return mapTrack(p, trackId, (t) => (t.muted === muted ? t : { ...t, muted }));
}

export function setMasterGain(p: Project, gain: number): Project {
  const g = Math.max(0, gain);
  return g === p.masterGain ? p : { ...p, masterGain: g };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/edits.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/doc/edits.test.ts
git commit -m "feat: track-level edits"
```

---

### Task 5: Clip placement, move and delete

**Files:**
- Modify: `src/doc/edits.ts` (append)
- Test: `src/doc/edits-clips.test.ts`

**Interfaces:**
- Consumes: `mapTrack` from `./edits`; `insertClip` from `./overlap`; `findClip`, `newId` from `./document`
- Produces:
  - `makeClip(sourceId: string, startS: number, durS: number, inS?: number): Clip` — a clip at unity gain with no fades
  - `addClip(p: Project, trackId: string, clip: Clip): Project`
  - `deleteClips(p: Project, clipIds: readonly string[]): Project`
  - `moveClips(p: Project, clipIds: readonly string[], deltaS: number, deltaTrackIndex: number): Project`

- [ ] **Step 1: Write the failing test**

`src/doc/edits-clips.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, deleteClips, makeClip, moveClips } from "./edits";

function twoTracks(): Project {
  return addTrack(createProject(), "B");
}

beforeEach(() => __resetIds());

describe("makeClip", () => {
  it("builds a clip at unity gain with no fades", () => {
    expect(makeClip("src-1", 2, 5)).toMatchObject({
      sourceId: "src-1", startS: 2, durS: 5, inS: 0,
      gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear",
    });
  });
});

describe("addClip", () => {
  it("places a clip on the named track without mutating the input", () => {
    const p = twoTracks();
    const next = addClip(p, p.tracks[1].id, makeClip("s", 0, 3));
    expect(p.tracks[1].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(1);
  });

  it("overwrites what it lands on", () => {
    const p = twoTracks();
    const t = p.tracks[0].id;
    let next = addClip(p, t, makeClip("s", 0, 10));
    next = addClip(next, t, makeClip("s", 4, 2));
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 4], [4, 2], [6, 4]]);
  });

  it("is a no-op for an unknown track", () => {
    const p = twoTracks();
    expect(addClip(p, "nope", makeClip("s", 0, 1))).toBe(p);
  });
});

describe("deleteClips", () => {
  it("removes the named clips and leaves a gap", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    p = addClip(p, p.tracks[0].id, makeClip("s", 5, 2));
    const id = p.tracks[0].clips[0].id;
    const next = deleteClips(p, [id]);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([5]);
  });

  it("removes clips across several tracks in one call", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 2));
    const ids = [p.tracks[0].clips[0].id, p.tracks[1].clips[0].id];
    const next = deleteClips(p, ids);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(0);
  });

  it("is a no-op when no id matches", () => {
    const p = twoTracks();
    expect(deleteClips(p, ["nope"])).toBe(p);
  });
});

describe("moveClips", () => {
  it("shifts a clip in time", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 2, 2));
    const id = p.tracks[0].clips[0].id;
    expect(moveClips(p, [id], 3, 0).tracks[0].clips[0].startS).toBe(5);
  });

  it("clamps at t=0 rather than going negative", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 1, 2));
    const id = p.tracks[0].clips[0].id;
    expect(moveClips(p, [id], -5, 0).tracks[0].clips[0].startS).toBe(0);
  });

  it("moves a clip to another track", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    const id = p.tracks[0].clips[0].id;
    const next = moveClips(p, [id], 0, 1);
    expect(next.tracks[0].clips).toHaveLength(0);
    expect(next.tracks[1].clips).toHaveLength(1);
  });

  it("clamps a track move at the ends of the track list", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    const id = p.tracks[0].clips[0].id;
    expect(moveClips(p, [id], 0, -3).tracks[0].clips).toHaveLength(1);
  });

  it("overwrites a clip it lands on", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 4));
    p = addClip(p, p.tracks[0].id, makeClip("s", 10, 4));
    const moving = p.tracks[0].clips[1].id;
    const next = moveClips(p, [moving], -8, 0);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 2], [2, 4]]);
  });

  it("does not let group members overwrite each other", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 4));
    p = addClip(p, p.tracks[0].id, makeClip("s", 4, 4));
    const ids = p.tracks[0].clips.map((c) => c.id);
    const next = moveClips(p, ids, 10, 0);
    expect(next.tracks[0].clips.map((c) => [c.startS, c.durS])).toEqual([[10, 4], [14, 4]]);
  });

  it("preserves relative offsets when the group is clamped at t=0", () => {
    let p = twoTracks();
    p = addClip(p, p.tracks[0].id, makeClip("s", 2, 2));
    p = addClip(p, p.tracks[0].id, makeClip("s", 6, 2));
    const ids = p.tracks[0].clips.map((c) => c.id);
    const next = moveClips(p, ids, -10, 0);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 4]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/edits-clips.test.ts`
Expected: FAIL — `addClip is not exported`.

- [ ] **Step 3: Append the implementation to `src/doc/edits.ts`**

Add these imports at the top of the file (merge with the existing `./document` import):
```ts
import { createTrack, findClip, newId, type Clip, type Project, type Track } from "./document";
import { insertClip } from "./overlap";
```

Append:
```ts
export function makeClip(sourceId: string, startS: number, durS: number, inS = 0): Clip {
  return {
    id: newId("clip"), sourceId, startS, inS, durS,
    gain: 1, fadeInS: 0, fadeOutS: 0, fadeShape: "linear",
  };
}

export function addClip(p: Project, trackId: string, clip: Clip): Project {
  return mapTrack(p, trackId, (t) => ({ ...t, clips: insertClip(t.clips, clip) }));
}

export function deleteClips(p: Project, clipIds: readonly string[]): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return p;
  let changed = false;
  const tracks = p.tracks.map((t) => {
    const clips = t.clips.filter((c) => !ids.has(c.id));
    if (clips.length === t.clips.length) return t;
    changed = true;
    return { ...t, clips };
  });
  return changed ? { ...p, tracks } : p;
}

/**
 * Move a set of clips by `deltaS` seconds and `deltaTrackIndex` tracks.
 *
 * Every moved clip is REMOVED FIRST and only then re-inserted, so members of the group cannot
 * overwrite each other on the way past. The time delta is clamped once for the whole group, not
 * per clip, so a group clamped at t=0 keeps its internal spacing.
 */
export function moveClips(
  p: Project,
  clipIds: readonly string[],
  deltaS: number,
  deltaTrackIndex: number,
): Project {
  const ids = new Set(clipIds);
  if (ids.size === 0) return p;

  const moving: { clip: Clip; fromTrackIndex: number }[] = [];
  p.tracks.forEach((t, i) => {
    for (const c of t.clips) if (ids.has(c.id)) moving.push({ clip: c, fromTrackIndex: i });
  });
  if (moving.length === 0) return p;

  const minStart = Math.min(...moving.map((m) => m.clip.startS));
  const dt = Math.max(deltaS, -minStart);
  const minTrack = Math.min(...moving.map((m) => m.fromTrackIndex));
  const maxTrack = Math.max(...moving.map((m) => m.fromTrackIndex));
  const dTrack = Math.max(-minTrack, Math.min(deltaTrackIndex, p.tracks.length - 1 - maxTrack));
  if (dt === 0 && dTrack === 0) return p;

  // Strip the movers out of every track first.
  const tracks: Track[] = p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !ids.has(c.id)) }));
  for (const { clip, fromTrackIndex } of moving) {
    const target = tracks[fromTrackIndex + dTrack];
    target.clips = insertClip(target.clips, { ...clip, startS: clip.startS + dt });
  }
  return { ...p, tracks };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/edits-clips.test.ts src/doc/edits.test.ts`
Expected: PASS, all cases in both files.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/doc/edits-clips.test.ts
git commit -m "feat: clip placement, group move and delete"
```

---

### Task 6: Trim and split

The `trimClipStart` invariant is the one non-obvious rule in the whole codebase, so read the comment before writing the code.

**Files:**
- Modify: `src/doc/edits.ts` (append)
- Test: `src/doc/edits-trim.test.ts`

**Interfaces:**
- Consumes: `mapTrack` (this file); `sliceClip`, `clampFades` from `./overlap`; `clipEndS`, `MIN_CLIP_S`, `newId` from `./document`
- Produces:
  - `trimClipStart(p: Project, clipId: string, deltaS: number): Project` — positive `deltaS` trims more off the front
  - `trimClipEnd(p: Project, clipId: string, deltaS: number, sourceDurS: number): Project` — positive `deltaS` makes the clip longer
  - `splitAt(p: Project, trackIds: readonly string[], atS: number): Project`

- [ ] **Step 1: Write the failing test**

`src/doc/edits-trim.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, makeClip, splitAt, trimClipEnd, trimClipStart } from "./edits";

/** One track holding one clip: 4s of a 20s source, starting 2s in, placed at t=5. */
function oneClip(): { p: Project; clipId: string; trackId: string } {
  const base = createProject();
  const trackId = base.tracks[0].id;
  const p = addClip(base, trackId, makeClip("s", 5, 4, 2));
  return { p, clipId: p.tracks[0].clips[0].id, trackId };
}

beforeEach(() => __resetIds());

describe("trimClipStart", () => {
  it("moves startS and inS by the SAME delta, so kept audio stays put", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, 1).tracks[0].clips[0];
    expect(c.startS).toBe(6);
    expect(c.inS).toBe(3); // both +1 — the audio under t=6 is unchanged
    expect(c.durS).toBe(3);
  });

  it("extends the head back out, un-trimming", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, -1).tracks[0].clips[0];
    expect(c).toMatchObject({ startS: 4, inS: 1, durS: 5 });
  });

  it("cannot pull inS below 0", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, -10).tracks[0].clips[0];
    expect(c.inS).toBe(0);
    expect(c.startS).toBe(3); // clamped by the same amount, so the invariant holds
  });

  it("cannot eat the clip below MIN_CLIP_S", () => {
    const { p, clipId } = oneClip();
    const c = trimClipStart(p, clipId, 99).tracks[0].clips[0];
    expect(c.durS).toBeCloseTo(0.01);
  });

  it("cannot extend back into the previous clip", () => {
    let { p, trackId } = oneClip();
    p = addClip(p, trackId, makeClip("s", 0, 4, 0)); // occupies 0..4
    const clipId = p.tracks[0].clips[1].id;
    const c = trimClipStart(p, clipId, -10).tracks[0].clips[1];
    expect(c.startS).toBe(4);
  });

  it("clamps fades that no longer fit", () => {
    const { p, clipId } = oneClip();
    const withFade = { ...p };
    withFade.tracks[0].clips[0].fadeInS = 3;
    const c = trimClipStart(withFade, clipId, 2).tracks[0].clips[0];
    expect(c.fadeInS).toBeLessThanOrEqual(c.durS);
  });
});

describe("trimClipEnd", () => {
  it("lengthens the clip without touching startS or inS", () => {
    const { p, clipId } = oneClip();
    const c = trimClipEnd(p, clipId, 2, 20).tracks[0].clips[0];
    expect(c).toMatchObject({ startS: 5, inS: 2, durS: 6 });
  });

  it("shortens the clip", () => {
    const { p, clipId } = oneClip();
    expect(trimClipEnd(p, clipId, -1, 20).tracks[0].clips[0].durS).toBe(3);
  });

  it("cannot run past the end of the source", () => {
    const { p, clipId } = oneClip();
    // inS=2 of a 6s source leaves 4s available, which is exactly the current length.
    expect(trimClipEnd(p, clipId, 5, 6).tracks[0].clips[0].durS).toBe(4);
  });

  it("cannot eat the clip below MIN_CLIP_S", () => {
    const { p, clipId } = oneClip();
    expect(trimClipEnd(p, clipId, -99, 20).tracks[0].clips[0].durS).toBeCloseTo(0.01);
  });

  it("cannot extend into the next clip", () => {
    let { p, trackId } = oneClip();
    p = addClip(p, trackId, makeClip("s", 11, 2, 0)); // occupies 11..13
    const clipId = p.tracks[0].clips[0].id;
    expect(trimClipEnd(p, clipId, 99, 20).tracks[0].clips[0].durS).toBe(6); // 5..11
  });
});

describe("splitAt", () => {
  it("splits a clip crossing the point into two, the tail getting a new id", () => {
    const { p, clipId, trackId } = oneClip();
    const clips = splitAt(p, [trackId], 7).tracks[0].clips;
    expect(clips).toHaveLength(2);
    expect(clips[0]).toMatchObject({ id: clipId, startS: 5, inS: 2, durS: 2 });
    expect(clips[1]).toMatchObject({ startS: 7, inS: 4, durS: 2 });
    expect(clips[1].id).not.toBe(clipId);
  });

  it("leaves clips that do not cross the point alone", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 20)).toBe(p);
  });

  it("does not split exactly on a clip boundary", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 5)).toBe(p);
    expect(splitAt(p, [trackId], 9)).toBe(p);
  });

  it("refuses a split that would produce a sliver shorter than MIN_CLIP_S", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, [trackId], 5.001)).toBe(p);
  });

  it("only touches the tracks it is given", () => {
    const { p, trackId } = oneClip();
    expect(splitAt(p, ["other"], 7)).toBe(p);
    expect(splitAt(p, [trackId], 7).tracks[0].clips).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/edits-trim.test.ts`
Expected: FAIL — `trimClipStart is not exported`.

- [ ] **Step 3: Append the implementation to `src/doc/edits.ts`**

Extend the existing imports so they read:
```ts
import { MIN_CLIP_S, clipEndS, createTrack, findClip, newId, type Clip, type Project, type Track } from "./document";
import { clampFades, insertClip, sliceClip } from "./overlap";
```

Append:
```ts
/** Replace one clip in place, by id, keeping the track sorted. */
function mapClip(p: Project, clipId: string, fn: (c: Clip, t: Track) => Clip): Project {
  const found = findClip(p, clipId);
  if (!found) return p;
  const next = fn(found.clip, found.track);
  if (next === found.clip) return p;
  return mapTrack(p, found.track.id, (t) => ({
    ...t,
    clips: t.clips.map((c) => (c.id === clipId ? next : c)).sort((a, b) => a.startS - b.startS),
  }));
}

/**
 * Drag the HEAD handle by `deltaS` (positive = trim more off the front).
 *
 * `startS` and `inS` move by the SAME delta on purpose: the two changes cancel in timeline terms,
 * so the audio you KEEP stays under the same timeline position it was already under. You trim a
 * head because the sync is already right — a head trim that re-syncs the clip is a bug.
 *
 * The DELTA is clamped, not the fields, so the two can never be clamped by different amounts and
 * break the invariant this function exists to hold.
 */
export function trimClipStart(p: Project, clipId: string, deltaS: number): Project {
  return mapClip(p, clipId, (c, t) => {
    const i = t.clips.indexOf(c);
    const prevEnd = i > 0 ? clipEndS(t.clips[i - 1]) : 0;
    const lo = Math.max(-c.inS, prevEnd - c.startS); // no negative in-point, no eating the neighbour
    const hi = c.durS - MIN_CLIP_S;
    const d = Math.max(lo, Math.min(deltaS, hi));
    if (d === 0) return c;
    return clampFades({ ...c, startS: c.startS + d, inS: c.inS + d, durS: c.durS - d });
  });
}

/** Drag the TAIL handle by `deltaS` (positive = longer). `sourceDurS` is the whole source's
 *  duration — the tail can never run past the end of the audio it came from. */
export function trimClipEnd(
  p: Project,
  clipId: string,
  deltaS: number,
  sourceDurS: number,
): Project {
  return mapClip(p, clipId, (c, t) => {
    const i = t.clips.indexOf(c);
    const nextStart = i < t.clips.length - 1 ? t.clips[i + 1].startS : Infinity;
    const lo = MIN_CLIP_S - c.durS;
    const hi = Math.min(sourceDurS - c.inS - c.durS, nextStart - clipEndS(c));
    const d = Math.max(lo, Math.min(deltaS, hi));
    if (d === 0) return c;
    return clampFades({ ...c, durS: c.durS + d });
  });
}

/** Split every clip crossing `atS` on the given tracks. A split that would produce a piece shorter
 *  than MIN_CLIP_S is refused outright rather than producing a sliver. */
export function splitAt(p: Project, trackIds: readonly string[], atS: number): Project {
  let next = p;
  for (const trackId of trackIds) {
    next = mapTrack(next, trackId, (t) => {
      let changed = false;
      const clips: Clip[] = [];
      for (const c of t.clips) {
        if (c.startS >= atS || clipEndS(c) <= atS) {
          clips.push(c);
          continue;
        }
        const head = sliceClip(c, -Infinity, atS);
        const tail = sliceClip(c, atS, Infinity);
        if (!head || !tail) {
          clips.push(c);
          continue;
        }
        clips.push(head, { ...tail, id: newId("clip") });
        changed = true;
      }
      return changed ? { ...t, clips } : t;
    });
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/doc/edits-trim.test.ts
git commit -m "feat: clip trim (head invariant preserved) and split"
```

---

### Task 7: Delete a time range, with and without ripple

**Files:**
- Modify: `src/doc/edits.ts` (append)
- Test: `src/doc/edits-range.test.ts`

**Interfaces:**
- Consumes: `mapTrack`, `splitAt` (this file); `clipEndS` from `./document`
- Produces: `deleteRange(p: Project, trackIds: readonly string[], fromS: number, toS: number, ripple: boolean): Project`

- [ ] **Step 1: Write the failing test**

`src/doc/edits-range.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, deleteRange, makeClip } from "./edits";

/** Track A: one 20s clip at t=0. Track B: one 20s clip at t=0. */
function twoLongTracks(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 0, 20));
  p = addClip(p, p.tracks[1].id, makeClip("s", 0, 20));
  return p;
}

beforeEach(() => __resetIds());

describe("deleteRange without ripple", () => {
  it("cuts a hole and leaves the tail where it was", () => {
    const p = twoLongTracks();
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, false).tracks[0].clips;
    expect(clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [8, 12]]);
  });

  it("advances inS on the tail so the surviving audio stays under the same times", () => {
    const p = twoLongTracks();
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, false).tracks[0].clips;
    expect(clips[1].inS).toBe(8);
  });

  it("removes clips entirely inside the range", () => {
    let p = addTrack(createProject(), "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 6, 2));
    expect(deleteRange(p, [p.tracks[0].id], 5, 10, false).tracks[0].clips).toHaveLength(0);
  });
});

describe("deleteRange with ripple", () => {
  it("closes the gap by shifting the tail left by the range length", () => {
    const p = twoLongTracks();
    const clips = deleteRange(p, [p.tracks[0].id], 5, 8, true).tracks[0].clips;
    expect(clips.map((c) => [c.startS, c.durS])).toEqual([[0, 5], [5, 12]]);
  });

  it("shifts every later clip, not just the adjacent one", () => {
    let p = addTrack(createProject(), "B");
    const t = p.tracks[0].id;
    p = addClip(p, t, makeClip("s", 0, 2));
    p = addClip(p, t, makeClip("s", 10, 2));
    p = addClip(p, t, makeClip("s", 20, 2));
    const clips = deleteRange(p, [t], 4, 6, true).tracks[0].clips;
    expect(clips.map((c) => c.startS)).toEqual([0, 8, 18]);
  });

  it("NEVER touches tracks outside trackIds — this is what keeps a bed in sync", () => {
    const p = twoLongTracks();
    const next = deleteRange(p, [p.tracks[0].id], 5, 8, true);
    expect(next.tracks[1].clips.map((c) => [c.startS, c.durS])).toEqual([[0, 20]]);
  });

  it("ripples several tracks together when several are selected", () => {
    const p = twoLongTracks();
    const ids = p.tracks.map((t) => t.id);
    const next = deleteRange(p, ids, 5, 8, true);
    expect(next.tracks[0].clips.map((c) => c.startS)).toEqual([0, 5]);
    expect(next.tracks[1].clips.map((c) => c.startS)).toEqual([0, 5]);
  });
});

describe("deleteRange edge cases", () => {
  it("is a no-op for an empty or inverted range", () => {
    const p = twoLongTracks();
    expect(deleteRange(p, [p.tracks[0].id], 5, 5, true)).toBe(p);
    expect(deleteRange(p, [p.tracks[0].id], 8, 5, true)).toBe(p);
  });

  it("is a no-op when the range misses every clip and ripple is off", () => {
    let p = addTrack(createProject(), "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
    expect(deleteRange(p, [p.tracks[0].id], 50, 60, false)).toBe(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/edits-range.test.ts`
Expected: FAIL — `deleteRange is not exported`.

- [ ] **Step 3: Append the implementation to `src/doc/edits.ts`**

```ts
/**
 * Cut `[fromS, toS)` out of the given tracks: split at both edges, drop what is inside, and — if
 * `ripple` — close the gap by shifting everything after it left.
 *
 * `trackIds` scopes the ripple. It is NEVER global: sliding every track would pull a music bed out
 * of sync with the narration you were editing. The caller passes the tracks the time-range
 * selection covers, so an edit on one track leaves its neighbours where they are.
 */
export function deleteRange(
  p: Project,
  trackIds: readonly string[],
  fromS: number,
  toS: number,
  ripple: boolean,
): Project {
  if (!(toS > fromS)) return p;
  const span = toS - fromS;
  let next = splitAt(p, trackIds, fromS);
  next = splitAt(next, trackIds, toS);

  for (const trackId of trackIds) {
    next = mapTrack(next, trackId, (t) => {
      const kept = t.clips.filter((c) => !(c.startS >= fromS && clipEndS(c) <= toS));
      const removed = kept.length !== t.clips.length;
      if (!removed && !ripple) return t;
      const clips = ripple
        ? kept.map((c) => (c.startS >= toS ? { ...c, startS: c.startS - span } : c))
        : kept;
      // Nothing was cut and nothing sat after the range — genuinely unchanged.
      if (!removed && clips.every((c, i) => c === kept[i]) && clips.length === t.clips.length) {
        return t;
      }
      return { ...t, clips };
    });
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/doc/edits-range.test.ts
git commit -m "feat: deleteRange with track-scoped ripple"
```

---

### Task 8: Clip gain and fades

**Files:**
- Modify: `src/doc/edits.ts` (append)
- Test: `src/doc/edits-gain.test.ts`

**Interfaces:**
- Consumes: `mapClip` (this file, already defined in Task 6); `clampFades` from `./overlap`
- Produces:
  - `setClipGain(p: Project, clipId: string, gain: number): Project`
  - `setClipFade(p: Project, clipId: string, patch: { fadeInS?: number; fadeOutS?: number; fadeShape?: FadeShape }): Project`

- [ ] **Step 1: Write the failing test**

`src/doc/edits-gain.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, makeClip, setClipFade, setClipGain } from "./edits";

function oneClip(durS = 10): { p: Project; clipId: string } {
  const base = createProject();
  const p = addClip(base, base.tracks[0].id, makeClip("s", 0, durS));
  return { p, clipId: p.tracks[0].clips[0].id };
}

beforeEach(() => __resetIds());

describe("setClipGain", () => {
  it("sets gain", () => {
    const { p, clipId } = oneClip();
    expect(setClipGain(p, clipId, 0.25).tracks[0].clips[0].gain).toBe(0.25);
  });

  it("clamps to >= 0", () => {
    const { p, clipId } = oneClip();
    expect(setClipGain(p, clipId, -2).tracks[0].clips[0].gain).toBe(0);
  });

  it("is a no-op for an unknown clip", () => {
    const { p } = oneClip();
    expect(setClipGain(p, "nope", 0.5)).toBe(p);
  });
});

describe("setClipFade", () => {
  it("sets fade in and fade out independently", () => {
    const { p, clipId } = oneClip();
    const c = setClipFade(p, clipId, { fadeInS: 1, fadeOutS: 2 }).tracks[0].clips[0];
    expect(c).toMatchObject({ fadeInS: 1, fadeOutS: 2 });
  });

  it("leaves unspecified fields alone", () => {
    const { p, clipId } = oneClip();
    let next = setClipFade(p, clipId, { fadeInS: 1 });
    next = setClipFade(next, clipId, { fadeOutS: 2 });
    expect(next.tracks[0].clips[0].fadeInS).toBe(1);
  });

  it("sets the curve shape", () => {
    const { p, clipId } = oneClip();
    expect(setClipFade(p, clipId, { fadeShape: "equalPower" }).tracks[0].clips[0].fadeShape)
      .toBe("equalPower");
  });

  it("pushes the other fade back rather than rejecting an overlong drag", () => {
    const { p, clipId } = oneClip(4);
    let next = setClipFade(p, clipId, { fadeInS: 1, fadeOutS: 3 });
    next = setClipFade(next, clipId, { fadeInS: 3 });
    const c = next.tracks[0].clips[0];
    expect(c.fadeInS + c.fadeOutS).toBeCloseTo(4);
    expect(c.fadeInS).toBeGreaterThan(1);
  });

  it("clamps a fade longer than the clip", () => {
    const { p, clipId } = oneClip(2);
    expect(setClipFade(p, clipId, { fadeInS: 99 }).tracks[0].clips[0].fadeInS).toBe(2);
  });

  it("rejects negative fades", () => {
    const { p, clipId } = oneClip();
    expect(setClipFade(p, clipId, { fadeInS: -1 }).tracks[0].clips[0].fadeInS).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/edits-gain.test.ts`
Expected: FAIL — `setClipGain is not exported`.

- [ ] **Step 3: Append the implementation to `src/doc/edits.ts`**

Add `FadeShape` to the `./document` import list, then append:
```ts
export function setClipGain(p: Project, clipId: string, gain: number): Project {
  const g = Math.max(0, gain);
  return mapClip(p, clipId, (c) => (c.gain === g ? c : { ...c, gain: g }));
}

/** Patch a clip's fades. `clampFades` decides what happens when they collide: the pair is scaled
 *  to fill exactly the clip, so dragging one handle past the other pushes the other back instead
 *  of rejecting the drag. */
export function setClipFade(
  p: Project,
  clipId: string,
  patch: { fadeInS?: number; fadeOutS?: number; fadeShape?: FadeShape },
): Project {
  return mapClip(p, clipId, (c) => {
    const next: Clip = {
      ...c,
      fadeInS: patch.fadeInS ?? c.fadeInS,
      fadeOutS: patch.fadeOutS ?? c.fadeOutS,
      fadeShape: patch.fadeShape ?? c.fadeShape,
    };
    const clamped = clampFades(next);
    return clamped.fadeInS === c.fadeInS &&
      clamped.fadeOutS === c.fadeOutS &&
      clamped.fadeShape === c.fadeShape
      ? c
      : clamped;
  });
}
```

Note: `clampFades` scales the PAIR proportionally, which is what makes the "push the other back" test pass — after `{fadeInS: 3, fadeOutS: 3}` on a 4 s clip, both scale by 4/6 to 2 and 2.

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add src/doc/edits.ts src/doc/edits-gain.test.ts
git commit -m "feat: clip gain and fade setters"
```

---

### Task 9: Clipboard — copy, cut, paste

**Files:**
- Create: `src/doc/clipboard.ts`
- Test: `src/doc/clipboard.test.ts`

**Interfaces:**
- Consumes: `Project`, `Clip`, `newId` from `./document`; `addClip`, `deleteClips` from `./edits`
- Produces:
  - `interface ClipboardEntry { clip: Clip; trackOffset: number }` — `clip.startS` is relative to the earliest copied clip
  - `interface ClipboardData { entries: ClipboardEntry[] }`
  - `copyClips(p: Project, clipIds: readonly string[]): ClipboardData`
  - `cutClips(p: Project, clipIds: readonly string[]): { project: Project; clipboard: ClipboardData }`
  - `pasteClips(p: Project, data: ClipboardData, trackId: string, atS: number): Project`

- [ ] **Step 1: Write the failing test**

`src/doc/clipboard.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { copyClips, cutClips, pasteClips } from "./clipboard";
import { addClip, addTrack, makeClip } from "./edits";

/** Track A: clips at t=10 (2s) and t=14 (2s). Track B: clip at t=10 (2s). */
function scene(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 10, 2));
  p = addClip(p, p.tracks[0].id, makeClip("s", 14, 2));
  p = addClip(p, p.tracks[1].id, makeClip("s", 10, 2));
  return p;
}

beforeEach(() => __resetIds());

describe("copyClips", () => {
  it("normalises startS so the earliest copied clip sits at 0", () => {
    const p = scene();
    const ids = p.tracks[0].clips.map((c) => c.id);
    const data = copyClips(p, ids);
    expect(data.entries.map((e) => e.clip.startS)).toEqual([0, 4]);
  });

  it("records each clip's track offset relative to the topmost copied track", () => {
    const p = scene();
    const ids = [p.tracks[1].clips[0].id, p.tracks[0].clips[0].id];
    expect(copyClips(p, ids).entries.map((e) => e.trackOffset).sort()).toEqual([0, 1]);
  });

  it("does not mutate or remove anything", () => {
    const p = scene();
    copyClips(p, [p.tracks[0].clips[0].id]);
    expect(p.tracks[0].clips).toHaveLength(2);
  });

  it("returns an empty clipboard for no ids", () => {
    expect(copyClips(scene(), []).entries).toEqual([]);
  });
});

describe("cutClips", () => {
  it("returns the clipboard AND a project with those clips gone", () => {
    const p = scene();
    const id = p.tracks[0].clips[0].id;
    const { project, clipboard } = cutClips(p, [id]);
    expect(clipboard.entries).toHaveLength(1);
    expect(project.tracks[0].clips.map((c) => c.startS)).toEqual([14]);
  });
});

describe("pasteClips", () => {
  it("places clips at atS, preserving their relative spacing", () => {
    const p = scene();
    const data = copyClips(p, p.tracks[0].clips.map((c) => c.id));
    const next = pasteClips(p, data, p.tracks[1].id, 30);
    expect(next.tracks[1].clips.map((c) => c.startS)).toEqual([10, 30, 34]);
  });

  it("gives pasted clips fresh ids so a paste-onto-self does not collide", () => {
    const p = scene();
    const original = p.tracks[0].clips[0];
    const data = copyClips(p, [original.id]);
    const next = pasteClips(p, data, p.tracks[0].id, 30);
    expect(next.tracks[0].clips.map((c) => c.id)).not.toContain(data.entries[0].clip.id);
    expect(next.tracks[0].clips.filter((c) => c.id === original.id)).toHaveLength(1);
  });

  it("preserves gain and fades", () => {
    let p = scene();
    p.tracks[0].clips[0].gain = 0.5;
    p.tracks[0].clips[0].fadeInS = 0.25;
    const data = copyClips(p, [p.tracks[0].clips[0].id]);
    const c = pasteClips(p, data, p.tracks[1].id, 30).tracks[1].clips[1];
    expect(c).toMatchObject({ gain: 0.5, fadeInS: 0.25 });
  });

  it("spills onto lower tracks by trackOffset, clamped at the last track", () => {
    const p = scene();
    const data = copyClips(p, [p.tracks[0].clips[0].id, p.tracks[1].clips[0].id]);
    const next = pasteClips(p, data, p.tracks[1].id, 30);
    // Both land on the last track because there is no track below it.
    expect(next.tracks[1].clips).toHaveLength(2);
  });

  it("overwrites whatever it lands on", () => {
    const p = scene();
    const data = copyClips(p, [p.tracks[0].clips[0].id]);
    const next = pasteClips(p, data, p.tracks[1].id, 11);
    expect(next.tracks[1].clips.map((c) => [c.startS, c.durS])).toEqual([[10, 1], [11, 2]]);
  });

  it("is a no-op for an empty clipboard or unknown track", () => {
    const p = scene();
    expect(pasteClips(p, { entries: [] }, p.tracks[0].id, 5)).toBe(p);
    expect(pasteClips(p, copyClips(p, [p.tracks[0].clips[0].id]), "nope", 5)).toBe(p);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/clipboard.test.ts`
Expected: FAIL — `Failed to resolve import "./clipboard"`.

- [ ] **Step 3: Write the implementation**

`src/doc/clipboard.ts`:
```ts
import { newId, type Clip, type Project } from "./document";
import { addClip, deleteClips } from "./edits";

export interface ClipboardEntry {
  /** `startS` is RELATIVE to the earliest copied clip, so a paste is just `atS + startS`. */
  clip: Clip;
  /** Tracks below the topmost copied track, so a multi-track copy keeps its shape. */
  trackOffset: number;
}

export interface ClipboardData {
  entries: ClipboardEntry[];
}

export function copyClips(p: Project, clipIds: readonly string[]): ClipboardData {
  const ids = new Set(clipIds);
  const found: { clip: Clip; trackIndex: number }[] = [];
  p.tracks.forEach((t, trackIndex) => {
    for (const clip of t.clips) if (ids.has(clip.id)) found.push({ clip, trackIndex });
  });
  if (found.length === 0) return { entries: [] };

  const baseTime = Math.min(...found.map((f) => f.clip.startS));
  const baseTrack = Math.min(...found.map((f) => f.trackIndex));
  return {
    entries: found.map((f) => ({
      clip: { ...f.clip, startS: f.clip.startS - baseTime },
      trackOffset: f.trackIndex - baseTrack,
    })),
  };
}

export function cutClips(
  p: Project,
  clipIds: readonly string[],
): { project: Project; clipboard: ClipboardData } {
  return { project: deleteClips(p, clipIds), clipboard: copyClips(p, clipIds) };
}

/** Paste at `atS` on `trackId`, spilling multi-track copies onto the tracks below (clamped at the
 *  last track). Every pasted clip gets a fresh id, so pasting onto the source track is safe. */
export function pasteClips(
  p: Project,
  data: ClipboardData,
  trackId: string,
  atS: number,
): Project {
  if (data.entries.length === 0) return p;
  const baseIndex = p.tracks.findIndex((t) => t.id === trackId);
  if (baseIndex < 0) return p;

  let next = p;
  for (const entry of data.entries) {
    const target = next.tracks[Math.min(baseIndex + entry.trackOffset, next.tracks.length - 1)];
    next = addClip(next, target.id, {
      ...entry.clip,
      id: newId("clip"),
      startS: atS + entry.clip.startS,
    });
  }
  return next;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add src/doc/clipboard.ts src/doc/clipboard.test.ts
git commit -m "feat: clipboard copy, cut and paste"
```

---

### Task 10: Selection and edit points

**Files:**
- Create: `src/doc/selection.ts`
- Test: `src/doc/selection.test.ts`

**Interfaces:**
- Consumes: `Project`, `clipEndS` from `./document`
- Produces:
  - `interface TimeRange { fromS: number; toS: number; trackIds: string[] }`
  - `type Selection = { kind: "none" } | { kind: "clips"; clipIds: string[] } | { kind: "range"; range: TimeRange }`
  - `const NO_SELECTION: Selection`
  - `clipsInRange(p: Project, range: TimeRange): string[]` — clips on the range's tracks that overlap it at all
  - `editPoints(p: Project, trackIds: readonly string[]): number[]` — sorted, de-duplicated clip boundaries plus 0
  - `nextEditPoint(points: readonly number[], afterS: number): number | null`
  - `prevEditPoint(points: readonly number[], beforeS: number): number | null`

- [ ] **Step 1: Write the failing test**

`src/doc/selection.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "./document";
import { addClip, addTrack, makeClip } from "./edits";
import { clipsInRange, editPoints, nextEditPoint, prevEditPoint } from "./selection";

/** Track A: 0–2 and 5–8. Track B: 3–4. */
function scene(): Project {
  let p = addTrack(createProject(), "B");
  p = addClip(p, p.tracks[0].id, makeClip("s", 0, 2));
  p = addClip(p, p.tracks[0].id, makeClip("s", 5, 3));
  p = addClip(p, p.tracks[1].id, makeClip("s", 3, 1));
  return p;
}

beforeEach(() => __resetIds());

describe("clipsInRange", () => {
  it("includes clips that merely overlap the range", () => {
    const p = scene();
    const ids = clipsInRange(p, { fromS: 1, toS: 6, trackIds: [p.tracks[0].id] });
    expect(ids).toEqual(p.tracks[0].clips.map((c) => c.id));
  });

  it("excludes clips on tracks not in the range", () => {
    const p = scene();
    const ids = clipsInRange(p, { fromS: 0, toS: 100, trackIds: [p.tracks[1].id] });
    expect(ids).toEqual([p.tracks[1].clips[0].id]);
  });

  it("treats a touching edge as no overlap", () => {
    const p = scene();
    expect(clipsInRange(p, { fromS: 2, toS: 5, trackIds: [p.tracks[0].id] })).toEqual([]);
  });

  it("is empty for an inverted or zero-length range", () => {
    const p = scene();
    expect(clipsInRange(p, { fromS: 5, toS: 5, trackIds: [p.tracks[0].id] })).toEqual([]);
    expect(clipsInRange(p, { fromS: 6, toS: 2, trackIds: [p.tracks[0].id] })).toEqual([]);
  });
});

describe("editPoints", () => {
  it("collects sorted unique boundaries across the given tracks, starting at 0", () => {
    const p = scene();
    expect(editPoints(p, p.tracks.map((t) => t.id))).toEqual([0, 2, 3, 4, 5, 8]);
  });

  it("only looks at the tracks it is given", () => {
    const p = scene();
    expect(editPoints(p, [p.tracks[1].id])).toEqual([0, 3, 4]);
  });

  it("is just [0] for an empty project", () => {
    const p = createProject();
    expect(editPoints(p, [p.tracks[0].id])).toEqual([0]);
  });
});

describe("nextEditPoint / prevEditPoint", () => {
  const points = [0, 2, 3, 4, 5, 8];

  it("finds the next point strictly after the time", () => {
    expect(nextEditPoint(points, 2)).toBe(3);
    expect(nextEditPoint(points, 2.5)).toBe(3);
  });

  it("returns null past the last point", () => {
    expect(nextEditPoint(points, 8)).toBeNull();
    expect(nextEditPoint(points, 99)).toBeNull();
  });

  it("finds the previous point strictly before the time", () => {
    expect(prevEditPoint(points, 3)).toBe(2);
    expect(prevEditPoint(points, 2.5)).toBe(2);
  });

  it("returns null before the first point", () => {
    expect(prevEditPoint(points, 0)).toBeNull();
    expect(prevEditPoint(points, -1)).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/doc/selection.test.ts`
Expected: FAIL — `Failed to resolve import "./selection"`.

- [ ] **Step 3: Write the implementation**

`src/doc/selection.ts`:
```ts
import { clipEndS, type Project } from "./document";

export interface TimeRange {
  fromS: number;
  toS: number;
  /** The tracks the range covers. Ripple and range-delete are scoped to exactly these. */
  trackIds: string[];
}

export type Selection =
  | { kind: "none" }
  | { kind: "clips"; clipIds: string[] }
  | { kind: "range"; range: TimeRange };

export const NO_SELECTION: Selection = { kind: "none" };

/** Every clip on the range's tracks that OVERLAPS it — touching edges do not count. */
export function clipsInRange(p: Project, range: TimeRange): string[] {
  if (!(range.toS > range.fromS)) return [];
  const tracks = new Set(range.trackIds);
  const out: string[] = [];
  for (const t of p.tracks) {
    if (!tracks.has(t.id)) continue;
    for (const c of t.clips) {
      if (c.startS < range.toS && clipEndS(c) > range.fromS) out.push(c.id);
    }
  }
  return out;
}

/** Sorted, de-duplicated clip boundaries on the given tracks, always including 0. These are what
 *  the jump-to-edit-point shortcuts and edge snapping both use. */
export function editPoints(p: Project, trackIds: readonly string[]): number[] {
  const tracks = new Set(trackIds);
  const set = new Set<number>([0]);
  for (const t of p.tracks) {
    if (!tracks.has(t.id)) continue;
    for (const c of t.clips) {
      set.add(c.startS);
      set.add(clipEndS(c));
    }
  }
  return [...set].sort((a, b) => a - b);
}

export function nextEditPoint(points: readonly number[], afterS: number): number | null {
  return points.find((t) => t > afterS) ?? null;
}

export function prevEditPoint(points: readonly number[], beforeS: number): number | null {
  for (let i = points.length - 1; i >= 0; i--) if (points[i] < beforeS) return points[i];
  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/doc/`
Expected: PASS, every file.

- [ ] **Step 5: Commit**

```bash
git add src/doc/selection.ts src/doc/selection.test.ts
git commit -m "feat: selection types, range resolution and edit points"
```

---

### Task 11: Undo history

Kept as a pure generic module so it is node-testable — the `$state` store in Task 17 is a thin wrapper over it.

**Files:**
- Create: `src/state/history.ts`
- Test: `src/state/history.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `const HISTORY_LIMIT = 100`
  - `interface History<T> { past: T[]; future: T[] }`
  - `createHistory<T>(): History<T>`
  - `record<T>(h: History<T>, previous: T): History<T>` — push the pre-edit state, clear redo
  - `undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null`
  - `redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null`
  - `canUndo(h: History<unknown>): boolean`, `canRedo(h: History<unknown>): boolean`

- [ ] **Step 1: Write the failing test**

`src/state/history.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  HISTORY_LIMIT, canRedo, canUndo, createHistory, record, redo, undo,
} from "./history";

describe("createHistory", () => {
  it("starts empty with nothing to undo or redo", () => {
    const h = createHistory<string>();
    expect(canUndo(h)).toBe(false);
    expect(canRedo(h)).toBe(false);
  });
});

describe("record / undo / redo", () => {
  it("undo returns the recorded previous state and the current state becomes redoable", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    const u = undo(h, "b")!;
    expect(u.state).toBe("a");
    expect(canRedo(u.history)).toBe(true);

    const r = redo(u.history, "a")!;
    expect(r.state).toBe("b");
  });

  it("walks back through several entries in order", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    h = record(h, "b");
    const first = undo(h, "c")!;
    expect(first.state).toBe("b");
    expect(undo(first.history, "b")!.state).toBe("a");
  });

  it("returns null when there is nothing to undo or redo", () => {
    const h = createHistory<string>();
    expect(undo(h, "a")).toBeNull();
    expect(redo(h, "a")).toBeNull();
  });

  it("clears the redo stack on a new edit", () => {
    let h = createHistory<string>();
    h = record(h, "a");
    const u = undo(h, "b")!;
    expect(canRedo(u.history)).toBe(true);
    expect(canRedo(record(u.history, "a"))).toBe(false);
  });

  it("never mutates the history it is given", () => {
    const h = createHistory<string>();
    record(h, "a");
    expect(h.past).toHaveLength(0);
  });

  it("caps the past at HISTORY_LIMIT, dropping the oldest", () => {
    let h = createHistory<number>();
    for (let i = 0; i < HISTORY_LIMIT + 10; i++) h = record(h, i);
    expect(h.past).toHaveLength(HISTORY_LIMIT);
    expect(h.past[0]).toBe(10);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/state/history.test.ts`
Expected: FAIL — `Failed to resolve import "./history"`.

- [ ] **Step 3: Write the implementation**

`src/state/history.ts`:
```ts
/** Snapshot undo, generic over the snapshot type. The document holds no sample data, so a
 *  snapshot is kilobytes — no command objects, no inverse operations, no structural sharing. */

export const HISTORY_LIMIT = 100;

export interface History<T> {
  past: T[];
  future: T[];
}

export function createHistory<T>(): History<T> {
  return { past: [], future: [] };
}

export function canUndo(h: History<unknown>): boolean {
  return h.past.length > 0;
}

export function canRedo(h: History<unknown>): boolean {
  return h.future.length > 0;
}

/** Call with the state as it was BEFORE the edit. A new edit invalidates the redo stack. */
export function record<T>(h: History<T>, previous: T): History<T> {
  const past = [...h.past, previous];
  if (past.length > HISTORY_LIMIT) past.splice(0, past.length - HISTORY_LIMIT);
  return { past, future: [] };
}

export function undo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.past.length === 0) return null;
  const past = h.past.slice();
  const state = past.pop()!;
  return { history: { past, future: [...h.future, current] }, state };
}

export function redo<T>(h: History<T>, current: T): { history: History<T>; state: T } | null {
  if (h.future.length === 0) return null;
  const future = h.future.slice();
  const state = future.pop()!;
  return { history: { past: [...h.past, current], future }, state };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/state/history.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/state/history.ts src/state/history.test.ts
git commit -m "feat: snapshot undo history"
```

---

### Task 12: Waveform peaks

**Files:**
- Create: `src/audio/peaks.ts`
- Test: `src/audio/peaks.test.ts`

**Interfaces:**
- Consumes: `PEAK_SAMPLES_PER_PAIR` from `../doc/document`
- Produces:
  - `computePeaks(channels: readonly Float32Array[], samplesPerPair?: number): Float32Array` — interleaved `[min0, max0, min1, max1, …]`, one pair per `samplesPerPair` input samples, channels averaged to mono
  - `peakPairCount(peaks: Float32Array): number`
  - `aggregatePeaks(peaks, sampleRate, samplesPerPair, fromS, toS, width): Float32Array` — `width` interleaved min/max pairs covering `[fromS, toS)`, ready to draw one pixel column each

- [ ] **Step 1: Write the failing test**

`src/audio/peaks.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { aggregatePeaks, computePeaks, peakPairCount } from "./peaks";

/** A ramp from -1 to +1 over `n` samples. */
function ramp(n: number): Float32Array {
  const a = new Float32Array(n);
  for (let i = 0; i < n; i++) a[i] = -1 + (2 * i) / (n - 1);
  return a;
}

describe("computePeaks", () => {
  it("produces one min/max pair per bucket", () => {
    const peaks = computePeaks([new Float32Array(1024)], 256);
    expect(peaks).toHaveLength(8); // 4 pairs
    expect(peakPairCount(peaks)).toBe(4);
  });

  it("captures the min and max within each bucket", () => {
    const ch = new Float32Array([0, 0.5, -0.25, 0]);
    const peaks = computePeaks([ch], 4);
    expect(peaks[0]).toBeCloseTo(-0.25);
    expect(peaks[1]).toBeCloseTo(0.5);
  });

  it("averages channels to mono", () => {
    const l = new Float32Array([1, 1]);
    const r = new Float32Array([-1, -1]);
    const peaks = computePeaks([l, r], 2);
    expect(peaks[0]).toBeCloseTo(0);
    expect(peaks[1]).toBeCloseTo(0);
  });

  it("handles a final partial bucket", () => {
    expect(peakPairCount(computePeaks([new Float32Array(300)], 256))).toBe(2);
  });

  it("returns an empty array for empty input", () => {
    expect(computePeaks([new Float32Array(0)], 256)).toHaveLength(0);
    expect(computePeaks([], 256)).toHaveLength(0);
  });

  it("reports silence as a zero pair", () => {
    const peaks = computePeaks([new Float32Array(256)], 256);
    expect([...peaks]).toEqual([0, 0]);
  });
});

describe("aggregatePeaks", () => {
  // 48000 samples at 48 kHz = 1 s, 256 samples per pair => 187.5 pairs.
  const peaks = computePeaks([ramp(48000)], 256);

  it("returns exactly `width` pairs", () => {
    expect(aggregatePeaks(peaks, 48000, 256, 0, 1, 100)).toHaveLength(200);
  });

  it("spans the requested window, rising across a ramp", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0, 1, 4);
    expect(out[1]).toBeLessThan(out[7]); // first column's max < last column's max
    expect(out[0]).toBeCloseTo(-1, 1);
    expect(out[7]).toBeCloseTo(1, 1);
  });

  it("zooms into a sub-window", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0.9, 1.0, 2);
    expect(out[0]).toBeGreaterThan(0.5); // late in a -1..+1 ramp, everything is positive
  });

  it("pads with zeros past the end of the source", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 2, 3, 4);
    expect([...out]).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
  });

  it("never returns an empty column inside the source, even when zoomed past 1 pair per column", () => {
    const out = aggregatePeaks(peaks, 48000, 256, 0.5, 0.5001, 50);
    for (let i = 0; i < out.length; i += 2) expect(out[i + 1]).toBeGreaterThan(out[i] - 1e-9);
    expect(out.some((v) => v !== 0)).toBe(true);
  });

  it("returns zeros for a zero or negative width window", () => {
    expect([...aggregatePeaks(peaks, 48000, 256, 1, 1, 2)]).toEqual([0, 0, 0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/peaks.test.ts`
Expected: FAIL — `Failed to resolve import "./peaks"`.

- [ ] **Step 3: Write the implementation**

`src/audio/peaks.ts`:
```ts
import { PEAK_SAMPLES_PER_PAIR } from "../doc/document";

/**
 * Downsample to interleaved `[min, max]` pairs, one pair per `samplesPerPair` input samples,
 * channels averaged to mono. Computed ONCE per imported source; every zoom level is drawn by
 * aggregating from this one array (see `aggregatePeaks`).
 */
export function computePeaks(
  channels: readonly Float32Array[],
  samplesPerPair: number = PEAK_SAMPLES_PER_PAIR,
): Float32Array {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return new Float32Array(0);
  const chCount = channels.length;
  const pairs = Math.ceil(n / samplesPerPair);
  const out = new Float32Array(pairs * 2);

  for (let p = 0; p < pairs; p++) {
    const start = p * samplesPerPair;
    const end = Math.min(n, start + samplesPerPair);
    let min = Infinity;
    let max = -Infinity;
    for (let i = start; i < end; i++) {
      let sum = 0;
      for (let c = 0; c < chCount; c++) sum += channels[c][i];
      const v = sum / chCount;
      if (v < min) min = v;
      if (v > max) max = v;
    }
    out[p * 2] = min;
    out[p * 2 + 1] = max;
  }
  return out;
}

export function peakPairCount(peaks: Float32Array): number {
  return peaks.length >> 1;
}

/**
 * `width` interleaved min/max pairs covering `[fromS, toS)` — one per pixel column.
 *
 * When zoomed in past one pair per column, neighbouring columns read the SAME pair rather than
 * some reading none: an empty column would draw as a gap in the middle of continuous audio.
 * Columns outside the source read as `[0, 0]` (silence), which is what a clip's unused tail is.
 */
export function aggregatePeaks(
  peaks: Float32Array,
  sampleRate: number,
  samplesPerPair: number,
  fromS: number,
  toS: number,
  width: number,
): Float32Array {
  const out = new Float32Array(Math.max(0, width) * 2);
  if (width <= 0 || !(toS > fromS)) return out;

  const pairs = peakPairCount(peaks);
  const pairDurS = samplesPerPair / sampleRate;
  const stepS = (toS - fromS) / width;

  for (let col = 0; col < width; col++) {
    const t0 = fromS + col * stepS;
    const t1 = t0 + stepS;
    let lo = Math.floor(t0 / pairDurS);
    let hi = Math.ceil(t1 / pairDurS);
    if (hi <= lo) hi = lo + 1; // zoomed past one pair per column
    lo = Math.max(0, lo);
    hi = Math.min(pairs, hi);
    if (hi <= lo) continue; // outside the source — leave the [0, 0] silence

    let min = Infinity;
    let max = -Infinity;
    for (let p = lo; p < hi; p++) {
      const a = peaks[p * 2];
      const b = peaks[p * 2 + 1];
      if (a < min) min = a;
      if (b > max) max = b;
    }
    out[col * 2] = min;
    out[col * 2 + 1] = max;
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/audio/peaks.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/audio/peaks.ts src/audio/peaks.test.ts
git commit -m "feat: waveform peak computation and zoom aggregation"
```

---

### Task 13: Fade curves

One source of truth for fade shapes, used identically by live playback and by the offline mixdown.

**Files:**
- Create: `src/audio/fades.ts`
- Test: `src/audio/fades.test.ts`

**Interfaces:**
- Consumes: `FadeShape` from `../doc/document`
- Produces:
  - `FADE_CURVE_POINTS = 128`
  - `fadeInCurve(shape: FadeShape, n?: number, fromT?: number, toT?: number): Float32Array` — gain rising 0 → 1 across the fade; `fromT`/`toT` sample a SUB-RANGE of the fade, for a fade the playback window cut into
  - `fadeOutCurve(shape: FadeShape, n?: number, fromT?: number, toT?: number): Float32Array` — gain falling 1 → 0

- [ ] **Step 1: Write the failing test**

`src/audio/fades.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { FADE_CURVE_POINTS, fadeInCurve, fadeOutCurve } from "./fades";
import type { FadeShape } from "../doc/document";

const SHAPES: FadeShape[] = ["linear", "equalPower", "exponential"];

describe("fadeInCurve", () => {
  it("defaults to FADE_CURVE_POINTS samples", () => {
    expect(fadeInCurve("linear")).toHaveLength(FADE_CURVE_POINTS);
  });

  it.each(SHAPES)("%s starts at 0 and ends at 1", (shape) => {
    const c = fadeInCurve(shape, 64);
    expect(c[0]).toBeCloseTo(0);
    expect(c[63]).toBeCloseTo(1);
  });

  it.each(SHAPES)("%s is monotonically non-decreasing", (shape) => {
    const c = fadeInCurve(shape, 64);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeGreaterThanOrEqual(c[i - 1] - 1e-6);
  });

  it("the three shapes are genuinely different at the midpoint", () => {
    const mid = (s: FadeShape) => fadeInCurve(s, 65)[32];
    expect(mid("linear")).toBeCloseTo(0.5);
    expect(mid("equalPower")).toBeGreaterThan(0.6); // sin(pi/4) ~ 0.707
    expect(mid("exponential")).toBeLessThan(0.3); // 0.5^2 = 0.25
  });

  it("samples a sub-range for a fade the playback window cut into", () => {
    const half = fadeInCurve("linear", 33, 0.5, 1);
    expect(half[0]).toBeCloseTo(0.5);
    expect(half[32]).toBeCloseTo(1);
  });
});

describe("fadeOutCurve", () => {
  it.each(SHAPES)("%s starts at 1 and ends at 0", (shape) => {
    const c = fadeOutCurve(shape, 64);
    expect(c[0]).toBeCloseTo(1);
    expect(c[63]).toBeCloseTo(0);
  });

  it.each(SHAPES)("%s is monotonically non-increasing", (shape) => {
    const c = fadeOutCurve(shape, 64);
    for (let i = 1; i < c.length; i++) expect(c[i]).toBeLessThanOrEqual(c[i - 1] + 1e-6);
  });

  it("is the mirror of the fade in", () => {
    const inC = fadeInCurve("equalPower", 33);
    const outC = fadeOutCurve("equalPower", 33);
    for (let i = 0; i < 33; i++) expect(outC[i]).toBeCloseTo(inC[32 - i], 5);
  });

  it("samples a sub-range", () => {
    const tail = fadeOutCurve("linear", 33, 0.5, 1);
    expect(tail[0]).toBeCloseTo(0.5);
    expect(tail[32]).toBeCloseTo(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/fades.test.ts`
Expected: FAIL — `Failed to resolve import "./fades"`.

- [ ] **Step 3: Write the implementation**

`src/audio/fades.ts`:
```ts
import type { FadeShape } from "../doc/document";

/** Points per curve handed to `setValueCurveAtTime`. Enough for a smooth ramp at any fade length. */
export const FADE_CURVE_POINTS = 128;

/** Gain at normalised position `t` (0 = fade start, 1 = fade end) for a RISING fade. */
function shapeAt(shape: FadeShape, t: number): number {
  switch (shape) {
    case "equalPower":
      return Math.sin((t * Math.PI) / 2); // constant perceived loudness
    case "exponential":
      return t * t; // slow start, fast finish — for ducking a bed under speech
    case "linear":
    default:
      return t;
  }
}

function sample(shape: FadeShape, n: number, fromT: number, toT: number, rising: boolean) {
  const out = new Float32Array(n);
  const span = toT - fromT;
  for (let i = 0; i < n; i++) {
    const t = n === 1 ? fromT : fromT + (span * i) / (n - 1);
    out[i] = shapeAt(shape, rising ? t : 1 - t);
  }
  return out;
}

/**
 * Gain rising 0 → 1 across the fade.
 *
 * `fromT`/`toT` sample a SUB-RANGE of the fade in normalised fade time. That is how a fade the
 * playback window started partway through is handled: the engine schedules the remainder rather
 * than dropping the fade or restarting it.
 */
export function fadeInCurve(
  shape: FadeShape,
  n: number = FADE_CURVE_POINTS,
  fromT = 0,
  toT = 1,
): Float32Array {
  return sample(shape, n, fromT, toT, true);
}

/** Gain falling 1 → 0 across the fade. The exact mirror of `fadeInCurve`. */
export function fadeOutCurve(
  shape: FadeShape,
  n: number = FADE_CURVE_POINTS,
  fromT = 0,
  toT = 1,
): Float32Array {
  return sample(shape, n, fromT, toT, false);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/audio/fades.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/audio/fades.ts src/audio/fades.test.ts
git commit -m "feat: fade curve shapes shared by preview and export"
```

---

### Task 14: `planSchedule` — the shared preview/export planner

**The central architectural commitment.** Live playback and the offline mixdown both render the output of this one pure function, so what you hear and what you export cannot drift apart. It is also where mute and solo are resolved — one rule, one place.

**Files:**
- Create: `src/audio/schedule.ts`
- Test: `src/audio/schedule.test.ts`

**Interfaces:**
- Consumes: `Project`, `FadeShape`, `clipEndS` from `../doc/document`
- Produces:
  - `interface FadeSpec { atS: number; durS: number; shape: FadeShape; fromT: number; toT: number }` — `atS` is seconds from the START OF THE RENDER WINDOW; `fromT`/`toT` are the normalised sub-range of the fade that survives the window
  - `interface ScheduledClip { trackId, sourceId, when, sourceOffset, duration, gain, fadeIn, fadeOut }` — `gain` is the CLIP's own gain only; track and master gain are separate nodes
  - `planSchedule(p: Project, fromS: number, toS: number, soloed: ReadonlySet<string>): ScheduledClip[]`

- [ ] **Step 1: Write the failing test**

`src/audio/schedule.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject, type Project } from "../doc/document";
import { addClip, addTrack, makeClip, setClipFade, setClipGain, setTrackMuted } from "../doc/edits";
import { planSchedule } from "./schedule";

const NO_SOLO: ReadonlySet<string> = new Set();

/** One track, one clip: 10 s of source starting 2 s in, placed at t=5. */
function oneClip(): Project {
  const base = createProject();
  return addClip(base, base.tracks[0].id, makeClip("s", 5, 10, 2));
}

beforeEach(() => __resetIds());

describe("planSchedule window", () => {
  it("places a clip that sits wholly inside the window", () => {
    const plan = planSchedule(oneClip(), 0, 100, NO_SOLO);
    expect(plan).toHaveLength(1);
    expect(plan[0]).toMatchObject({ when: 5, sourceOffset: 2, duration: 10, gain: 1 });
  });

  it("makes `when` relative to the window start, not to t=0", () => {
    expect(planSchedule(oneClip(), 3, 100, NO_SOLO)[0].when).toBe(2);
  });

  it("enters a clip partway when the window starts inside it", () => {
    const plan = planSchedule(oneClip(), 8, 100, NO_SOLO);
    expect(plan[0]).toMatchObject({ when: 0, sourceOffset: 5, duration: 7 });
  });

  it("truncates a clip the window ends inside", () => {
    expect(planSchedule(oneClip(), 0, 9, NO_SOLO)[0]).toMatchObject({ when: 5, duration: 4 });
  });

  it("omits clips entirely outside the window, on either side", () => {
    expect(planSchedule(oneClip(), 20, 30, NO_SOLO)).toEqual([]);
    expect(planSchedule(oneClip(), 0, 5, NO_SOLO)).toEqual([]);
  });

  it("returns nothing for an empty or inverted window", () => {
    expect(planSchedule(oneClip(), 5, 5, NO_SOLO)).toEqual([]);
    expect(planSchedule(oneClip(), 9, 5, NO_SOLO)).toEqual([]);
  });
});

describe("planSchedule gain, mute and solo", () => {
  it("carries the clip's own gain and NOT the track gain", () => {
    let p = oneClip();
    p = setClipGain(p, p.tracks[0].clips[0].id, 0.5);
    p.tracks[0].gain = 0.25;
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].gain).toBe(0.5);
  });

  it("drops a muted track", () => {
    let p = oneClip();
    p = setTrackMuted(p, p.tracks[0].id, true);
    expect(planSchedule(p, 0, 100, NO_SOLO)).toEqual([]);
  });

  it("drops every track outside a non-empty solo set", () => {
    let p = oneClip();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 4));
    const plan = planSchedule(p, 0, 100, new Set([p.tracks[1].id]));
    expect(plan).toHaveLength(1);
    expect(plan[0].trackId).toBe(p.tracks[1].id);
  });

  it("an EMPTY solo set means no soloing — this is what mixdown passes", () => {
    let p = oneClip();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[1].id, makeClip("s", 0, 4));
    expect(planSchedule(p, 0, 100, NO_SOLO)).toHaveLength(2);
  });

  it("mute still wins over solo", () => {
    let p = oneClip();
    p = setTrackMuted(p, p.tracks[0].id, true);
    expect(planSchedule(p, 0, 100, new Set([p.tracks[0].id]))).toEqual([]);
  });
});

describe("planSchedule fades", () => {
  it("emits no fade specs when the clip has none", () => {
    const plan = planSchedule(oneClip(), 0, 100, NO_SOLO);
    expect(plan[0].fadeIn).toBeNull();
    expect(plan[0].fadeOut).toBeNull();
  });

  it("emits a whole fade in at the clip's start", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 2, fadeShape: "equalPower" });
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].fadeIn).toEqual({
      atS: 5, durS: 2, shape: "equalPower", fromT: 0, toT: 1,
    });
  });

  it("emits a whole fade out ending at the clip's end", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeOutS: 3 });
    expect(planSchedule(p, 0, 100, NO_SOLO)[0].fadeOut).toMatchObject({
      atS: 12, durS: 3, fromT: 0, toT: 1,
    });
  });

  it("renders the REMAINDER of a fade in the window started partway through", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 4 });
    const fade = planSchedule(p, 6, 100, NO_SOLO)[0].fadeIn!;
    expect(fade).toMatchObject({ atS: 0, durS: 3, fromT: 0.25, toT: 1 });
  });

  it("truncates a fade out the window ends inside", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeOutS: 4 });
    const fade = planSchedule(p, 0, 13, NO_SOLO)[0].fadeOut!;
    expect(fade).toMatchObject({ atS: 11, durS: 2, fromT: 0, toT: 0.5 });
  });

  it("drops a fade the window missed entirely", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 2 });
    expect(planSchedule(p, 8, 100, NO_SOLO)[0].fadeIn).toBeNull();
  });

  it("never emits overlapping fade spans", () => {
    let p = oneClip();
    p = setClipFade(p, p.tracks[0].clips[0].id, { fadeInS: 6, fadeOutS: 6 });
    const s = planSchedule(p, 0, 100, NO_SOLO)[0];
    expect(s.fadeIn!.atS + s.fadeIn!.durS).toBeLessThanOrEqual(s.fadeOut!.atS + 1e-9);
  });
});

describe("planSchedule ordering", () => {
  it("returns clips in track order, then in time order", () => {
    let p = createProject();
    p = addTrack(p, "B");
    p = addClip(p, p.tracks[0].id, makeClip("s", 4, 1));
    p = addClip(p, p.tracks[0].id, makeClip("s", 0, 1));
    p = addClip(p, p.tracks[1].id, makeClip("s", 2, 1));
    const plan = planSchedule(p, 0, 100, NO_SOLO);
    expect(plan.map((s) => [s.trackId === p.tracks[0].id ? "A" : "B", s.when]))
      .toEqual([["A", 0], ["A", 4], ["B", 2]]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/schedule.test.ts`
Expected: FAIL — `Failed to resolve import "./schedule"`.

- [ ] **Step 3: Write the implementation**

`src/audio/schedule.ts`:
```ts
import { clipEndS, type Clip, type FadeShape, type Project } from "../doc/document";

export interface FadeSpec {
  /** Seconds from the START OF THE RENDER WINDOW — feed straight to `setValueCurveAtTime`. */
  atS: number;
  durS: number;
  shape: FadeShape;
  /** The normalised sub-range of the fade that survives the window. A window that starts halfway
   *  through a 4 s fade in emits `{ fromT: 0.5, toT: 1 }`, so the remainder is rendered rather
   *  than the fade being dropped or restarted. */
  fromT: number;
  toT: number;
}

export interface ScheduledClip {
  /** Which track's GainNode this connects to. */
  trackId: string;
  sourceId: string;
  /** Seconds from the start of the render window. */
  when: number;
  /** Seconds into the source buffer. */
  sourceOffset: number;
  duration: number;
  /** The CLIP's own gain only — track and master gain are separate nodes, so the faders can be
   *  ridden during playback without rescheduling. */
  gain: number;
  fadeIn: FadeSpec | null;
  fadeOut: FadeSpec | null;
}

/** Intersect a fade's timeline span with the visible part of the clip. */
function fadeSpec(
  fadeStartS: number,
  fadeLenS: number,
  shape: FadeShape,
  visFromS: number,
  visToS: number,
  windowFromS: number,
): FadeSpec | null {
  if (fadeLenS <= 0) return null;
  const fs = Math.max(fadeStartS, visFromS);
  const fe = Math.min(fadeStartS + fadeLenS, visToS);
  if (!(fe > fs)) return null;
  return {
    atS: fs - windowFromS,
    durS: fe - fs,
    shape,
    fromT: (fs - fadeStartS) / fadeLenS,
    toT: (fe - fadeStartS) / fadeLenS,
  };
}

function scheduleClip(c: Clip, trackId: string, fromS: number, toS: number): ScheduledClip | null {
  const start = c.startS;
  const end = clipEndS(c);
  const s = Math.max(start, fromS);
  const e = Math.min(end, toS);
  if (!(e > s)) return null;
  return {
    trackId,
    sourceId: c.sourceId,
    when: s - fromS,
    sourceOffset: c.inS + (s - start),
    duration: e - s,
    gain: c.gain,
    fadeIn: fadeSpec(start, c.fadeInS, c.fadeShape, s, e, fromS),
    fadeOut: fadeSpec(end - c.fadeOutS, c.fadeOutS, c.fadeShape, s, e, fromS),
  };
}

/**
 * Turn the document into a flat list of clips to schedule over `[fromS, toS)`.
 *
 * Pure: no AudioContext, no DOM. Live playback renders this against an `AudioContext`; the
 * mixdown renders the SAME list against an `OfflineAudioContext`. That is what makes preview and
 * export structurally incapable of drifting apart.
 *
 * `soloed` is a PARAMETER rather than a document field on purpose. Solo is monitoring state and
 * must never change what an export contains — mixdown passes an empty set, which means "no
 * soloing", and that is enforced here rather than remembered by a caller.
 */
export function planSchedule(
  p: Project,
  fromS: number,
  toS: number,
  soloed: ReadonlySet<string>,
): ScheduledClip[] {
  if (!(toS > fromS)) return [];
  const out: ScheduledClip[] = [];
  for (const t of p.tracks) {
    if (t.muted) continue;
    if (soloed.size > 0 && !soloed.has(t.id)) continue;
    for (const c of t.clips) {
      const s = scheduleClip(c, t.id, fromS, toS);
      if (s) out.push(s);
    }
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/audio/schedule.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Verify the whole suite and the build gate**

Run: `npm test && npm run build`
Expected: all tests pass; 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/audio/schedule.ts src/audio/schedule.test.ts
git commit -m "feat: planSchedule — the pure planner shared by preview and export"
```

---

### Task 15: WAV encoder

The one export path that always works, in every browser, with no dependencies.

**Files:**
- Create: `src/export/wav.ts`
- Test: `src/export/wav.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces: `encodeWav(channels: readonly Float32Array[], sampleRate: number, bitDepth: 16 | 32): ArrayBuffer`

- [ ] **Step 1: Write the failing test**

`src/export/wav.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { encodeWav } from "./wav";

function ascii(view: DataView, offset: number, len: number): string {
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(view.getUint8(offset + i));
  return s;
}

describe("encodeWav header", () => {
  const buf = encodeWav([new Float32Array(4), new Float32Array(4)], 48000, 16);
  const v = new DataView(buf);

  it("writes RIFF/WAVE/fmt/data chunk ids", () => {
    expect(ascii(v, 0, 4)).toBe("RIFF");
    expect(ascii(v, 8, 4)).toBe("WAVE");
    expect(ascii(v, 12, 4)).toBe("fmt ");
    expect(ascii(v, 36, 4)).toBe("data");
  });

  it("declares the sample rate, channel count and byte rates", () => {
    expect(v.getUint16(22, true)).toBe(2); // channels
    expect(v.getUint32(24, true)).toBe(48000); // sample rate
    expect(v.getUint32(28, true)).toBe(48000 * 2 * 2); // byte rate
    expect(v.getUint16(32, true)).toBe(4); // block align
    expect(v.getUint16(34, true)).toBe(16); // bits per sample
  });

  it("declares format 1 (PCM) at 16 bit and 3 (float) at 32 bit", () => {
    expect(v.getUint16(20, true)).toBe(1);
    expect(new DataView(encodeWav([new Float32Array(4)], 48000, 32)).getUint16(20, true)).toBe(3);
  });

  it("sizes the RIFF and data chunks to the payload", () => {
    expect(v.getUint32(40, true)).toBe(4 * 2 * 2); // 4 frames, 2ch, 2 bytes
    expect(v.getUint32(4, true)).toBe(buf.byteLength - 8);
  });
});

describe("encodeWav samples", () => {
  it("interleaves channels", () => {
    const l = new Float32Array([1, 0]);
    const r = new Float32Array([-1, 0]);
    const v = new DataView(encodeWav([l, r], 48000, 16));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("clips out-of-range samples instead of wrapping", () => {
    const v = new DataView(encodeWav([new Float32Array([2, -2])], 48000, 16));
    expect(v.getInt16(44, true)).toBe(32767);
    expect(v.getInt16(46, true)).toBe(-32768);
  });

  it("round-trips float samples exactly at 32 bit", () => {
    const v = new DataView(encodeWav([new Float32Array([0.25, -0.5])], 48000, 32));
    expect(v.getFloat32(44, true)).toBe(0.25);
    expect(v.getFloat32(48, true)).toBe(-0.5);
  });

  it("handles mono and an empty buffer", () => {
    expect(new DataView(encodeWav([new Float32Array(0)], 48000, 16)).getUint32(40, true)).toBe(0);
    expect(encodeWav([new Float32Array([0.5])], 48000, 16).byteLength).toBe(46);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/export/wav.test.ts`
Expected: FAIL — `Failed to resolve import "./wav"`.

- [ ] **Step 3: Write the implementation**

`src/export/wav.ts`:
```ts
/** Minimal WAV writer. No dependencies, works in every browser — the guaranteed export path when
 *  WebCodecs has no encoder for what the user asked for. */

function writeAscii(v: DataView, offset: number, s: string): void {
  for (let i = 0; i < s.length; i++) v.setUint8(offset + i, s.charCodeAt(i));
}

export function encodeWav(
  channels: readonly Float32Array[],
  sampleRate: number,
  bitDepth: 16 | 32,
): ArrayBuffer {
  const numChannels = Math.max(1, channels.length);
  const frames = channels[0]?.length ?? 0;
  const bytesPerSample = bitDepth / 8;
  const blockAlign = numChannels * bytesPerSample;
  const dataBytes = frames * blockAlign;

  const buf = new ArrayBuffer(44 + dataBytes);
  const v = new DataView(buf);

  writeAscii(v, 0, "RIFF");
  v.setUint32(4, 36 + dataBytes, true);
  writeAscii(v, 8, "WAVE");
  writeAscii(v, 12, "fmt ");
  v.setUint32(16, 16, true); // fmt chunk size
  v.setUint16(20, bitDepth === 32 ? 3 : 1, true); // 3 = IEEE float, 1 = PCM
  v.setUint16(22, numChannels, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * blockAlign, true);
  v.setUint16(32, blockAlign, true);
  v.setUint16(34, bitDepth, true);
  writeAscii(v, 36, "data");
  v.setUint32(40, dataBytes, true);

  let offset = 44;
  for (let i = 0; i < frames; i++) {
    for (let c = 0; c < numChannels; c++) {
      const raw = channels[c]?.[i] ?? 0;
      if (bitDepth === 32) {
        v.setFloat32(offset, raw, true);
      } else {
        const s = Math.max(-1, Math.min(1, raw));
        v.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7fff, true);
      }
      offset += bytesPerSample;
    }
  }
  return buf;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/export/wav.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/export/wav.ts src/export/wav.test.ts
git commit -m "feat: WAV encoder (16-bit PCM and 32-bit float)"
```

---

### Task 16: Project file — zip pack and unpack

**Files:**
- Create: `src/persist/project-file.ts`
- Test: `src/persist/project-file.test.ts`

**Interfaces:**
- Consumes: `Project`, `createProject` from `../doc/document`; `zipSync`, `unzipSync`, `strToU8`, `strFromU8` from `fflate`
- Produces:
  - `PROJECT_FILE_VERSION = 1`, `PROJECT_FILE_EXT = ".slopaudio"`
  - `interface SourceRecord { id: string; name: string; bytes: Uint8Array }`
  - `class ProjectFileError extends Error`
  - `packProject(project: Project, sources: readonly SourceRecord[]): Uint8Array`
  - `unpackProject(zip: Uint8Array): { project: Project; sources: SourceRecord[] }`

- [ ] **Step 1: Write the failing test**

`src/persist/project-file.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { unzipSync, zipSync, strToU8 } from "fflate";
import { __resetIds, createProject } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import {
  PROJECT_FILE_VERSION, ProjectFileError, packProject, unpackProject, type SourceRecord,
} from "./project-file";

const SOURCES: SourceRecord[] = [
  { id: "src-1", name: "take1.wav", bytes: new Uint8Array([1, 2, 3, 4]) },
  { id: "src-2", name: "bed.mp3", bytes: new Uint8Array([9, 8]) },
];

function scene() {
  const base = createProject("My Mix");
  return addClip(base, base.tracks[0].id, makeClip("src-1", 5, 3, 1));
}

beforeEach(() => __resetIds());

describe("packProject", () => {
  it("writes project.json and one file per source", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect(Object.keys(files).sort()).toEqual([
      "project.json", "sources/src-1.wav", "sources/src-2.mp3",
    ]);
  });

  it("stores source bytes verbatim", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect([...files["sources/src-1.wav"]]).toEqual([1, 2, 3, 4]);
  });

  it("stamps the file version", () => {
    const files = unzipSync(packProject(scene(), SOURCES));
    expect(JSON.parse(new TextDecoder().decode(files["project.json"])).version)
      .toBe(PROJECT_FILE_VERSION);
  });
});

describe("round trip", () => {
  it("restores the project exactly", () => {
    const p = scene();
    expect(unpackProject(packProject(p, SOURCES)).project).toEqual(p);
  });

  it("restores source bytes and names", () => {
    const out = unpackProject(packProject(scene(), SOURCES)).sources;
    expect(out).toHaveLength(2);
    expect(out[0]).toMatchObject({ id: "src-1", name: "take1.wav" });
    expect([...out[0].bytes]).toEqual([1, 2, 3, 4]);
  });

  it("handles a project with no sources", () => {
    const out = unpackProject(packProject(createProject(), []));
    expect(out.sources).toEqual([]);
    expect(out.project.tracks).toHaveLength(1);
  });

  it("handles a source name with no extension", () => {
    const src: SourceRecord = { id: "src-9", name: "recording", bytes: new Uint8Array([7]) };
    expect(unpackProject(packProject(createProject(), [src])).sources[0].name).toBe("recording");
  });
});

describe("errors", () => {
  it("rejects a future file version rather than half-loading", () => {
    const bad = zipSync({
      "project.json": strToU8(JSON.stringify({
        version: PROJECT_FILE_VERSION + 1, project: createProject(), sources: [],
      })),
    });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
    expect(() => unpackProject(bad)).toThrow(/newer version/i);
  });

  it("rejects a zip with no project.json", () => {
    const bad = zipSync({ "nope.txt": strToU8("hi") });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });

  it("rejects malformed JSON", () => {
    const bad = zipSync({ "project.json": strToU8("{not json") });
    expect(() => unpackProject(bad)).toThrow(ProjectFileError);
  });

  it("rejects a manifest whose source file is missing from the zip", () => {
    const bad = zipSync({
      "project.json": strToU8(JSON.stringify({
        version: PROJECT_FILE_VERSION,
        project: createProject(),
        sources: [{ id: "src-1", name: "a.wav", file: "sources/src-1.wav" }],
      })),
    });
    expect(() => unpackProject(bad)).toThrow(/missing/i);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persist/project-file.test.ts`
Expected: FAIL — `Failed to resolve import "./project-file"`.

- [ ] **Step 3: Write the implementation**

`src/persist/project-file.ts`:
```ts
import { strFromU8, strToU8, unzipSync, zipSync } from "fflate";
import type { Project } from "../doc/document";

export const PROJECT_FILE_VERSION = 1;
export const PROJECT_FILE_EXT = ".slopaudio";

export interface SourceRecord {
  id: string;
  name: string;
  /** The ORIGINAL encoded file bytes — a 30 MB mp3 stays 30 MB rather than becoming PCM. */
  bytes: Uint8Array;
}

export class ProjectFileError extends Error {}

interface Manifest {
  version: number;
  project: Project;
  sources: { id: string; name: string; file: string }[];
}

function extensionOf(name: string): string {
  const dot = name.lastIndexOf(".");
  return dot > 0 ? name.slice(dot) : "";
}

/** A self-contained `.slopaudio` zip: project.json plus each source's original bytes. A browser
 *  has no stable file paths to relink to, so the audio travels with the edit. */
export function packProject(project: Project, sources: readonly SourceRecord[]): Uint8Array {
  const files: Record<string, Uint8Array> = {};
  const manifestSources = sources.map((s) => {
    const file = `sources/${s.id}${extensionOf(s.name)}`;
    files[file] = s.bytes;
    return { id: s.id, name: s.name, file };
  });
  const manifest: Manifest = { version: PROJECT_FILE_VERSION, project, sources: manifestSources };
  files["project.json"] = strToU8(JSON.stringify(manifest));
  return zipSync(files);
}

export function unpackProject(zip: Uint8Array): { project: Project; sources: SourceRecord[] } {
  let files: Record<string, Uint8Array>;
  try {
    files = unzipSync(zip);
  } catch {
    throw new ProjectFileError("Not a valid project file.");
  }

  const raw = files["project.json"];
  if (!raw) throw new ProjectFileError("Not a project file — project.json is missing.");

  let manifest: Manifest;
  try {
    manifest = JSON.parse(strFromU8(raw)) as Manifest;
  } catch {
    throw new ProjectFileError("Project file is corrupt — project.json could not be read.");
  }

  // Refuse outright rather than half-loading something written by a newer app.
  if (manifest.version > PROJECT_FILE_VERSION) {
    throw new ProjectFileError(
      `This project was saved by a newer version of slop-audio-editor (file version ${manifest.version}).`,
    );
  }

  const sources = (manifest.sources ?? []).map((s) => {
    const bytes = files[s.file];
    if (!bytes) throw new ProjectFileError(`Project file is missing audio for "${s.name}".`);
    return { id: s.id, name: s.name, bytes };
  });

  return { project: manifest.project, sources };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/persist/project-file.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/persist/project-file.ts src/persist/project-file.test.ts
git commit -m "feat: self-contained .slopaudio project files"
```

---

## Browser layer

Tasks 17 onward touch Web Audio, canvas and pointer input, none of which run in the node test
environment. They carry **manual verification steps** instead of test code — that is the same line
slop-animator draws, not a shortcut. Any pure helper introduced along the way still gets a unit test.

---

### Task 17: Audio context, decoding and the media pool

**Files:**
- Create: `src/audio/context.ts`, `src/audio/pool.ts`
- Test: `src/audio/pool.test.ts` (the pure parts only)

**Interfaces:**
- Consumes: `PROJECT_SAMPLE_RATE`, `PEAK_SAMPLES_PER_PAIR`, `newId` from `../doc/document`; `computePeaks` from `./peaks`; `SourceRecord` from `../persist/project-file`
- Produces:
  - `getAudioContext(): AudioContext` — one shared 48 kHz context, constructed lazily on first use
  - `interface Source { id, name, bytes, buffer, peaks, durationS }`
  - `class SourcePool` — `get(id)`, `add(source)`, `all()`, `clear()`, `records(): SourceRecord[]`
  - `decodeSource(id: string, name: string, bytes: Uint8Array, onProgress?: (f: number) => void): Promise<Source>`
  - `sourceFromFile(file: File, onProgress?): Promise<Source>`
  - `computePeaksChunked(channels, samplesPerPair, onProgress?): Promise<Float32Array>`

- [ ] **Step 1: Write the failing test for the pool (pure)**

`src/audio/pool.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { SourcePool, type Source } from "./pool";

function fakeSource(id: string, name: string): Source {
  return {
    id, name, bytes: new Uint8Array([1, 2]),
    buffer: null as unknown as AudioBuffer, // the pool never touches the buffer
    peaks: new Float32Array([0, 0]), durationS: 1.5,
  };
}

describe("SourcePool", () => {
  it("stores and retrieves by id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.get("a")?.name).toBe("a.wav");
    expect(pool.get("nope")).toBeUndefined();
  });

  it("lists everything it holds", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.add(fakeSource("b", "b.mp3"));
    expect(pool.all().map((s) => s.id)).toEqual(["a", "b"]);
  });

  it("produces SourceRecords carrying only what a project file needs", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    expect(pool.records()).toEqual([
      { id: "a", name: "a.wav", bytes: new Uint8Array([1, 2]) },
    ]);
  });

  it("clears on project open", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "a.wav"));
    pool.clear();
    expect(pool.all()).toEqual([]);
  });

  it("replaces a source added twice under the same id", () => {
    const pool = new SourcePool();
    pool.add(fakeSource("a", "old.wav"));
    pool.add(fakeSource("a", "new.wav"));
    expect(pool.all()).toHaveLength(1);
    expect(pool.get("a")?.name).toBe("new.wav");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/pool.test.ts`
Expected: FAIL — `Failed to resolve import "./pool"`.

- [ ] **Step 3: Write `src/audio/context.ts`**

```ts
import { PROJECT_SAMPLE_RATE } from "../doc/document";

let ctx: AudioContext | null = null;

/** One shared 48 kHz AudioContext, constructed lazily on first use (i.e. from a user gesture).
 *  Fixing the rate here is what makes `decodeAudioData` resample every import on the way in, so
 *  the engine and the mixdown never resample and never drift. */
export function getAudioContext(): AudioContext {
  if (!ctx) ctx = new AudioContext({ sampleRate: PROJECT_SAMPLE_RATE });
  return ctx;
}
```

- [ ] **Step 4: Write `src/audio/pool.ts`**

```ts
import { PEAK_SAMPLES_PER_PAIR, newId } from "../doc/document";
import type { SourceRecord } from "../persist/project-file";
import { getAudioContext } from "./context";
import { computePeaks } from "./peaks";

export interface Source {
  id: string;
  name: string;
  /** Original encoded bytes, kept for the project file. */
  bytes: Uint8Array;
  /** Decoded at PROJECT_SAMPLE_RATE. */
  buffer: AudioBuffer;
  peaks: Float32Array;
  durationS: number;
}

/** Session-scoped, append-only, NOT part of undo history. Cleared only when a project is opened. */
export class SourcePool {
  #byId = new Map<string, Source>();

  add(source: Source): void {
    this.#byId.set(source.id, source);
  }

  get(id: string): Source | undefined {
    return this.#byId.get(id);
  }

  all(): Source[] {
    return [...this.#byId.values()];
  }

  clear(): void {
    this.#byId.clear();
  }

  records(): SourceRecord[] {
    return this.all().map((s) => ({ id: s.id, name: s.name, bytes: s.bytes }));
  }
}

const PEAK_CHUNK_PAIRS = 4096;

/**
 * Peaks in chunks that yield to the event loop, so importing a 30-minute file does not freeze the
 * UI. Not a Worker: an `AudioBuffer` cannot be transferred, so a Worker would have to COPY every
 * channel across, and the copy costs about what the computation does.
 */
export async function computePeaksChunked(
  channels: readonly Float32Array[],
  samplesPerPair: number = PEAK_SAMPLES_PER_PAIR,
  onProgress?: (fraction: number) => void,
): Promise<Float32Array> {
  const n = channels[0]?.length ?? 0;
  if (n === 0) return new Float32Array(0);
  const totalPairs = Math.ceil(n / samplesPerPair);
  const out = new Float32Array(totalPairs * 2);

  for (let p = 0; p < totalPairs; p += PEAK_CHUNK_PAIRS) {
    const endPair = Math.min(totalPairs, p + PEAK_CHUNK_PAIRS);
    const slice = channels.map((ch) =>
      ch.subarray(p * samplesPerPair, Math.min(n, endPair * samplesPerPair)),
    );
    out.set(computePeaks(slice, samplesPerPair), p * 2);
    onProgress?.(endPair / totalPairs);
    await new Promise((r) => setTimeout(r, 0));
  }
  return out;
}

export async function decodeSource(
  id: string,
  name: string,
  bytes: Uint8Array,
  onProgress?: (fraction: number) => void,
): Promise<Source> {
  const ctx = getAudioContext();
  // decodeAudioData detaches the ArrayBuffer it is given, so hand it a copy and keep `bytes`.
  const ab = bytes.slice().buffer;
  const buffer = await ctx.decodeAudioData(ab);
  const channels: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) channels.push(buffer.getChannelData(c));
  const peaks = await computePeaksChunked(channels, PEAK_SAMPLES_PER_PAIR, onProgress);
  return { id, name, bytes, buffer, peaks, durationS: buffer.duration };
}

export async function sourceFromFile(
  file: File,
  onProgress?: (fraction: number) => void,
): Promise<Source> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  return decodeSource(newId("src"), file.name, bytes, onProgress);
}
```

- [ ] **Step 5: Run test to verify it passes**

Run: `npx vitest run src/audio/pool.test.ts && npm run build`
Expected: PASS; build 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/audio/context.ts src/audio/pool.ts src/audio/pool.test.ts
git commit -m "feat: shared 48 kHz context, decoding and the media pool"
```

---

### Task 18: `renderPlan` and the playback engine

`renderPlan` is deliberately thin and shared: Task 26's mixdown calls the exact same function with an `OfflineAudioContext`. Resist the urge to specialise it for playback.

**Files:**
- Create: `src/audio/render.ts`, `src/audio/engine.ts`
- Test: `src/audio/render.test.ts` (the pure gain-scaling helper only)

**Interfaces:**
- Consumes: `ScheduledClip`, `planSchedule` from `./schedule`; `fadeInCurve`, `fadeOutCurve`, `FADE_CURVE_POINTS` from `./fades`; `Source`, `SourcePool` from `./pool`; `getAudioContext` from `./context`; `Project` from `../doc/document`
- Produces:
  - `scaleCurve(curve: Float32Array, gain: number): Float32Array`
  - `interface RenderedGraph { trackGains: Map<string, GainNode>; masterGain: GainNode; sources: AudioBufferSourceNode[] }`
  - `renderPlan(ctx, plan, pool, project, startAt): RenderedGraph`
  - `class AudioEngine` — `play(project, pool, fromS, toS, soloed)`, `stop()`, `get playing`, `positionS()`, `setTrackGain(id, g)`, `setMasterGain(g)`, `onEnded` callback
  - `SCHEDULE_LEAD_S = 0.05`

- [ ] **Step 1: Write the failing test**

`src/audio/render.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { scaleCurve } from "./render";

describe("scaleCurve", () => {
  it("multiplies every point by the clip gain", () => {
    expect([...scaleCurve(new Float32Array([0, 0.5, 1]), 0.5)]).toEqual([0, 0.25, 0.5]);
  });

  it("returns the same array instance at unity gain — nothing to do", () => {
    const c = new Float32Array([0, 1]);
    expect(scaleCurve(c, 1)).toBe(c);
  });

  it("handles zero gain", () => {
    expect([...scaleCurve(new Float32Array([0, 1]), 0)]).toEqual([0, 0]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/audio/render.test.ts`
Expected: FAIL — `Failed to resolve import "./render"`.

- [ ] **Step 3: Write `src/audio/render.ts`**

```ts
import type { Project } from "../doc/document";
import { FADE_CURVE_POINTS, fadeInCurve, fadeOutCurve } from "./fades";
import type { Source } from "./pool";
import type { ScheduledClip } from "./schedule";

/** How far ahead of `ctx.currentTime` a live render is anchored, so every scheduled time and
 *  every fade curve lands in the future. `setValueCurveAtTime` in the past is undefined-ish
 *  territory across engines; a 50 ms lead is inaudible and sidesteps it entirely. */
export const SCHEDULE_LEAD_S = 0.05;

/** `setValueCurveAtTime` sets ABSOLUTE values, so a fade on a clip with non-unity gain has to be
 *  scaled — otherwise the fade would ramp to 1.0 and undo the clip's gain. */
export function scaleCurve(curve: Float32Array, gain: number): Float32Array {
  if (gain === 1) return curve;
  const out = new Float32Array(curve.length);
  for (let i = 0; i < curve.length; i++) out[i] = curve[i] * gain;
  return out;
}

export interface RenderedGraph {
  trackGains: Map<string, GainNode>;
  masterGain: GainNode;
  sources: AudioBufferSourceNode[];
}

/**
 * Build the node graph for a plan against ANY BaseAudioContext.
 *
 * Live playback passes an `AudioContext` and `startAt = ctx.currentTime + SCHEDULE_LEAD_S`;
 * the mixdown passes an `OfflineAudioContext` and `startAt = 0`. Same function, same plan — that
 * is what makes preview and export incapable of drifting apart.
 *
 * Track and master gains are REAL nodes rather than folded into each clip's gain, so the faders
 * can be ridden during playback without rescheduling anything.
 */
export function renderPlan(
  ctx: BaseAudioContext,
  plan: readonly ScheduledClip[],
  pool: { get(id: string): Source | undefined },
  project: Project,
  startAt: number,
): RenderedGraph {
  const masterGain = ctx.createGain();
  masterGain.gain.value = project.masterGain;
  masterGain.connect(ctx.destination);

  const trackGains = new Map<string, GainNode>();
  const sources: AudioBufferSourceNode[] = [];

  for (const sc of plan) {
    const source = pool.get(sc.sourceId);
    if (!source) continue; // a clip whose media never loaded is silent, not a crash

    let trackGain = trackGains.get(sc.trackId);
    if (!trackGain) {
      trackGain = ctx.createGain();
      trackGain.gain.value = project.tracks.find((t) => t.id === sc.trackId)?.gain ?? 1;
      trackGain.connect(masterGain);
      trackGains.set(sc.trackId, trackGain);
    }

    const clipGain = ctx.createGain();
    clipGain.gain.value = sc.gain;
    clipGain.connect(trackGain);

    if (sc.fadeIn) {
      const c = scaleCurve(
        fadeInCurve(sc.fadeIn.shape, FADE_CURVE_POINTS, sc.fadeIn.fromT, sc.fadeIn.toT),
        sc.gain,
      );
      clipGain.gain.setValueCurveAtTime(c, startAt + sc.fadeIn.atS, sc.fadeIn.durS);
    }
    if (sc.fadeOut) {
      const c = scaleCurve(
        fadeOutCurve(sc.fadeOut.shape, FADE_CURVE_POINTS, sc.fadeOut.fromT, sc.fadeOut.toT),
        sc.gain,
      );
      clipGain.gain.setValueCurveAtTime(c, startAt + sc.fadeOut.atS, sc.fadeOut.durS);
    }

    const node = ctx.createBufferSource();
    node.buffer = source.buffer;
    node.connect(clipGain);
    node.start(startAt + sc.when, sc.sourceOffset, sc.duration);
    sources.push(node);
  }

  return { trackGains, masterGain, sources };
}
```

- [ ] **Step 4: Write `src/audio/engine.ts`**

```ts
import { projectDurationS, type Project } from "../doc/document";
import { getAudioContext } from "./context";
import type { SourcePool } from "./pool";
import { renderPlan, SCHEDULE_LEAD_S, type RenderedGraph } from "./render";
import { planSchedule } from "./schedule";

/**
 * Transport. Schedules the ENTIRE remaining project up front — sample-accurate by construction,
 * no timer, no drift. Structural edits stop and restart from the current position; mix changes
 * (gain, master) are applied live on the retained nodes, so a fader can be ridden while playing.
 */
export class AudioEngine {
  #graph: RenderedGraph | null = null;
  #startCtxTime = 0;
  #startOffsetS = 0;
  #endS = 0;
  #stopTimer: ReturnType<typeof setTimeout> | null = null;

  /** Fired when playback runs off the end of the scheduled window. */
  onEnded: (() => void) | null = null;

  get playing(): boolean {
    return this.#graph !== null;
  }

  /** Where the playhead is now, in project seconds. Derived from the clock, never counted. */
  positionS(): number {
    if (!this.#graph) return this.#startOffsetS;
    const ctx = getAudioContext();
    return Math.min(this.#endS, this.#startOffsetS + (ctx.currentTime - this.#startCtxTime));
  }

  play(
    project: Project,
    pool: SourcePool,
    fromS: number,
    toS: number,
    soloed: ReadonlySet<string>,
  ): void {
    this.stop();
    const end = toS > 0 ? toS : projectDurationS(project);
    if (!(end > fromS)) return;

    const ctx = getAudioContext();
    void ctx.resume();
    const startAt = ctx.currentTime + SCHEDULE_LEAD_S;

    this.#graph = renderPlan(ctx, planSchedule(project, fromS, end, soloed), pool, project, startAt);
    this.#startCtxTime = startAt;
    this.#startOffsetS = fromS;
    this.#endS = end;

    // The plan may be entirely silent (no clips in the window), so the end is driven by the
    // window length rather than by any node's `ended` event.
    this.#stopTimer = setTimeout(
      () => {
        this.stop();
        this.onEnded?.();
      },
      (SCHEDULE_LEAD_S + (end - fromS)) * 1000,
    );
  }

  stop(): void {
    if (this.#stopTimer !== null) {
      clearTimeout(this.#stopTimer);
      this.#stopTimer = null;
    }
    if (!this.#graph) return;
    this.#startOffsetS = this.positionS();
    for (const s of this.#graph.sources) {
      try {
        s.stop();
      } catch {
        // Already ended — stopping twice is not an error worth surfacing.
      }
      s.disconnect();
    }
    this.#graph.masterGain.disconnect();
    this.#graph = null;
  }

  /** Live mix change — no rescheduling. */
  setTrackGain(trackId: string, gain: number): void {
    const g = this.#graph?.trackGains.get(trackId);
    if (g) g.gain.value = gain;
  }

  setMasterGain(gain: number): void {
    if (this.#graph) this.#graph.masterGain.gain.value = gain;
  }
}
```

- [ ] **Step 5: Run test and build**

Run: `npx vitest run src/audio/render.test.ts && npm run build`
Expected: PASS; build 0 errors, 0 warnings.

- [ ] **Step 6: Commit**

```bash
git add src/audio/render.ts src/audio/render.test.ts src/audio/engine.ts
git commit -m "feat: renderPlan shared by preview and export, plus the transport"
```

---

### Task 19: Application state store

**Files:**
- Create: `src/state/appState.svelte.ts`
- Test: none (thin `$state` wrapper; the logic it wraps is already tested in Tasks 4–11)

**Interfaces:**
- Consumes: everything from `../doc/*`, `../audio/pool`, `../audio/engine`, `./history`
- Produces:
  - `state` — the `$state` object: `project`, `selection`, `soloed` (a `SvelteSet<string>`), `playheadS`, `playing`, `loop`, `pxPerSecond`, `scrollS`, `trackHeightPx`, `snap`, `importing`, `dirty`
  - `pool: SourcePool`, `engine: AudioEngine`
  - `commit(fn: (p: Project) => Project): void` — one history entry
  - `beginGesture(kind?: "structural" | "mix")` / `amend(fn)` / `endGesture()` — one history entry
    per drag. `kind` defaults to `"structural"`; a `"mix"` gesture (gain faders) commits history
    WITHOUT rescheduling playback, so a fader can be ridden without an audible dropout on release.
  - `undoEdit()`, `redoEdit()`, `canUndoNow()`, `canRedoNow()`
  - `importFiles(files: FileList | File[], trackId: string, atS: number): Promise<void>`
  - `togglePlay()`, `seekTo(s)`, `toggleSolo(trackId)`
  - `selectedTrackIds(): string[]` — the tracks a range selection covers, or every track when there is no range
  - `copySelection()`, `cutSelection()`, `pasteAtPlayhead()`

- [ ] **Step 1: Write the store**

`src/state/appState.svelte.ts`:
```ts
import { SvelteSet } from "svelte/reactivity";
import { AudioEngine } from "../audio/engine";
import { SourcePool, sourceFromFile } from "../audio/pool";
import {
  copyClips, cutClips, pasteClips, type ClipboardData,
} from "../doc/clipboard";
import { createProject, projectDurationS, type Project } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import { NO_SELECTION, type Selection } from "../doc/selection";
import { canRedo, canUndo, createHistory, record, redo, undo } from "./history";

export const pool = new SourcePool();
export const engine = new AudioEngine();

/** The single source of truth. `soloed` is a SvelteSet: a plain Set is NOT reactive in runes
 *  mode, so mutating one would silently fail to update the track headers. */
export const state = $state({
  project: createProject(),
  selection: NO_SELECTION as Selection,
  soloed: new SvelteSet<string>(),
  playheadS: 0,
  playing: false,
  loop: false,
  pxPerSecond: 60,
  scrollS: 0,
  trackHeightPx: 88,
  snap: true,
  importing: null as { name: string; fraction: number } | null,
  dirty: false,
});

let history = createHistory<Project>();
let gestureBase: Project | null = null;
let clipboard: ClipboardData = { entries: [] };

export function canUndoNow(): boolean {
  return canUndo(history);
}

export function canRedoNow(): boolean {
  return canRedo(history);
}

/** One edit, one history entry. */
export function commit(fn: (p: Project) => Project): void {
  const prev = state.project;
  const next = fn(prev);
  if (next === prev) return;
  history = record(history, prev);
  state.project = next;
  state.dirty = true;
  restartIfPlaying();
}

/** A continuous gesture (dragging a clip, dragging a fade handle) mutates live via `amend` and
 *  produces ONE history entry when the pointer comes up. */
export function beginGesture(): void {
  gestureBase = state.project;
}

export function amend(fn: (p: Project) => Project): void {
  state.project = fn(state.project);
}

export function endGesture(): void {
  if (gestureBase && gestureBase !== state.project) {
    history = record(history, gestureBase);
    state.dirty = true;
    restartIfPlaying();
  }
  gestureBase = null;
}

export function undoEdit(): void {
  const r = undo(history, state.project);
  if (!r) return;
  history = r.history;
  state.project = r.state;
  state.dirty = true;
  restartIfPlaying();
}

export function redoEdit(): void {
  const r = redo(history, state.project);
  if (!r) return;
  history = r.history;
  state.project = r.state;
  state.dirty = true;
  restartIfPlaying();
}

/** Structural edits invalidate the schedule, so playback restarts from where it had got to.
 *  Mix changes do NOT go through here — they are applied live on the engine's retained nodes. */
function restartIfPlaying(): void {
  if (!state.playing) return;
  const at = engine.positionS();
  engine.stop();
  engine.play(state.project, pool, at, playEndS(), state.soloed);
}

function playEndS(): number {
  return state.selection.kind === "range" && state.loop
    ? state.selection.range.toS
    : projectDurationS(state.project);
}

export function togglePlay(): void {
  if (state.playing) {
    engine.stop();
    state.playing = false;
    state.playheadS = engine.positionS();
    return;
  }
  const from =
    state.loop && state.selection.kind === "range" ? state.selection.range.fromS : state.playheadS;
  engine.onEnded = () => {
    if (state.loop) {
      state.playheadS = from;
      engine.play(state.project, pool, from, playEndS(), state.soloed);
      return;
    }
    state.playing = false;
  };
  engine.play(state.project, pool, from, playEndS(), state.soloed);
  state.playheadS = from;
  state.playing = true;
}

export function seekTo(s: number): void {
  const clamped = Math.max(0, s);
  state.playheadS = clamped;
  if (state.playing) {
    engine.stop();
    engine.play(state.project, pool, clamped, playEndS(), state.soloed);
  }
}

export function toggleSolo(trackId: string): void {
  if (state.soloed.has(trackId)) state.soloed.delete(trackId);
  else state.soloed.add(trackId);
  restartIfPlaying(); // solo changes which clips are scheduled, unlike a gain change
}

/** The tracks an edit applies to: the range selection's tracks, or every track when there is
 *  no range. This is what keeps ripple scoped (spec §4). */
export function selectedTrackIds(): string[] {
  return state.selection.kind === "range"
    ? state.selection.range.trackIds
    : state.project.tracks.map((t) => t.id);
}

export async function importFiles(
  files: FileList | File[],
  trackId: string,
  atS: number,
): Promise<void> {
  let at = atS;
  for (const file of Array.from(files)) {
    state.importing = { name: file.name, fraction: 0 };
    try {
      const source = await sourceFromFile(file, (f) => {
        state.importing = { name: file.name, fraction: f };
      });
      pool.add(source);
      commit((p) => addClip(p, trackId, makeClip(source.id, at, source.durationS)));
      at += source.durationS;
    } finally {
      state.importing = null;
    }
  }
}

export function copySelection(): void {
  if (state.selection.kind !== "clips") return;
  clipboard = copyClips(state.project, state.selection.clipIds);
}

export function cutSelection(): void {
  if (state.selection.kind !== "clips") return;
  const ids = state.selection.clipIds;
  const result = cutClips(state.project, ids);
  clipboard = result.clipboard;
  commit(() => result.project);
  state.selection = NO_SELECTION;
}

export function pasteAtPlayhead(trackId: string): void {
  commit((p) => pasteClips(p, clipboard, trackId, state.playheadS));
}
```

- [ ] **Step 2: Verify the build gate**

Run: `npm run build && npm test`
Expected: 0 errors, 0 warnings; all existing tests still pass.

- [ ] **Step 3: Commit**

```bash
git add src/state/appState.svelte.ts
git commit -m "feat: application state store with gesture-aware undo"
```

---

### Task 20: Timeline geometry, snapping and formatting

Pure helpers every UI component needs. Testable, so they are written before any component.

**Files:**
- Create: `src/lib/geometry.ts`
- Test: `src/lib/geometry.test.ts`

**Interfaces:**
- Consumes: nothing
- Produces:
  - `timeToPx(s: number, scrollS: number, pxPerSecond: number): number`
  - `pxToTime(px: number, scrollS: number, pxPerSecond: number): number`
  - `snapTime(s: number, candidates: readonly number[], pxPerSecond: number, thresholdPx?: number): number`
  - `formatTime(s: number): string` — `mm:ss.mmm`
  - `gainToDb(gain: number): number`, `dbToGain(db: number): number`
  - `formatDb(gain: number): string`
  - `rulerTicks(fromS: number, toS: number, pxPerSecond: number): { s: number; major: boolean }[]`

- [ ] **Step 1: Write the failing test**

`src/lib/geometry.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import {
  dbToGain, formatDb, formatTime, gainToDb, pxToTime, rulerTicks, snapTime, timeToPx,
} from "./geometry";

describe("timeToPx / pxToTime", () => {
  it("converts with scroll and zoom applied", () => {
    expect(timeToPx(5, 2, 60)).toBe(180);
    expect(pxToTime(180, 2, 60)).toBe(5);
  });

  it("round-trips", () => {
    expect(pxToTime(timeToPx(3.25, 1.5, 44), 1.5, 44)).toBeCloseTo(3.25);
  });

  it("goes negative for times left of the viewport", () => {
    expect(timeToPx(0, 2, 60)).toBe(-120);
  });
});

describe("snapTime", () => {
  it("snaps to the nearest candidate within the pixel threshold", () => {
    expect(snapTime(5.05, [5, 9], 60, 8)).toBe(5);
  });

  it("leaves a time outside the threshold alone", () => {
    expect(snapTime(5.5, [5, 9], 60, 8)).toBe(5.5);
  });

  it("threshold is in PIXELS, so zooming in snaps less eagerly in time", () => {
    expect(snapTime(5.1, [5], 60, 8)).toBe(5); // 6 px away
    expect(snapTime(5.1, [5], 600, 8)).toBe(5.1); // 60 px away
  });

  it("picks the nearest of several candidates", () => {
    expect(snapTime(5.05, [5, 5.06], 60, 8)).toBe(5.06);
  });

  it("is identity with no candidates", () => {
    expect(snapTime(5.05, [], 60, 8)).toBe(5.05);
  });
});

describe("formatTime", () => {
  it("formats mm:ss.mmm", () => {
    expect(formatTime(0)).toBe("00:00.000");
    expect(formatTime(83.456)).toBe("01:23.456");
    expect(formatTime(3600)).toBe("60:00.000");
  });

  it("clamps negatives to zero", () => {
    expect(formatTime(-1)).toBe("00:00.000");
  });
});

describe("gain and dB", () => {
  it("round-trips unity as 0 dB", () => {
    expect(gainToDb(1)).toBe(0);
    expect(dbToGain(0)).toBe(1);
  });

  it("halving amplitude is about -6 dB", () => {
    expect(gainToDb(0.5)).toBeCloseTo(-6.02, 1);
    expect(dbToGain(-6.02)).toBeCloseTo(0.5, 2);
  });

  it("reports silence as -inf rather than -Infinity noise", () => {
    expect(formatDb(0)).toBe("−∞ dB");
  });

  it("formats to one decimal with a sign", () => {
    expect(formatDb(1)).toBe("0.0 dB");
    expect(formatDb(0.5)).toBe("−6.0 dB");
    expect(formatDb(2)).toBe("+6.0 dB");
  });
});

describe("rulerTicks", () => {
  it("covers the window and marks majors", () => {
    const ticks = rulerTicks(0, 10, 60);
    expect(ticks[0].s).toBe(0);
    expect(ticks[0].major).toBe(true);
    expect(ticks[ticks.length - 1].s).toBeGreaterThanOrEqual(10);
  });

  it("uses a coarser step when zoomed out", () => {
    const near = rulerTicks(0, 10, 200);
    const far = rulerTicks(0, 600, 2);
    expect(near.length).toBeLessThan(200);
    expect(far.length).toBeLessThan(200);
    expect(far[1].s - far[0].s).toBeGreaterThan(near[1].s - near[0].s);
  });

  it("returns nothing for an inverted window", () => {
    expect(rulerTicks(10, 5, 60)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/geometry.test.ts`
Expected: FAIL — `Failed to resolve import "./geometry"`.

- [ ] **Step 3: Write the implementation**

`src/lib/geometry.ts`:
```ts
export function timeToPx(s: number, scrollS: number, pxPerSecond: number): number {
  return (s - scrollS) * pxPerSecond;
}

export function pxToTime(px: number, scrollS: number, pxPerSecond: number): number {
  return px / pxPerSecond + scrollS;
}

/** Snap `s` to the nearest candidate within `thresholdPx` ON SCREEN. The threshold is in pixels,
 *  not seconds, so snapping stays equally forgiving to the hand at every zoom level. */
export function snapTime(
  s: number,
  candidates: readonly number[],
  pxPerSecond: number,
  thresholdPx = 8,
): number {
  let best = s;
  let bestDist = thresholdPx / pxPerSecond;
  for (const c of candidates) {
    const d = Math.abs(c - s);
    if (d <= bestDist) {
      best = c;
      bestDist = d;
    }
  }
  return best;
}

export function formatTime(s: number): string {
  // Round to milliseconds FIRST, then decompose — rounding after splitting lets 59.9999 carry
  // into "00:60.000".
  const totalMs = Math.round(Math.max(0, s) * 1000);
  const pad = (n: number, w: number) => String(n).padStart(w, "0");
  return `${pad(Math.floor(totalMs / 60000), 2)}:${pad(Math.floor((totalMs % 60000) / 1000), 2)}.${pad(totalMs % 1000, 3)}`;
}

export function gainToDb(gain: number): number {
  return gain <= 0 ? -Infinity : 20 * Math.log10(gain);
}

export function dbToGain(db: number): number {
  return Math.pow(10, db / 20);
}

export function formatDb(gain: number): string {
  const db = gainToDb(gain);
  if (!Number.isFinite(db)) return "−∞ dB";
  const sign = db > 0.05 ? "+" : db < -0.05 ? "−" : "";
  return `${sign}${Math.abs(db).toFixed(1)} dB`;
}

/** Roughly one tick per 80 px, chosen from a 1-2-5 ladder so the labels are always round numbers.
 *  Every fifth tick is major (labelled). */
const TICK_STEPS = [0.01, 0.02, 0.05, 0.1, 0.2, 0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300, 600];

export function rulerTicks(
  fromS: number,
  toS: number,
  pxPerSecond: number,
): { s: number; major: boolean }[] {
  if (!(toS > fromS)) return [];
  const targetS = 80 / pxPerSecond;
  const step = TICK_STEPS.find((s) => s >= targetS) ?? TICK_STEPS[TICK_STEPS.length - 1];
  const out: { s: number; major: boolean }[] = [];
  const first = Math.floor(fromS / step);
  const last = Math.ceil(toS / step);
  for (let i = first; i <= last; i++) {
    out.push({ s: i * step, major: i % 5 === 0 });
  }
  return out;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/geometry.test.ts`
Expected: PASS, all cases.

- [ ] **Step 5: Commit**

```bash
git add src/lib/geometry.ts src/lib/geometry.test.ts
git commit -m "feat: timeline geometry, snapping and dB/time formatting"
```

---

### Task 21: App shell — layout, ruler, playhead, zoom and scroll

**Files:**
- Modify: `src/App.svelte`
- Create: `src/lib/Ruler.svelte`, `src/lib/Playhead.svelte`, `src/lib/TimelineViewport.svelte`
- Test: none (DOM); manual verification below

**Interfaces:**
- Consumes: `state as appState`, `seekTo` from `../state/appState.svelte`; `rulerTicks`, `timeToPx`, `pxToTime`, `formatTime` from `./geometry`; `projectDurationS` from `../doc/document`
- Produces:
  - `TimelineViewport.svelte` — owns the scrolling/zooming surface and exposes `{ children }` plus a `viewportEl` binding; converts wheel events into `scrollS` / `pxPerSecond` changes
  - `Ruler.svelte` — time ruler; click and drag seek
  - `Playhead.svelte` — the vertical line, positioned from `appState.playheadS`
  - `App.svelte` — the three-row layout: toolbar slot (empty for now), timeline, inspector slot (empty for now); left header column reserved at a fixed width

- [ ] **Step 1: Write `src/lib/TimelineViewport.svelte`**

```svelte
<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { pxToTime } from "./geometry";

  const { children }: { children: import("svelte").Snippet } = $props();

  let el = $state<HTMLDivElement | null>(null);

  const MIN_PX_PER_S = 2;
  const MAX_PX_PER_S = 2000;

  /** Ctrl/Cmd-wheel zooms about the pointer; plain wheel scrolls in time. */
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = el!.getBoundingClientRect();
      const anchorS = pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
      const next = Math.min(
        MAX_PX_PER_S,
        Math.max(MIN_PX_PER_S, appState.pxPerSecond * Math.pow(1.0015, -e.deltaY)),
      );
      // Keep the time under the pointer pinned while the scale changes.
      appState.scrollS = Math.max(0, anchorS - (e.clientX - rect.left) / next);
      appState.pxPerSecond = next;
    } else {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      appState.scrollS = Math.max(0, appState.scrollS + dx / appState.pxPerSecond);
    }
  }
</script>

<div bind:this={el} class="relative flex-1 overflow-hidden" onwheel={onWheel}>
  {@render children()}
</div>
```

- [ ] **Step 2: Write `src/lib/Ruler.svelte`**

```svelte
<script lang="ts">
  import { seekTo, state as appState } from "../state/appState.svelte";
  import { formatTime, pxToTime, rulerTicks, timeToPx } from "./geometry";

  const { widthPx }: { widthPx: number } = $props();

  const toS = $derived(appState.scrollS + widthPx / appState.pxPerSecond);
  const ticks = $derived(rulerTicks(appState.scrollS, toS, appState.pxPerSecond));

  let el = $state<HTMLDivElement | null>(null);
  let dragging = $state(false);

  function seekFromEvent(e: PointerEvent) {
    const rect = el!.getBoundingClientRect();
    seekTo(pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond));
  }

  function onPointerDown(e: PointerEvent) {
    dragging = true;
    el!.setPointerCapture(e.pointerId);
    seekFromEvent(e);
  }
</script>

<div
  bind:this={el}
  class="relative h-7 shrink-0 cursor-text select-none border-b border-neutral-700 bg-neutral-800"
  onpointerdown={onPointerDown}
  onpointermove={(e) => dragging && seekFromEvent(e)}
  onpointerup={(e) => {
    dragging = false;
    el!.releasePointerCapture(e.pointerId);
  }}
>
  {#each ticks as tick (tick.s)}
    {@const x = timeToPx(tick.s, appState.scrollS, appState.pxPerSecond)}
    <div
      class="absolute bottom-0 w-px bg-neutral-600"
      class:h-2={!tick.major}
      class:h-3={tick.major}
      style="left: {x}px"
    ></div>
    {#if tick.major}
      <span class="absolute top-0.5 text-[10px] text-neutral-400" style="left: {x + 3}px">
        {formatTime(tick.s)}
      </span>
    {/if}
  {/each}
</div>
```

- [ ] **Step 3: Write `src/lib/Playhead.svelte`**

```svelte
<script lang="ts">
  import { engine, state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";

  // While playing, the position comes from the audio clock — never from a counter.
  $effect(() => {
    if (!appState.playing) return;
    let raf = 0;
    const tick = () => {
      appState.playheadS = engine.positionS();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  });

  const x = $derived(timeToPx(appState.playheadS, appState.scrollS, appState.pxPerSecond));
</script>

<div class="pointer-events-none absolute inset-y-0 z-20 w-px bg-red-500" style="left: {x}px">
  <div class="absolute -left-1 top-0 h-2 w-2 bg-red-500"></div>
</div>
```

- [ ] **Step 4: Rewrite `src/App.svelte` as the three-row layout**

```svelte
<script lang="ts">
  import Playhead from "./lib/Playhead.svelte";
  import Ruler from "./lib/Ruler.svelte";
  import TimelineViewport from "./lib/TimelineViewport.svelte";

  /** Left column holding track headers. Fixed so the ruler and lanes share one x origin. */
  const HEADER_W = 176;

  let timelineWidth = $state(0);
</script>

<div class="flex h-full flex-col bg-neutral-900 text-neutral-200">
  <!-- Toolbar lands here in Task 24 -->
  <header class="h-11 shrink-0 border-b border-neutral-700"></header>

  <div class="flex min-h-0 flex-1">
    <div class="shrink-0 border-r border-neutral-700" style="width: {HEADER_W}px">
      <!-- Track headers land here in Task 24 -->
      <div class="h-7 border-b border-neutral-700"></div>
    </div>

    <div class="flex min-w-0 flex-1 flex-col" bind:clientWidth={timelineWidth}>
      <Ruler widthPx={timelineWidth} />
      <TimelineViewport>
        <!-- Track lanes land here in Task 22 -->
        <Playhead />
      </TimelineViewport>
    </div>
  </div>

  <!-- Inspector lands here in Task 25 -->
  <footer class="h-10 shrink-0 border-t border-neutral-700"></footer>
</div>
```

- [ ] **Step 5: Manual verification**

Run: `npm run dev`, open the page, and confirm each of these:
- The ruler shows round time labels (`00:00.000`, `00:05.000`, …), and labels stay round at every zoom.
- Ctrl/Cmd-wheel zooms; the time under the pointer stays under the pointer.
- Plain wheel scrolls in time and cannot scroll left of `00:00`.
- Clicking and dragging on the ruler moves the red playhead line.
- The ruler and the timeline body share one x origin (playhead line meets the ruler tick you clicked).

- [ ] **Step 6: Verify the build gate and commit**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

```bash
git add src/App.svelte src/lib/Ruler.svelte src/lib/Playhead.svelte src/lib/TimelineViewport.svelte
git commit -m "feat: timeline shell — ruler, playhead, zoom and scroll"
```

---

### Task 22: Track lanes, clips and waveforms

**Files:**
- Create: `src/lib/TrackLane.svelte`, `src/lib/ClipView.svelte`, `src/lib/Waveform.svelte`
- Modify: `src/App.svelte` (render lanes inside `TimelineViewport`)
- Test: none (canvas); manual verification below

**Interfaces:**
- Consumes: `aggregatePeaks` from `../audio/peaks`; `pool`, `state as appState` from `../state/appState.svelte`; `timeToPx` from `./geometry`; `PEAK_SAMPLES_PER_PAIR`, `PROJECT_SAMPLE_RATE` from `../doc/document`
- Produces:
  - `Waveform.svelte` — `{ sourceId, inS, durS, widthPx, heightPx }`; draws one canvas of min/max columns
  - `ClipView.svelte` — `{ clip, trackId }`; positions itself, draws name, waveform, fade overlays
  - `TrackLane.svelte` — `{ track }`; one row, renders its clips

- [ ] **Step 1: Write `src/lib/Waveform.svelte`**

```svelte
<script lang="ts">
  import { aggregatePeaks } from "../audio/peaks";
  import { PEAK_SAMPLES_PER_PAIR, PROJECT_SAMPLE_RATE } from "../doc/document";
  import { pool } from "../state/appState.svelte";

  const {
    sourceId, inS, durS, widthPx, heightPx,
  }: { sourceId: string; inS: number; durS: number; widthPx: number; heightPx: number } = $props();

  let canvas = $state<HTMLCanvasElement | null>(null);

  $effect(() => {
    const el = canvas;
    const source = pool.get(sourceId);
    const w = Math.max(1, Math.round(widthPx));
    const h = Math.max(1, Math.round(heightPx));
    if (!el || !source) return;

    const dpr = window.devicePixelRatio || 1;
    el.width = w * dpr;
    el.height = h * dpr;
    const ctx = el.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const peaks = aggregatePeaks(
      source.peaks, PROJECT_SAMPLE_RATE, PEAK_SAMPLES_PER_PAIR, inS, inS + durS, w,
    );
    const mid = h / 2;
    ctx.fillStyle = "rgba(255,255,255,0.55)";
    for (let col = 0; col < w; col++) {
      const min = peaks[col * 2];
      const max = peaks[col * 2 + 1];
      const y0 = mid - max * mid;
      const y1 = mid - min * mid;
      ctx.fillRect(col, y0, 1, Math.max(1, y1 - y0));
    }
  });
</script>

<canvas
  bind:this={canvas}
  class="pointer-events-none absolute inset-0 h-full w-full"
  style="width: {widthPx}px; height: {heightPx}px"
></canvas>
```

- [ ] **Step 2: Write `src/lib/ClipView.svelte`**

```svelte
<script lang="ts">
  import type { Clip } from "../doc/document";
  import { pool, state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";
  import Waveform from "./Waveform.svelte";

  const { clip, heightPx }: { clip: Clip; heightPx: number } = $props();

  const x = $derived(timeToPx(clip.startS, appState.scrollS, appState.pxPerSecond));
  const w = $derived(clip.durS * appState.pxPerSecond);
  const selected = $derived(
    appState.selection.kind === "clips" && appState.selection.clipIds.includes(clip.id),
  );
  const name = $derived(pool.get(clip.sourceId)?.name ?? "missing audio");
</script>

<div
  data-clip-id={clip.id}
  class="absolute top-1 overflow-hidden rounded border bg-sky-800/70"
  class:border-sky-300={selected}
  class:border-sky-900={!selected}
  style="left: {x}px; width: {w}px; height: {heightPx - 8}px"
>
  <Waveform
    sourceId={clip.sourceId}
    inS={clip.inS}
    durS={clip.durS}
    widthPx={w}
    heightPx={heightPx - 8}
  />

  <!-- Fade overlays: triangles standing in for the gain ramp, drawn over the waveform. -->
  {#if clip.fadeInS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 left-0 bg-neutral-900/60"
      style="width: {clip.fadeInS * appState.pxPerSecond}px;
             clip-path: polygon(0 0, 100% 0, 0 100%)"
    ></div>
  {/if}
  {#if clip.fadeOutS > 0}
    <div
      class="pointer-events-none absolute inset-y-0 right-0 bg-neutral-900/60"
      style="width: {clip.fadeOutS * appState.pxPerSecond}px;
             clip-path: polygon(100% 0, 100% 100%, 0 0)"
    ></div>
  {/if}

  <span class="pointer-events-none absolute left-1 top-0.5 truncate text-[10px] text-white/80">
    {name}
  </span>
</div>
```

- [ ] **Step 3: Write `src/lib/TrackLane.svelte`**

```svelte
<script lang="ts">
  import type { Track } from "../doc/document";
  import { state as appState } from "../state/appState.svelte";
  import ClipView from "./ClipView.svelte";

  const { track }: { track: Track } = $props();
</script>

<div
  data-track-id={track.id}
  class="relative border-b border-neutral-800 bg-neutral-900"
  style="height: {appState.trackHeightPx}px"
>
  {#each track.clips as clip (clip.id)}
    <ClipView {clip} heightPx={appState.trackHeightPx} />
  {/each}
</div>
```

- [ ] **Step 4: Render lanes in `src/App.svelte`**

Add the import and replace the comment inside `<TimelineViewport>`:
```svelte
<script lang="ts">
  import TrackLane from "./lib/TrackLane.svelte";
  import { state as appState } from "./state/appState.svelte";
  // ...existing imports
</script>

<TimelineViewport>
  {#each appState.project.tracks as track (track.id)}
    <TrackLane {track} />
  {/each}
  <Playhead />
</TimelineViewport>
```

- [ ] **Step 5: Add a temporary import button so there is something to look at**

In `App.svelte`'s `<header>`, add:
```svelte
<input
  type="file"
  accept="audio/*"
  multiple
  class="m-2 text-xs"
  onchange={(e) => {
    const files = e.currentTarget.files;
    if (files) void importFiles(files, appState.project.tracks[0].id, 0);
  }}
/>
```
with `import { importFiles } from "./state/appState.svelte";`. Task 24 replaces this with the real toolbar.

- [ ] **Step 6: Manual verification**

Run `npm run dev`, import a music file and a spoken-word file, then confirm:
- Each clip appears at t=0 with a waveform that visibly matches the material (speech shows gaps, music does not).
- Zooming in redraws the waveform at higher detail rather than stretching it.
- Zooming far in still shows a continuous waveform with no blank columns.
- Zooming far out still renders in well under a second.
- A clip scrolled off the left edge is clipped by the viewport, not drawn over the track headers.

- [ ] **Step 7: Verify the build gate and commit**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

```bash
git add src/lib/TrackLane.svelte src/lib/ClipView.svelte src/lib/Waveform.svelte src/App.svelte
git commit -m "feat: track lanes, clip rendering and waveforms"
```

---

### Task 23: Clip interactions — select, move, trim, fade, range

**Files:**
- Create: `src/lib/hit-test.ts`, `src/lib/clip-drag.svelte.ts`
- Modify: `src/lib/ClipView.svelte`, `src/lib/TrackLane.svelte`
- Create: `src/lib/RangeOverlay.svelte`
- Test: `src/lib/hit-test.test.ts`

**Interfaces:**
- Consumes: `beginGesture`, `amend`, `endGesture`, `state as appState`, `pool` from `../state/appState.svelte`; `moveClips`, `trimClipStart`, `trimClipEnd`, `setClipFade` from `../doc/edits`; `editPoints` from `../doc/selection`; `snapTime` from `./geometry`
- Produces:
  - `type ClipZone = "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "body"`
  - `hitTestClip(xPx: number, yPx: number, widthPx: number, heightPx: number): ClipZone`
  - `startClipDrag(e: PointerEvent, clipId: string, zone: ClipZone): void` — installs pointermove/up handlers, drives `amend`, ends with `endGesture`
  - `startRangeDrag(e: PointerEvent, trackId: string): void`
  - `RangeOverlay.svelte` — draws the current time-range selection band

- [ ] **Step 1: Write the failing test**

`src/lib/hit-test.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { hitTestClip } from "./hit-test";

const W = 200;
const H = 80;

describe("hitTestClip", () => {
  it("reports the body in the middle", () => {
    expect(hitTestClip(100, 40, W, H)).toBe("body");
  });

  it("reports trim handles at the left and right edges", () => {
    expect(hitTestClip(2, 40, W, H)).toBe("trimStart");
    expect(hitTestClip(W - 2, 40, W, H)).toBe("trimEnd");
  });

  it("reports fade handles in the TOP corners, winning over the trim edge", () => {
    expect(hitTestClip(2, 3, W, H)).toBe("fadeIn");
    expect(hitTestClip(W - 2, 3, W, H)).toBe("fadeOut");
  });

  it("keeps the trim handle below the fade corner", () => {
    expect(hitTestClip(2, 40, W, H)).toBe("trimStart");
  });

  it("falls back to trim handles on a clip too narrow for two fade corners", () => {
    expect(hitTestClip(1, 3, 8, H)).toBe("trimStart");
    expect(hitTestClip(7, 3, 8, H)).toBe("trimEnd");
  });

  it("never returns a zone for a zero-width clip", () => {
    expect(hitTestClip(0, 0, 0, H)).toBe("body");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/hit-test.test.ts`
Expected: FAIL — `Failed to resolve import "./hit-test"`.

- [ ] **Step 3: Write `src/lib/hit-test.ts`**

```ts
export type ClipZone = "fadeIn" | "fadeOut" | "trimStart" | "trimEnd" | "body";

const EDGE_PX = 6;
const FADE_CORNER_PX = 14;
const FADE_CORNER_H_PX = 12;

/** Which part of a clip a pointer is over, in clip-local pixels.
 *  Fade corners sit ON TOP of the trim edges, so they need the narrower band and win the test —
 *  but only when the clip is wide enough for both corners plus some body. */
export function hitTestClip(
  xPx: number,
  yPx: number,
  widthPx: number,
  heightPx: number,
): ClipZone {
  if (widthPx <= 0) return "body";
  const roomForFades = widthPx >= FADE_CORNER_PX * 2 + EDGE_PX;
  if (roomForFades && yPx <= FADE_CORNER_H_PX) {
    if (xPx <= FADE_CORNER_PX) return "fadeIn";
    if (xPx >= widthPx - FADE_CORNER_PX) return "fadeOut";
  }
  if (xPx <= EDGE_PX) return "trimStart";
  if (xPx >= widthPx - EDGE_PX) return "trimEnd";
  return "body";
}
```

- [ ] **Step 4: Write `src/lib/clip-drag.svelte.ts`**

```ts
import { findClip, projectDurationS, type Project } from "../doc/document";
import { moveClips, setClipFade, trimClipEnd, trimClipStart } from "../doc/edits";
import { editPoints } from "../doc/selection";
import {
  amend, beginGesture, endGesture, pool, state as appState,
} from "../state/appState.svelte";
import { snapTime } from "./geometry";
import type { ClipZone } from "./hit-test";

/** Snap candidates: every clip boundary EXCEPT the ones belonging to the clips being dragged
 *  (a clip must not snap to itself), plus the playhead and t=0. */
function snapCandidates(p: Project, movingIds: readonly string[]): number[] {
  const moving = new Set(movingIds);
  const ids = p.tracks.map((t) => t.id);
  const all = editPoints(
    { ...p, tracks: p.tracks.map((t) => ({ ...t, clips: t.clips.filter((c) => !moving.has(c.id)) })) },
    ids,
  );
  return [...all, appState.playheadS, projectDurationS(p)];
}

/**
 * Drive one clip gesture from pointerdown to pointerup. Everything in between goes through
 * `amend` (no history); `endGesture` writes the single history entry.
 * Shift disables snapping for the duration of the drag.
 */
export function startClipDrag(e: PointerEvent, clipId: string, zone: ClipZone): void {
  const target = e.currentTarget as HTMLElement;
  target.setPointerCapture(e.pointerId);

  const startX = e.clientX;
  const startY = e.clientY;
  const base = appState.project;
  const found = findClip(base, clipId);
  if (!found) return;
  const original = found.clip;
  const sourceDurS = pool.get(original.sourceId)?.durationS ?? original.inS + original.durS;

  const movingIds =
    appState.selection.kind === "clips" && appState.selection.clipIds.includes(clipId)
      ? appState.selection.clipIds
      : [clipId];
  const candidates = snapCandidates(base, movingIds);

  beginGesture();

  function onMove(ev: PointerEvent) {
    const dxS = (ev.clientX - startX) / appState.pxPerSecond;
    const snapOn = appState.snap && !ev.shiftKey;

    if (zone === "body") {
      const wanted = original.startS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      const dTrack = Math.round((ev.clientY - startY) / appState.trackHeightPx);
      amend(() => moveClips(base, movingIds, snapped - original.startS, dTrack));
      return;
    }

    if (zone === "trimStart") {
      const wanted = original.startS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      amend(() => trimClipStart(base, clipId, snapped - original.startS));
      return;
    }

    if (zone === "trimEnd") {
      const wanted = original.startS + original.durS + dxS;
      const snapped = snapOn ? snapTime(wanted, candidates, appState.pxPerSecond) : wanted;
      amend(() =>
        trimClipEnd(base, clipId, snapped - (original.startS + original.durS), sourceDurS),
      );
      return;
    }

    if (zone === "fadeIn") {
      amend(() => setClipFade(base, clipId, { fadeInS: Math.max(0, original.fadeInS + dxS) }));
      return;
    }

    amend(() => setClipFade(base, clipId, { fadeOutS: Math.max(0, original.fadeOutS - dxS) }));
  }

  function onUp(ev: PointerEvent) {
    target.releasePointerCapture(ev.pointerId);
    window.removeEventListener("pointermove", onMove);
    window.removeEventListener("pointerup", onUp);
    endGesture();
  }

  window.addEventListener("pointermove", onMove);
  window.addEventListener("pointerup", onUp);
}
```

- [ ] **Step 5: Wire the drag into `ClipView.svelte`**

Add to its `<script>`:
```ts
  import { startClipDrag } from "./clip-drag.svelte";
  import { hitTestClip, type ClipZone } from "./hit-test";
  import { state as appState } from "../state/appState.svelte";

  let zone = $state<ClipZone>("body");

  function zoneAt(e: PointerEvent): ClipZone {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return hitTestClip(e.clientX - r.left, e.clientY - r.top, r.width, r.height);
  }

  const CURSORS: Record<ClipZone, string> = {
    body: "grab", trimStart: "ew-resize", trimEnd: "ew-resize",
    fadeIn: "nesw-resize", fadeOut: "nwse-resize",
  };

  function onPointerDown(e: PointerEvent) {
    e.stopPropagation(); // a clip click must not start a range drag on the lane behind it
    const z = zoneAt(e);
    const additive = e.metaKey || e.ctrlKey;
    const current =
      appState.selection.kind === "clips" ? appState.selection.clipIds : [];
    appState.selection = {
      kind: "clips",
      clipIds: additive
        ? current.includes(clip.id)
          ? current.filter((id) => id !== clip.id)
          : [...current, clip.id]
        : current.includes(clip.id)
          ? current
          : [clip.id],
    };
    startClipDrag(e, clip.id, z);
  }
```

and on the clip's root `<div>`:
```svelte
  onpointerdown={onPointerDown}
  onpointermove={(e) => (zone = zoneAt(e))}
  style="left: {x}px; width: {w}px; height: {heightPx - 8}px; cursor: {CURSORS[zone]}"
```
(merge the `cursor` into the existing `style` attribute rather than adding a second one).

- [ ] **Step 6: Add range selection to `TrackLane.svelte`**

Add to its `<script>`:
```ts
  import { pxToTime } from "./geometry";
  import { NO_SELECTION } from "../doc/selection";

  let el = $state<HTMLDivElement | null>(null);

  /** Drag on empty lane area = time-range selection. Vertical travel extends it across tracks. */
  function onPointerDown(e: PointerEvent) {
    const rect = el!.getBoundingClientRect();
    const anchorS = pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
    const anchorIndex = appState.project.tracks.findIndex((t) => t.id === track.id);
    appState.selection = NO_SELECTION;
    el!.setPointerCapture(e.pointerId);

    function onMove(ev: PointerEvent) {
      const s = pxToTime(ev.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
      const overIndex = Math.max(
        0,
        Math.min(
          appState.project.tracks.length - 1,
          anchorIndex + Math.round((ev.clientY - e.clientY) / appState.trackHeightPx),
        ),
      );
      const lo = Math.min(anchorIndex, overIndex);
      const hi = Math.max(anchorIndex, overIndex);
      appState.selection = {
        kind: "range",
        range: {
          fromS: Math.max(0, Math.min(anchorS, s)),
          toS: Math.max(anchorS, s),
          trackIds: appState.project.tracks.slice(lo, hi + 1).map((t) => t.id),
        },
      };
    }

    function onUp(ev: PointerEvent) {
      el!.releasePointerCapture(ev.pointerId);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      // A click with no drag is a deselect, not a zero-length range.
      if (appState.selection.kind === "range" &&
          appState.selection.range.toS - appState.selection.range.fromS < 0.001) {
        appState.selection = NO_SELECTION;
      }
    }

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }
```

and on the lane's root `<div>`: `bind:this={el} onpointerdown={onPointerDown}`.

- [ ] **Step 7: Write `src/lib/RangeOverlay.svelte`**

```svelte
<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { timeToPx } from "./geometry";

  const range = $derived(
    appState.selection.kind === "range" ? appState.selection.range : null,
  );
  const tracks = $derived(new Set(range?.trackIds ?? []));
</script>

{#if range}
  {@const x = timeToPx(range.fromS, appState.scrollS, appState.pxPerSecond)}
  {@const w = (range.toS - range.fromS) * appState.pxPerSecond}
  {#each appState.project.tracks as track, i (track.id)}
    {#if tracks.has(track.id)}
      <div
        class="pointer-events-none absolute z-10 border-x border-sky-300 bg-sky-400/20"
        style="left: {x}px; width: {w}px;
               top: {i * appState.trackHeightPx}px; height: {appState.trackHeightPx}px"
      ></div>
    {/if}
  {/each}
{/if}
```

Render it inside `<TimelineViewport>` in `App.svelte`, before `<Playhead />`.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, import two files onto two tracks, then confirm:
- Clicking a clip selects it (border brightens); ⌘-click adds a second; clicking empty lane clears.
- Dragging a clip body moves it; dropping it onto another clip trims/splits that clip rather than overlapping it.
- Dragging vertically moves the clip between tracks.
- Dragging the left edge trims the head — **and the audio under the untouched part does not shift**. Verify by putting the playhead on a recognisable word, then head-trimming: the word stays put.
- Dragging the right edge trims the tail and refuses to extend past the source's end.
- Dragging the top-left corner draws a growing fade-in triangle; top-right does the fade-out.
- Snapping pulls a dragged clip to neighbouring clip edges and the playhead; holding **Shift** disables it.
- Dragging on empty lane area draws a blue range band; dragging up or down extends it across tracks.
- One drag = one undo step (⌘Z after a drag returns the clip to exactly where it started).

- [ ] **Step 9: Run tests, verify the build gate, commit**

Run: `npm test && npm run build`
Expected: all pass; 0 errors, 0 warnings.

```bash
git add src/lib/hit-test.ts src/lib/hit-test.test.ts src/lib/clip-drag.svelte.ts \
        src/lib/ClipView.svelte src/lib/TrackLane.svelte src/lib/RangeOverlay.svelte src/App.svelte
git commit -m "feat: clip select, move, trim, fade handles and range selection"
```

---

### Task 24: Track headers and the transport toolbar

**Files:**
- Create: `src/lib/TrackHeader.svelte`, `src/lib/Toolbar.svelte`, `src/lib/Fader.svelte`
- Modify: `src/App.svelte`
- Test: none (DOM); manual verification below

**Interfaces:**
- Consumes: `state as appState`, `engine`, `commit`, `beginGesture`, `amend`, `endGesture`, `togglePlay`, `seekTo`, `toggleSolo`, `importFiles`, `undoEdit`, `redoEdit`, `canUndoNow`, `canRedoNow` from `../state/appState.svelte`; `setTrackGain`, `setTrackMuted`, `renameTrack`, `addTrack`, `removeTrack`, `setMasterGain`, `splitAt` from `../doc/edits`; `formatDb`, `formatTime`, `gainToDb`, `dbToGain` from `./geometry`
- Produces:
  - `Fader.svelte` — `{ gain, onInput, onCommit }`; a dB-scaled range input
  - `TrackHeader.svelte` — `{ track, index }`; name (double-click to rename), fader, M, S
  - `Toolbar.svelte` — Import, transport, time readout, zoom, snap, undo/redo, split, add track, master fader

- [ ] **Step 1: Write `src/lib/Fader.svelte`**

```svelte
<script lang="ts">
  import { dbToGain, formatDb, gainToDb } from "./geometry";

  const {
    gain, onInput, onCommit,
  }: { gain: number; onInput: (g: number) => void; onCommit: () => void } = $props();

  const MIN_DB = -60;
  const MAX_DB = 12;

  /** Below MIN_DB the fader means silence, not a very quiet signal. */
  const db = $derived(gain <= 0 ? MIN_DB : Math.max(MIN_DB, Math.min(MAX_DB, gainToDb(gain))));
</script>

<div class="flex items-center gap-1">
  <input
    type="range"
    class="h-1 w-24 accent-sky-400"
    min={MIN_DB}
    max={MAX_DB}
    step="0.1"
    value={db}
    oninput={(e) => {
      const v = Number(e.currentTarget.value);
      onInput(v <= MIN_DB ? 0 : dbToGain(v));
    }}
    onpointerup={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-16 shrink-0 text-right text-[10px] tabular-nums text-neutral-400">
    {formatDb(gain)}
  </span>
</div>
```

- [ ] **Step 2: Write `src/lib/TrackHeader.svelte`**

```svelte
<script lang="ts">
  import type { Track } from "../doc/document";
  import { renameTrack, setTrackGain, setTrackMuted } from "../doc/edits";
  import {
    amend, beginGesture, commit, endGesture, engine, state as appState, toggleSolo,
  } from "../state/appState.svelte";
  import Fader from "./Fader.svelte";

  const { track }: { track: Track } = $props();

  let renaming = $state(false);
  let nameInput = $state<HTMLInputElement | null>(null);
  let dragging = false;

  // `autofocus` is an a11y warning and the build gate is 0 warnings, so focus explicitly.
  $effect(() => {
    if (renaming) nameInput?.focus();
  });

  /** Gain is a MIX change: applied live on the engine's retained node, so a fader can be ridden
   *  while playing. Only the pointer-up commits a history entry. */
  function onGain(g: number) {
    if (!dragging) {
      dragging = true;
      beginGesture("mix"); // MIX gesture: no reschedule on release, so the fader can be ridden
    }
    amend((p) => setTrackGain(p, track.id, g));
    engine.setTrackGain(track.id, g);
  }

  function onGainCommit() {
    if (!dragging) return;
    dragging = false;
    endGesture();
  }
</script>

<div
  class="flex flex-col justify-between border-b border-neutral-800 px-2 py-1"
  style="height: {appState.trackHeightPx}px"
>
  <div class="flex items-center gap-1">
    {#if renaming}
      <input
        bind:this={nameInput}
        class="w-full bg-neutral-800 px-1 text-xs"
        value={track.name}
        onblur={(e) => {
          commit((p) => renameTrack(p, track.id, e.currentTarget.value.trim() || track.name));
          renaming = false;
        }}
        onkeydown={(e) => e.key === "Enter" && e.currentTarget.blur()}
      />
    {:else}
      <button
        class="flex-1 truncate text-left text-xs text-neutral-300"
        ondblclick={() => (renaming = true)}
      >
        {track.name}
      </button>
    {/if}

    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-amber-500={track.muted}
      class:text-black={track.muted}
      class:text-neutral-500={!track.muted}
      title="Mute (saved with the project, silences the export)"
      onclick={() => commit((p) => setTrackMuted(p, track.id, !track.muted))}
    >
      M
    </button>
    <button
      class="rounded px-1 text-[10px] font-bold"
      class:bg-sky-400={appState.soloed.has(track.id)}
      class:text-black={appState.soloed.has(track.id)}
      class:text-neutral-500={!appState.soloed.has(track.id)}
      title="Solo (preview only — never affects the export)"
      onclick={() => toggleSolo(track.id)}
    >
      S
    </button>
  </div>

  <Fader gain={track.gain} onInput={onGain} onCommit={onGainCommit} />
</div>
```

- [ ] **Step 3: Write `src/lib/Toolbar.svelte`**

```svelte
<script lang="ts">
  import {
    Pause, Play, Plus, Redo2, Repeat, Scissors, Square, Undo2, Upload,
  } from "@lucide/svelte";
  import { addTrack, setMasterGain, splitAt } from "../doc/edits";
  import {
    amend, beginGesture, canRedoNow, canUndoNow, commit, endGesture, engine, importFiles,
    redoEdit, seekTo, selectedTrackIds, state as appState, togglePlay, undoEdit,
  } from "../state/appState.svelte";
  import Fader from "./Fader.svelte";
  import { formatTime } from "./geometry";

  let fileInput = $state<HTMLInputElement | null>(null);
  let masterDragging = false;

  // Inline rather than an `@apply` rule: in Tailwind 4 an `@apply` inside a component <style>
  // block needs an `@reference` to the stylesheet in every file, which is more ceremony than
  // one shared string.
  const BTN =
    "rounded p-1 text-neutral-300 hover:bg-neutral-700 disabled:opacity-30 disabled:hover:bg-transparent";

  function onMasterGain(g: number) {
    if (!masterDragging) {
      masterDragging = true;
      beginGesture("mix"); // MIX gesture — see TrackHeader
    }
    amend((p) => setMasterGain(p, g));
    engine.setMasterGain(g);
  }
</script>

<div class="flex h-11 items-center gap-3 border-b border-neutral-700 px-2 text-neutral-300">
  <button class={BTN} title="Import audio" onclick={() => fileInput?.click()}>
    <Upload size={16} />
  </button>
  <input
    bind:this={fileInput}
    type="file"
    accept="audio/*"
    multiple
    class="hidden"
    onchange={(e) => {
      const files = e.currentTarget.files;
      if (files?.length) {
        void importFiles(files, appState.project.tracks[0].id, appState.playheadS);
      }
      e.currentTarget.value = "";
    }}
  />

  <div class="flex items-center gap-1">
    <button class={BTN} title="Play/pause (Space)" onclick={togglePlay}>
      {#if appState.playing}<Pause size={16} />{:else}<Play size={16} />{/if}
    </button>
    <button class={BTN} title="Stop" onclick={() => { if (appState.playing) togglePlay(); seekTo(0); }}>
      <Square size={16} />
    </button>
    <button
      class={BTN}
      class:text-sky-400={appState.loop}
      title="Loop the selected range (L)"
      onclick={() => (appState.loop = !appState.loop)}
    >
      <Repeat size={16} />
    </button>
  </div>

  <span class="w-24 tabular-nums text-sm">{formatTime(appState.playheadS)}</span>

  <div class="flex items-center gap-1">
    <button class={BTN} disabled={!canUndoNow()} title="Undo (⌘Z)" onclick={undoEdit}>
      <Undo2 size={16} />
    </button>
    <button class={BTN} disabled={!canRedoNow()} title="Redo (⇧⌘Z)" onclick={redoEdit}>
      <Redo2 size={16} />
    </button>
    <button
      class={BTN}
      title="Split at playhead (S)"
      onclick={() => commit((p) => splitAt(p, selectedTrackIds(), appState.playheadS))}
    >
      <Scissors size={16} />
    </button>
    <button class={BTN} title="Add track" onclick={() => commit((p) => addTrack(p))}>
      <Plus size={16} />
    </button>
  </div>

  <label class="flex items-center gap-1 text-xs">
    <input type="checkbox" bind:checked={appState.snap} /> Snap
  </label>

  <div class="ml-auto flex items-center gap-2 text-xs">
    <span class="text-neutral-500">Master</span>
    <Fader
      gain={appState.project.masterGain}
      onInput={onMasterGain}
      onCommit={() => { if (masterDragging) { masterDragging = false; endGesture(); } }}
    />
  </div>
</div>
```

- [ ] **Step 4: Wire both into `src/App.svelte`**

Replace the placeholder `<header>` with `<Toolbar />`, and the placeholder inside the header column with:
```svelte
<div class="h-7 border-b border-neutral-700"></div>
{#each appState.project.tracks as track (track.id)}
  <TrackHeader {track} />
{/each}
```
Remove the temporary file input added in Task 22 Step 5.

- [ ] **Step 5: Manual verification**

Run `npm run dev` and confirm:
- Import puts a clip at the playhead; importing two files at once places them end to end.
- Space and the transport buttons play and pause; the time readout counts up smoothly.
- **Dragging a track fader while playing changes the level immediately, with no gap or restart.** This is the point of keeping track gain as its own node.
- **Mute silences the track and survives undo/redo as a document edit; solo silences the others without being undoable.**
- Soloing while playing takes effect (playback restarts from the current position — a brief gap here is expected, unlike a fader move).
- Double-clicking a track name renames it; Enter and blur both commit.
- Add track appends a track; the header column and the lanes stay aligned row for row.
- The master fader rides live too.

- [ ] **Step 6: Verify the build gate and commit**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

```bash
git add src/lib/TrackHeader.svelte src/lib/Toolbar.svelte src/lib/Fader.svelte src/App.svelte
git commit -m "feat: track headers with live faders, and the transport toolbar"
```

---

### Task 25: Clip inspector

**Files:**
- Create: `src/lib/Inspector.svelte`, `src/lib/NumberField.svelte`
- Modify: `src/App.svelte`
- Test: none (DOM); manual verification below

**Interfaces:**
- Consumes: `findClip` from `../doc/document`; `setClipFade`, `setClipGain`, `trimClipEnd`, `trimClipStart` from `../doc/edits`; `commit`, `pool`, `state as appState` from `../state/appState.svelte`; `formatDb`, `gainToDb`, `dbToGain` from `./geometry`
- Produces:
  - `NumberField.svelte` — `{ label, value, min, suffix, onCommit }`; a TEXT input (a number input cannot bind a string draft), committing on blur and Enter, reverting on Escape
  - `Inspector.svelte` — the bottom strip; shows the single selected clip's source name, in/out, gain, fades and shape

- [ ] **Step 1: Write `src/lib/NumberField.svelte`**

```svelte
<script lang="ts">
  const {
    label, value, min = 0, suffix = "",
    onCommit,
  }: {
    label: string; value: number; min?: number; suffix?: string;
    onCommit: (v: number) => void;
  } = $props();

  let draft = $state(value.toFixed(2));

  // Re-sync when the underlying value changes from elsewhere (a drag, an undo).
  $effect(() => {
    draft = value.toFixed(2);
  });

  function commitDraft() {
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(Math.max(min, v));
    else draft = value.toFixed(2);
  }
</script>

<label class="flex items-center gap-1 text-[11px] text-neutral-400">
  {label}
  <input
    class="w-16 rounded bg-neutral-800 px-1 py-0.5 text-right tabular-nums text-neutral-100"
    type="text"
    inputmode="decimal"
    bind:value={draft}
    onblur={commitDraft}
    onkeydown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        draft = value.toFixed(2);
        e.currentTarget.blur();
      }
      e.stopPropagation(); // keep the global shortcuts out of a text field
    }}
  />
  {#if suffix}<span class="text-neutral-600">{suffix}</span>{/if}
</label>
```

- [ ] **Step 2: Write `src/lib/Inspector.svelte`**

```svelte
<script lang="ts">
  import { findClip, type FadeShape } from "../doc/document";
  import { setClipFade, setClipGain, trimClipEnd, trimClipStart } from "../doc/edits";
  import { commit, pool, state as appState } from "../state/appState.svelte";
  import { dbToGain, gainToDb } from "./geometry";
  import NumberField from "./NumberField.svelte";

  /** The inspector edits ONE clip — it is for typing exact numbers, not for bulk operations. */
  const selected = $derived(
    appState.selection.kind === "clips" && appState.selection.clipIds.length === 1
      ? findClip(appState.project, appState.selection.clipIds[0])
      : undefined,
  );
  const clip = $derived(selected?.clip);
  const source = $derived(clip ? pool.get(clip.sourceId) : undefined);

  const SHAPES: FadeShape[] = ["linear", "equalPower", "exponential"];
  const SHAPE_LABELS: Record<FadeShape, string> = {
    linear: "Linear", equalPower: "Equal power", exponential: "Exponential",
  };
</script>

<div class="flex h-10 shrink-0 items-center gap-4 border-t border-neutral-700 px-3">
  {#if clip}
    <span class="w-48 truncate text-xs text-neutral-300">{source?.name ?? "missing audio"}</span>

    <NumberField
      label="in"
      value={clip.startS}
      suffix="s"
      onCommit={(v) => commit((p) => trimClipStart(p, clip.id, v - clip.startS))}
    />
    <NumberField
      label="out"
      value={clip.startS + clip.durS}
      suffix="s"
      onCommit={(v) =>
        commit((p) => trimClipEnd(p, clip.id, v - (clip.startS + clip.durS), source?.durationS ?? Infinity))}
    />
    <NumberField
      label="gain"
      value={clip.gain <= 0 ? -60 : gainToDb(clip.gain)}
      min={-60}
      suffix="dB"
      onCommit={(v) => commit((p) => setClipGain(p, clip.id, v <= -60 ? 0 : dbToGain(v)))}
    />
    <NumberField
      label="fade in"
      value={clip.fadeInS}
      suffix="s"
      onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeInS: v }))}
    />
    <NumberField
      label="fade out"
      value={clip.fadeOutS}
      suffix="s"
      onCommit={(v) => commit((p) => setClipFade(p, clip.id, { fadeOutS: v }))}
    />

    <select
      class="rounded bg-neutral-800 px-1 py-0.5 text-[11px]"
      value={clip.fadeShape}
      onchange={(e) =>
        commit((p) => setClipFade(p, clip.id, { fadeShape: e.currentTarget.value as FadeShape }))}
    >
      {#each SHAPES as shape (shape)}
        <option value={shape}>{SHAPE_LABELS[shape]}</option>
      {/each}
    </select>
  {:else}
    <span class="text-xs text-neutral-600">Select a clip to edit its exact values</span>
  {/if}
</div>
```

- [ ] **Step 3: Replace the placeholder `<footer>` in `src/App.svelte` with `<Inspector />`**

- [ ] **Step 4: Manual verification**

Run `npm run dev` and confirm:
- Selecting one clip fills the inspector; selecting two or none shows the hint text.
- Typing an `out` value and pressing Enter trims the clip, and refuses to exceed the source length.
- Typing a gain in dB changes the clip's level audibly on the next play.
- Typing a fade length draws the matching triangle on the clip.
- Escape in a field reverts it without editing the project.
- Dragging a clip's fade handle updates the inspector's number live.
- Typing in a field does not trigger the Space/S/Delete shortcuts (verified again after Task 26).

- [ ] **Step 5: Verify the build gate and commit**

Run: `npm run build`
Expected: 0 errors, 0 warnings.

```bash
git add src/lib/Inspector.svelte src/lib/NumberField.svelte src/App.svelte
git commit -m "feat: clip inspector for exact values"
```

---

### Task 26: Keyboard shortcuts

The key→command mapping is pure and therefore tested; only the dispatch is DOM code.

**Files:**
- Create: `src/lib/shortcuts.ts`, `src/lib/KeyboardShortcuts.svelte`
- Modify: `src/App.svelte`
- Test: `src/lib/shortcuts.test.ts`

**Interfaces:**
- Consumes: nothing (pure); the component consumes the store's actions
- Produces:
  - `type Command` — the union listed below
  - `interface KeyEventLike { key: string; metaKey: boolean; ctrlKey: boolean; shiftKey: boolean; altKey: boolean }`
  - `resolveShortcut(e: KeyEventLike): Command | null`

- [ ] **Step 1: Write the failing test**

`src/lib/shortcuts.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { resolveShortcut, type KeyEventLike } from "./shortcuts";

function key(k: string, mods: Partial<KeyEventLike> = {}): KeyEventLike {
  return { key: k, metaKey: false, ctrlKey: false, shiftKey: false, altKey: false, ...mods };
}

describe("resolveShortcut", () => {
  it("maps transport and edit keys", () => {
    expect(resolveShortcut(key(" "))).toEqual({ kind: "togglePlay" });
    expect(resolveShortcut(key("s"))).toEqual({ kind: "split" });
    expect(resolveShortcut(key("l"))).toEqual({ kind: "toggleLoop" });
    expect(resolveShortcut(key("m"))).toEqual({ kind: "toggleMute" });
    expect(resolveShortcut(key("S", { shiftKey: true }))).toEqual({ kind: "toggleSolo" });
  });

  it("maps delete, with shift meaning ripple", () => {
    expect(resolveShortcut(key("Backspace"))).toEqual({ kind: "delete", ripple: false });
    expect(resolveShortcut(key("Delete"))).toEqual({ kind: "delete", ripple: false });
    expect(resolveShortcut(key("Delete", { shiftKey: true }))).toEqual({
      kind: "delete", ripple: true,
    });
  });

  it("maps the clipboard on either meta or ctrl", () => {
    expect(resolveShortcut(key("c", { metaKey: true }))).toEqual({ kind: "copy" });
    expect(resolveShortcut(key("x", { ctrlKey: true }))).toEqual({ kind: "cut" });
    expect(resolveShortcut(key("v", { metaKey: true }))).toEqual({ kind: "paste" });
    expect(resolveShortcut(key("d", { metaKey: true }))).toEqual({ kind: "duplicate" });
  });

  it("maps undo and redo, with shift for redo", () => {
    expect(resolveShortcut(key("z", { metaKey: true }))).toEqual({ kind: "undo" });
    expect(resolveShortcut(key("z", { metaKey: true, shiftKey: true }))).toEqual({ kind: "redo" });
  });

  it("nudges by 100 ms, or 10 ms with shift", () => {
    expect(resolveShortcut(key("ArrowRight"))).toEqual({ kind: "nudge", deltaS: 0.1 });
    expect(resolveShortcut(key("ArrowLeft"))).toEqual({ kind: "nudge", deltaS: -0.1 });
    expect(resolveShortcut(key("ArrowRight", { shiftKey: true }))).toEqual({
      kind: "nudge", deltaS: 0.01,
    });
  });

  it("jumps between edit points with meta+arrow", () => {
    expect(resolveShortcut(key("ArrowRight", { metaKey: true }))).toEqual({
      kind: "jumpEdit", direction: 1,
    });
    expect(resolveShortcut(key("ArrowLeft", { metaKey: true }))).toEqual({
      kind: "jumpEdit", direction: -1,
    });
  });

  it("maps zoom", () => {
    expect(resolveShortcut(key("="))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("+"))).toEqual({ kind: "zoom", factor: 1.5 });
    expect(resolveShortcut(key("-"))).toEqual({ kind: "zoom", factor: 1 / 1.5 });
    expect(resolveShortcut(key("F", { shiftKey: true }))).toEqual({ kind: "zoomFit" });
  });

  it("returns null for anything unmapped", () => {
    expect(resolveShortcut(key("q"))).toBeNull();
    expect(resolveShortcut(key("F1"))).toBeNull();
  });

  it("does not confuse ⌘S with the split key", () => {
    expect(resolveShortcut(key("s", { metaKey: true }))).toEqual({ kind: "save" });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/shortcuts.test.ts`
Expected: FAIL — `Failed to resolve import "./shortcuts"`.

- [ ] **Step 3: Write `src/lib/shortcuts.ts`**

```ts
export type Command =
  | { kind: "togglePlay" }
  | { kind: "split" }
  | { kind: "toggleLoop" }
  | { kind: "toggleMute" }
  | { kind: "toggleSolo" }
  | { kind: "delete"; ripple: boolean }
  | { kind: "copy" }
  | { kind: "cut" }
  | { kind: "paste" }
  | { kind: "duplicate" }
  | { kind: "undo" }
  | { kind: "redo" }
  | { kind: "save" }
  | { kind: "nudge"; deltaS: number }
  | { kind: "jumpEdit"; direction: 1 | -1 }
  | { kind: "zoom"; factor: number }
  | { kind: "zoomFit" };

export interface KeyEventLike {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
}

const NUDGE_S = 0.1;
const FINE_NUDGE_S = 0.01;
const ZOOM_FACTOR = 1.5;

export function resolveShortcut(e: KeyEventLike): Command | null {
  const mod = e.metaKey || e.ctrlKey;
  const k = e.key;

  if (mod) {
    switch (k.toLowerCase()) {
      case "z":
        return { kind: e.shiftKey ? "redo" : "undo" };
      case "c":
        return { kind: "copy" };
      case "x":
        return { kind: "cut" };
      case "v":
        return { kind: "paste" };
      case "d":
        return { kind: "duplicate" };
      case "s":
        return { kind: "save" };
      case "arrowright":
        return { kind: "jumpEdit", direction: 1 };
      case "arrowleft":
        return { kind: "jumpEdit", direction: -1 };
      default:
        return null;
    }
  }

  switch (k) {
    case " ":
      return { kind: "togglePlay" };
    case "s":
      return { kind: "split" };
    case "S":
      return { kind: "toggleSolo" };
    case "l":
      return { kind: "toggleLoop" };
    case "m":
      return { kind: "toggleMute" };
    case "F":
      return { kind: "zoomFit" };
    case "Delete":
    case "Backspace":
      return { kind: "delete", ripple: e.shiftKey };
    case "ArrowRight":
      return { kind: "nudge", deltaS: e.shiftKey ? FINE_NUDGE_S : NUDGE_S };
    case "ArrowLeft":
      return { kind: "nudge", deltaS: -(e.shiftKey ? FINE_NUDGE_S : NUDGE_S) };
    case "=":
    case "+":
      return { kind: "zoom", factor: ZOOM_FACTOR };
    case "-":
    case "_":
      return { kind: "zoom", factor: 1 / ZOOM_FACTOR };
    default:
      return null;
  }
}
```

- [ ] **Step 4: Write `src/lib/KeyboardShortcuts.svelte`**

```svelte
<script lang="ts">
  import { projectDurationS } from "../doc/document";
  import {
    deleteClips, deleteRange, moveClips, setTrackMuted, splitAt,
  } from "../doc/edits";
  import { editPoints, nextEditPoint, prevEditPoint, NO_SELECTION } from "../doc/selection";
  import {
    commit, copySelection, cutSelection, pasteAtPlayhead, redoEdit, seekTo, selectedTrackIds,
    state as appState, toggleSolo, togglePlay, undoEdit,
  } from "../state/appState.svelte";
  import { resolveShortcut } from "./shortcuts";

  const { onSave, viewportWidthPx }: { onSave: () => void; viewportWidthPx: number } = $props();

  /** A shortcut must never fire while the user is typing into the inspector or a rename field. */
  function isTextTarget(t: EventTarget | null): boolean {
    const el = t as HTMLElement | null;
    return !!el && (el.tagName === "INPUT" || el.tagName === "SELECT" || el.isContentEditable);
  }

  function firstTrackId(): string {
    return selectedTrackIds()[0] ?? appState.project.tracks[0].id;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (isTextTarget(e.target)) return;
    const cmd = resolveShortcut(e);
    if (!cmd) return;
    e.preventDefault();

    switch (cmd.kind) {
      case "togglePlay":
        return togglePlay();
      case "split":
        return commit((p) => splitAt(p, selectedTrackIds(), appState.playheadS));
      case "toggleLoop":
        appState.loop = !appState.loop;
        return;
      case "toggleMute": {
        const id = firstTrackId();
        const muted = appState.project.tracks.find((t) => t.id === id)?.muted ?? false;
        return commit((p) => setTrackMuted(p, id, !muted));
      }
      case "toggleSolo":
        return toggleSolo(firstTrackId());
      case "delete": {
        if (appState.selection.kind === "clips") {
          const ids = appState.selection.clipIds;
          appState.selection = NO_SELECTION;
          return commit((p) => deleteClips(p, ids));
        }
        if (appState.selection.kind === "range") {
          const r = appState.selection.range;
          return commit((p) => deleteRange(p, r.trackIds, r.fromS, r.toS, cmd.ripple));
        }
        return;
      }
      case "copy":
        return copySelection();
      case "cut":
        return cutSelection();
      case "paste":
        return pasteAtPlayhead(firstTrackId());
      case "duplicate":
        copySelection();
        return pasteAtPlayhead(firstTrackId());
      case "undo":
        return undoEdit();
      case "redo":
        return redoEdit();
      case "save":
        return onSave();
      case "nudge": {
        if (appState.selection.kind === "clips") {
          const ids = appState.selection.clipIds;
          return commit((p) => moveClips(p, ids, cmd.deltaS, 0));
        }
        return seekTo(appState.playheadS + cmd.deltaS);
      }
      case "jumpEdit": {
        const points = editPoints(appState.project, selectedTrackIds());
        const next =
          cmd.direction === 1
            ? nextEditPoint(points, appState.playheadS)
            : prevEditPoint(points, appState.playheadS);
        return seekTo(next ?? appState.playheadS);
      }
      case "zoom":
        appState.pxPerSecond = Math.min(2000, Math.max(2, appState.pxPerSecond * cmd.factor));
        return;
      case "zoomFit": {
        const dur = projectDurationS(appState.project);
        appState.scrollS = 0;
        appState.pxPerSecond = dur > 0 ? Math.max(2, (viewportWidthPx - 24) / dur) : 60;
        return;
      }
    }
  }
</script>

<svelte:window onkeydown={onKeyDown} />
```

- [ ] **Step 5: Mount it in `src/App.svelte`**

```svelte
<KeyboardShortcuts onSave={() => {}} viewportWidthPx={timelineWidth} />
```
(`onSave` gets its real implementation in Task 28.)

- [ ] **Step 6: Manual verification**

Run `npm run dev` and confirm every row of the spec's keyboard table, plus:
- Typing `s` inside the inspector's number field types the character; it does not split.
- Space inside a rename field types a space; it does not play.
- ⌘Z after a range-ripple delete restores both the deleted audio and the shifted clips in one step.
- ⇧F fits the project to the viewport width.

- [ ] **Step 7: Run tests, verify the build gate, commit**

Run: `npm test && npm run build`
Expected: all pass; 0 errors, 0 warnings.

```bash
git add src/lib/shortcuts.ts src/lib/shortcuts.test.ts src/lib/KeyboardShortcuts.svelte src/App.svelte
git commit -m "feat: keyboard shortcuts"
```

---

### Task 27: Mixdown and export

**The spec's open MP3 question is now answered.** WebCodecs ships no MP3 encoder, but mediabunny publishes an official extension package, **`@mediabunny/mp3-encoder`**, whose `registerMp3Encoder()` installs one. So MP3 is available with no third-party encoder and no separate decision — it is in this task's scope. Everything else routes through mediabunny's `Output` + `AudioBufferSource`, except WAV, which keeps the in-repo encoder from Task 15 because it needs no codec support at all.

**Files:**
- Create: `src/export/mixdown.ts`, `src/export/formats.ts`, `src/export/encode.ts`, `src/lib/ExportDialog.svelte`
- Modify: `src/lib/Toolbar.svelte`
- Test: `src/export/formats.test.ts`

**Interfaces:**
- Consumes: `planSchedule` from `../audio/schedule`; `renderPlan` from `../audio/render`; `SourcePool` from `../audio/pool`; `encodeWav` from `./wav`; `PROJECT_SAMPLE_RATE`, `projectDurationS` from `../doc/document`
- Produces:
  - `exportWindow(project, selection): { fromS: number; toS: number }` — the range selection if there is one, else the whole project
  - `exportFilename(projectName: string, ext: string): string`
  - `mixdown(project, pool, fromS, toS): Promise<AudioBuffer>` — always with an EMPTY solo set
  - `type ExportFormat = "wav16" | "wav32" | "mp3" | "m4a" | "webm"`
  - `availableFormats(): Promise<ExportFormat[]>`
  - `encodeBuffer(buffer: AudioBuffer, format: ExportFormat): Promise<Blob>`

- [ ] **Step 1: Write the failing test**

`src/export/formats.test.ts`:
```ts
import { beforeEach, describe, expect, it } from "vitest";
import { __resetIds, createProject } from "../doc/document";
import { addClip, makeClip } from "../doc/edits";
import { NO_SELECTION } from "../doc/selection";
import { exportFilename, exportWindow } from "./formats";

beforeEach(() => __resetIds());

describe("exportWindow", () => {
  it("covers the whole project when nothing is selected", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 2, 5));
    expect(exportWindow(p, NO_SELECTION)).toEqual({ fromS: 0, toS: 7 });
  });

  it("uses the time-range selection when there is one", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 20));
    const selection = {
      kind: "range" as const,
      range: { fromS: 3, toS: 8, trackIds: [p.tracks[0].id] },
    };
    expect(exportWindow(p, selection)).toEqual({ fromS: 3, toS: 8 });
  });

  it("ignores a CLIP selection — that is not a time range", () => {
    const base = createProject();
    const p = addClip(base, base.tracks[0].id, makeClip("s", 0, 20));
    const selection = { kind: "clips" as const, clipIds: [p.tracks[0].clips[0].id] };
    expect(exportWindow(p, selection)).toEqual({ fromS: 0, toS: 20 });
  });

  it("is an empty window for an empty project", () => {
    expect(exportWindow(createProject(), NO_SELECTION)).toEqual({ fromS: 0, toS: 0 });
  });
});

describe("exportFilename", () => {
  it("uses the project name and the format extension", () => {
    expect(exportFilename("My Mix", "wav")).toBe("My Mix.wav");
  });

  it("strips characters that are illegal in filenames", () => {
    expect(exportFilename('a/b:c*?"<>|d', "wav")).toBe("a-b-c------d.wav");
  });

  it("falls back to a default for a blank name", () => {
    expect(exportFilename("   ", "m4a")).toBe("Untitled.m4a");
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/export/formats.test.ts`
Expected: FAIL — `Failed to resolve import "./formats"`.

- [ ] **Step 3: Write `src/export/formats.ts`**

```ts
import { projectDurationS, type Project } from "../doc/document";
import type { Selection } from "../doc/selection";

export type ExportFormat = "wav16" | "wav32" | "mp3" | "m4a" | "webm";

export const FORMAT_LABELS: Record<ExportFormat, string> = {
  wav16: "WAV — 16-bit",
  wav32: "WAV — 32-bit float",
  mp3: "MP3 — 192 kbps",
  m4a: "M4A — AAC",
  webm: "WebM — Opus",
};

export const FORMAT_EXT: Record<ExportFormat, string> = {
  wav16: "wav", wav32: "wav", mp3: "mp3", m4a: "m4a", webm: "webm",
};

export const FORMAT_MIME: Record<ExportFormat, string> = {
  wav16: "audio/wav", wav32: "audio/wav",
  mp3: "audio/mpeg", m4a: "audio/mp4", webm: "audio/webm",
};

/** The export range: the time-range selection if there is one, otherwise the whole project.
 *  A CLIP selection is not a time range and does not narrow the export. */
export function exportWindow(p: Project, selection: Selection): { fromS: number; toS: number } {
  if (selection.kind === "range") {
    return { fromS: selection.range.fromS, toS: selection.range.toS };
  }
  return { fromS: 0, toS: projectDurationS(p) };
}

export function exportFilename(projectName: string, ext: string): string {
  const cleaned = projectName.replace(/[/\\:*?"<>|]/g, "-").trim();
  return `${cleaned || "Untitled"}.${ext}`;
}
```

- [ ] **Step 4: Write `src/export/mixdown.ts`**

```ts
import { PROJECT_SAMPLE_RATE, type Project } from "../doc/document";
import type { SourcePool } from "../audio/pool";
import { renderPlan } from "../audio/render";
import { planSchedule } from "../audio/schedule";

/** Solo is monitoring, never a document field, and MUST NOT reach an export. Passing this frozen
 *  empty set is the enforcement, not a convention a caller has to remember. */
const NO_SOLO: ReadonlySet<string> = new Set();

/**
 * Render `[fromS, toS)` to one stereo 48 kHz buffer.
 *
 * The plan and the graph builder are the SAME ones live playback uses — only the context differs.
 * That is what makes the exported file match what you heard.
 */
export async function mixdown(
  project: Project,
  pool: SourcePool,
  fromS: number,
  toS: number,
): Promise<AudioBuffer> {
  const lengthS = Math.max(0, toS - fromS);
  const ctx = new OfflineAudioContext(
    2,
    Math.max(1, Math.ceil(lengthS * PROJECT_SAMPLE_RATE)),
    PROJECT_SAMPLE_RATE,
  );
  renderPlan(ctx, planSchedule(project, fromS, toS, NO_SOLO), pool, project, 0);
  return ctx.startRendering();
}
```

- [ ] **Step 5: Write `src/export/encode.ts`**

```ts
import {
  AudioBufferSource, BufferTarget, Mp3OutputFormat, Mp4OutputFormat, Output, WebMOutputFormat,
} from "mediabunny";
import { registerMp3Encoder } from "@mediabunny/mp3-encoder";
import { FORMAT_MIME, type ExportFormat } from "./formats";
import { encodeWav } from "./wav";

// WebCodecs has no MP3 encoder; mediabunny's official extension package supplies one. Registering
// at module load is idempotent and costs nothing when MP3 is never exported.
registerMp3Encoder();

const EXPORT_BITRATE = 192_000;

type MediabunnyFormat = Exclude<ExportFormat, "wav16" | "wav32">;

const CONTAINERS: Record<MediabunnyFormat, { format: () => ConstructorParameters<typeof Output>[0]["format"]; codec: string }> = {
  mp3: { format: () => new Mp3OutputFormat(), codec: "mp3" },
  m4a: { format: () => new Mp4OutputFormat(), codec: "aac" },
  webm: { format: () => new WebMOutputFormat(), codec: "opus" },
};

function channelsOf(buffer: AudioBuffer): Float32Array[] {
  const out: Float32Array[] = [];
  for (let c = 0; c < buffer.numberOfChannels; c++) out.push(buffer.getChannelData(c));
  return out;
}

/** Only offer what this browser can actually produce — a format that is listed and then fails is
 *  worse than one that was never listed. The two WAV entries are always present: they use the
 *  in-repo encoder and need no codec support at all. */
export async function availableFormats(): Promise<ExportFormat[]> {
  const formats: ExportFormat[] = ["wav16", "wav32"];
  for (const key of ["mp3", "m4a", "webm"] as MediabunnyFormat[]) {
    if (await canEncode(CONTAINERS[key].codec)) formats.push(key);
  }
  return formats;
}

async function canEncode(codec: string): Promise<boolean> {
  try {
    const mb = (await import("mediabunny")) as unknown as {
      canEncodeAudio?: (c: string, o?: unknown) => Promise<boolean>;
    };
    if (mb.canEncodeAudio) {
      return await mb.canEncodeAudio(codec, { numberOfChannels: 2, sampleRate: 48000 });
    }
  } catch {
    // fall through to the WebCodecs probe
  }
  if (typeof AudioEncoder === "undefined") return false;
  const webCodecsName: Record<string, string> = { aac: "mp4a.40.2", opus: "opus", mp3: "mp3" };
  try {
    const r = await AudioEncoder.isConfigSupported({
      codec: webCodecsName[codec] ?? codec,
      sampleRate: 48000,
      numberOfChannels: 2,
      bitrate: EXPORT_BITRATE,
    });
    return r.supported === true;
  } catch {
    return false;
  }
}

export async function encodeBuffer(buffer: AudioBuffer, format: ExportFormat): Promise<Blob> {
  if (format === "wav16" || format === "wav32") {
    const bits = format === "wav16" ? 16 : 32;
    return new Blob([encodeWav(channelsOf(buffer), buffer.sampleRate, bits)], {
      type: FORMAT_MIME[format],
    });
  }

  const spec = CONTAINERS[format];
  const output = new Output({ format: spec.format(), target: new BufferTarget() });
  const source = new AudioBufferSource({ codec: spec.codec, bitrate: EXPORT_BITRATE });
  output.addAudioTrack(source);
  await output.start();
  await source.add(buffer);
  source.close();
  await output.finalize();

  const bytes = (output.target as BufferTarget).buffer;
  if (!bytes) throw new Error(`${format} export produced no data`);
  return new Blob([bytes], { type: FORMAT_MIME[format] });
}
```

**Verify against the installed version's types before moving on.** The call sequence above
(`addAudioTrack` → `start()` → `add()` → `close()` → `finalize()`) and the codec strings
(`"mp3"`, `"aac"`, `"opus"`) come from mediabunny's documentation; the `canEncodeAudio` probe is
behind a dynamic-import guard precisely because its presence varies by version. If the installed
types disagree, follow the types — and say so in the task's review rather than working around it.

- [ ] **Step 6: Write `src/lib/ExportDialog.svelte`**

```svelte
<script lang="ts">
  import { encodeBuffer, availableFormats } from "../export/encode";
  import {
    exportFilename, exportWindow, FORMAT_EXT, FORMAT_LABELS, type ExportFormat,
  } from "../export/formats";
  import { mixdown } from "../export/mixdown";
  import { pool, state as appState } from "../state/appState.svelte";
  import { formatTime } from "./geometry";

  const { onClose }: { onClose: () => void } = $props();

  let formats = $state<ExportFormat[]>(["wav16", "wav32"]);
  let format = $state<ExportFormat>("wav16");
  let busy = $state(false);
  let error = $state<string | null>(null);

  $effect(() => {
    void availableFormats().then((f) => (formats = f));
  });

  const range = $derived(exportWindow(appState.project, appState.selection));
  const isSelection = $derived(appState.selection.kind === "range");

  async function run() {
    busy = true;
    error = null;
    try {
      const buffer = await mixdown(appState.project, pool, range.fromS, range.toS);
      const blob = await encodeBuffer(buffer, format);
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = exportFilename(appState.project.name, FORMAT_EXT[format]);
      a.click();
      URL.revokeObjectURL(url);
      onClose();
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    } finally {
      busy = false;
    }
  }
</script>

<div class="fixed inset-0 z-50 flex items-center justify-center bg-black/60">
  <div class="w-96 rounded bg-neutral-800 p-4 text-sm text-neutral-200">
    <h2 class="mb-3 font-medium">Export mix</h2>

    <p class="mb-3 text-xs text-neutral-400">
      {#if isSelection}
        Selection — {formatTime(range.fromS)} to {formatTime(range.toS)}
      {:else}
        Whole project — {formatTime(range.toS)}
      {/if}
    </p>

    <label class="mb-4 flex items-center gap-2">
      Format
      <select class="flex-1 rounded bg-neutral-700 px-1 py-1" bind:value={format} disabled={busy}>
        {#each formats as f (f)}
          <option value={f}>{FORMAT_LABELS[f]}</option>
        {/each}
      </select>
    </label>

    {#if error}
      <p class="mb-3 text-xs text-red-400">{error}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button class="rounded px-3 py-1 hover:bg-neutral-700" disabled={busy} onclick={onClose}>
        Cancel
      </button>
      <button
        class="rounded bg-sky-600 px-3 py-1 hover:bg-sky-500 disabled:opacity-50"
        disabled={busy || range.toS <= range.fromS}
        onclick={run}
      >
        {busy ? "Rendering…" : "Export"}
      </button>
    </div>
  </div>
</div>
```

- [ ] **Step 7: Add the Export button to `Toolbar.svelte`**

```svelte
<script lang="ts">
  import { Download } from "@lucide/svelte";
  import ExportDialog from "./ExportDialog.svelte";
  let exporting = $state(false);
  // ...existing script
</script>

<button class={BTN} title="Export mix" onclick={() => (exporting = true)}>
  <Download size={16} />
</button>

{#if exporting}
  <ExportDialog onClose={() => (exporting = false)} />
{/if}
```
Place the button just before the master fader block.

- [ ] **Step 8: Manual verification**

Run `npm run dev`, import two files onto two tracks, then confirm:
- Clicking a clip selects it (border brightens); ⌘-click adds a second; clicking empty lane clears.
- Dragging a clip body moves it; dropping it onto another clip trims/splits that clip rather than overlapping it.
- Dragging vertically moves the clip between tracks.
- Dragging the left edge trims the head — **and the audio under the untouched part does not shift**. Verify by putting the playhead on a recognisable word, then head-trimming: the word stays put.
- Dragging the right edge trims the tail and refuses to extend past the source's end.
- Dragging the top-left corner draws a growing fade-in triangle; top-right does the fade-out.
- Snapping pulls a dragged clip to neighbouring clip edges and the playhead; holding **Shift** disables it.
- Dragging on empty lane area draws a blue range band; dragging up or down extends it across tracks.
- One drag = one undo step (⌘Z after a drag returns the clip to exactly where it started).

- [ ] **Step 9: Run tests, verify the build gate, commit**

Run: `npm test && npm run build`
Expected: all pass; 0 errors, 0 warnings.

```bash
git add src/lib/hit-test.ts src/lib/hit-test.test.ts src/lib/clip-drag.svelte.ts \
        src/lib/ClipView.svelte src/lib/TrackLane.svelte src/lib/RangeOverlay.svelte src/App.svelte
git commit -m "feat: clip select, move, trim, fade handles and range selection"
```

---


---

### Task 28: Project files, autosave and preferences

**Files:**
- Create: `src/persist/autosave.ts`, `src/persist/preferences.ts`, `src/persist/project-io.svelte.ts`
- Modify: `src/state/appState.svelte.ts`, `src/lib/Toolbar.svelte`, `src/App.svelte`
- Test: `src/persist/preferences.test.ts`

**Interfaces:**
- Consumes: `packProject`, `unpackProject`, `PROJECT_FILE_EXT`, `ProjectFileError` from `./project-file`; `pool`, `state as appState` from `../state/appState.svelte`; `decodeSource` from `../audio/pool`
- Produces:
  - `saveProjectFile(): void` — pack and download
  - `openProjectFile(file: File): Promise<void>` — unpack, clear the pool, re-decode every source, replace the document
  - `initAutosave(): void` — writes source bytes ONCE on import, the document on a 3 s debounce
  - `restoreAutosave(): Promise<boolean>`
  - `loadPreferences(): Preferences`, `savePreferences(p: Preferences): void`
  - `interface Preferences { pxPerSecond: number; snap: boolean; trackHeightPx: number; lastFormat: string }`
  - `sanitisePreferences(raw: unknown): Preferences`

- [ ] **Step 1: Write the failing test**

`src/persist/preferences.test.ts`:
```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PREFERENCES, sanitisePreferences } from "./preferences";

describe("sanitisePreferences", () => {
  it("returns defaults for junk", () => {
    expect(sanitisePreferences(null)).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences("nope")).toEqual(DEFAULT_PREFERENCES);
    expect(sanitisePreferences({})).toEqual(DEFAULT_PREFERENCES);
  });

  it("keeps valid values", () => {
    const p = sanitisePreferences({
      pxPerSecond: 120, snap: false, trackHeightPx: 64, lastFormat: "m4a",
    });
    expect(p).toEqual({ pxPerSecond: 120, snap: false, trackHeightPx: 64, lastFormat: "m4a" });
  });

  it("clamps out-of-range numbers rather than trusting them", () => {
    expect(sanitisePreferences({ pxPerSecond: 1e9 }).pxPerSecond).toBe(2000);
    expect(sanitisePreferences({ pxPerSecond: -5 }).pxPerSecond).toBe(2);
    expect(sanitisePreferences({ trackHeightPx: 5 }).trackHeightPx).toBe(40);
  });

  it("ignores fields of the wrong type", () => {
    expect(sanitisePreferences({ snap: "yes" }).snap).toBe(DEFAULT_PREFERENCES.snap);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/persist/preferences.test.ts`
Expected: FAIL — `Failed to resolve import "./preferences"`.

- [ ] **Step 3: Write `src/persist/preferences.ts`**

```ts
const KEY = "slop-audio-editor.prefs";

export interface Preferences {
  pxPerSecond: number;
  snap: boolean;
  trackHeightPx: number;
  lastFormat: string;
}

export const DEFAULT_PREFERENCES: Preferences = {
  pxPerSecond: 60,
  snap: true,
  trackHeightPx: 88,
  lastFormat: "wav16",
};

function clamp(v: unknown, lo: number, hi: number, fallback: number): number {
  return typeof v === "number" && Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : fallback;
}

/** localStorage is user-writable and survives across app versions, so nothing from it is trusted. */
export function sanitisePreferences(raw: unknown): Preferences {
  const r = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    pxPerSecond: clamp(r.pxPerSecond, 2, 2000, DEFAULT_PREFERENCES.pxPerSecond),
    snap: typeof r.snap === "boolean" ? r.snap : DEFAULT_PREFERENCES.snap,
    trackHeightPx: clamp(r.trackHeightPx, 40, 300, DEFAULT_PREFERENCES.trackHeightPx),
    lastFormat:
      typeof r.lastFormat === "string" ? r.lastFormat : DEFAULT_PREFERENCES.lastFormat,
  };
}

export function loadPreferences(): Preferences {
  try {
    return sanitisePreferences(JSON.parse(localStorage.getItem(KEY) ?? "null"));
  } catch {
    return DEFAULT_PREFERENCES;
  }
}

export function savePreferences(p: Preferences): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    // Private browsing or a full quota — preferences are a convenience, never a hard failure.
  }
}
```

- [ ] **Step 4: Write `src/persist/autosave.ts`**

```ts
import type { Project } from "../doc/document";
import type { SourceRecord } from "./project-file";

const DB_NAME = "slop-audio-editor";
const DB_VERSION = 1;
const DOC_STORE = "doc";
const SRC_STORE = "sources";
const DEBOUNCE_MS = 3000;

function open(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(DOC_STORE)) db.createObjectStore(DOC_STORE);
      if (!db.objectStoreNames.contains(SRC_STORE)) db.createObjectStore(SRC_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(db: IDBDatabase, store: string, mode: IDBTransactionMode): IDBObjectStore {
  return db.transaction(store, mode).objectStore(store);
}

/** Source bytes are IMMUTABLE and can be hundreds of megabytes, so they are written exactly once,
 *  on import. Only the document — kilobytes — is written on the debounce. Conflating the two
 *  would rewrite the whole media pool every few seconds. */
export async function putSource(record: SourceRecord): Promise<void> {
  const db = await open();
  tx(db, SRC_STORE, "readwrite").put({ name: record.name, bytes: record.bytes }, record.id);
}

let timer: ReturnType<typeof setTimeout> | null = null;

/** `project` must ALREADY be a plain snapshot — this is a `.ts` module, so `$state.snapshot` is
 *  not available here, and IndexedDB cannot structured-clone a `$state` proxy. The caller in
 *  `appState.svelte.ts` takes the snapshot. */
export function scheduleDocumentSave(project: Project): void {
  if (timer !== null) clearTimeout(timer);
  timer = setTimeout(async () => {
    timer = null;
    const db = await open();
    tx(db, DOC_STORE, "readwrite").put(project, "project");
  }, DEBOUNCE_MS);
}

export async function readAutosave(): Promise<{ project: Project; sources: SourceRecord[] } | null> {
  const db = await open();
  const project = await new Promise<Project | undefined>((resolve) => {
    const r = tx(db, DOC_STORE, "readonly").get("project");
    r.onsuccess = () => resolve(r.result as Project | undefined);
    r.onerror = () => resolve(undefined);
  });
  if (!project) return null;

  const sources = await new Promise<SourceRecord[]>((resolve) => {
    const store = tx(db, SRC_STORE, "readonly");
    const out: SourceRecord[] = [];
    const cursor = store.openCursor();
    cursor.onsuccess = () => {
      const c = cursor.result;
      if (!c) return resolve(out);
      const v = c.value as { name: string; bytes: Uint8Array };
      out.push({ id: String(c.key), name: v.name, bytes: v.bytes });
      c.continue();
    };
    cursor.onerror = () => resolve(out);
  });
  return { project, sources };
}

export async function clearAutosave(): Promise<void> {
  const db = await open();
  tx(db, DOC_STORE, "readwrite").clear();
  tx(db, SRC_STORE, "readwrite").clear();
}
```

- [ ] **Step 5: Write `src/persist/project-io.svelte.ts`**

The `.svelte.ts` extension is required, not cosmetic: this module reads the store and calls
`$state.snapshot`, neither of which is legal in a plain `.ts` file.

```ts
import { decodeSource } from "../audio/pool";
import { pool, state as appState } from "../state/appState.svelte";
import { clearAutosave, putSource, readAutosave } from "./autosave";
import {
  PROJECT_FILE_EXT, ProjectFileError, packProject, unpackProject, type SourceRecord,
} from "./project-file";
import { exportFilename } from "../export/formats";

function download(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function saveProjectFile(): void {
  const bytes = packProject($state.snapshot(appState.project), pool.records());
  download(
    new Blob([bytes], { type: "application/zip" }),
    exportFilename(appState.project.name, PROJECT_FILE_EXT.slice(1)),
  );
  appState.dirty = false;
}

/** Replace everything: clear the pool, re-decode every embedded source, install the document. */
async function loadInto(project: typeof appState.project, sources: SourceRecord[]): Promise<void> {
  pool.clear();
  for (const s of sources) {
    appState.importing = { name: s.name, fraction: 0 };
    try {
      pool.add(await decodeSource(s.id, s.name, s.bytes, (f) => {
        appState.importing = { name: s.name, fraction: f };
      }));
    } finally {
      appState.importing = null;
    }
  }
  appState.project = project;
  appState.dirty = false;
}

export async function openProjectFile(file: File): Promise<void> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { project, sources } = unpackProject(bytes); // throws ProjectFileError, surfaced by caller
  await clearAutosave();
  await loadInto(project, sources);
  for (const s of sources) await putSource(s);
}

export async function restoreAutosave(): Promise<boolean> {
  const saved = await readAutosave();
  if (!saved) return false;
  await loadInto(saved.project, saved.sources);
  return true;
}

export { ProjectFileError };
```

- [ ] **Step 6: Wire persistence into the store and the UI**

In `src/state/appState.svelte.ts`, add the imports and the two effects:

```ts
import { putSource, scheduleDocumentSave } from "../persist/autosave";
import { loadPreferences, savePreferences } from "../persist/preferences";

// Applied at module init, before any component reads the store.
const prefs = loadPreferences();
// ...inside the $state({...}) initialiser, replace the literals with:
//   pxPerSecond: prefs.pxPerSecond,
//   snap: prefs.snap,
//   trackHeightPx: prefs.trackHeightPx,

// Module-scope effects need their own root — there is no component owner here.
$effect.root(() => {
  // The document is kilobytes, so a 3 s debounce is free. `$state.snapshot` is essential:
  // IndexedDB cannot structured-clone a $state proxy.
  $effect(() => {
    scheduleDocumentSave($state.snapshot(state.project));
  });

  $effect(() => {
    savePreferences({
      pxPerSecond: state.pxPerSecond,
      snap: state.snap,
      trackHeightPx: state.trackHeightPx,
      lastFormat: prefs.lastFormat,
    });
  });
});
```

and in `importFiles`, immediately after `pool.add(source)`:

```ts
      // Source bytes are immutable and large — written ONCE here, never on the document debounce.
      void putSource({ id: source.id, name: source.name, bytes: source.bytes });
```

In `src/App.svelte`, add restore, drag-and-drop and the import indicator:

```svelte
<script lang="ts">
  import { PROJECT_FILE_EXT } from "./persist/project-file";
  import { openProjectFile, restoreAutosave, saveProjectFile } from "./persist/project-io.svelte";
  import { importFiles, state as appState } from "./state/appState.svelte";

  let loadError = $state<string | null>(null);

  $effect(() => {
    void restoreAutosave();
  });

  async function onDrop(e: DragEvent) {
    e.preventDefault();
    const files = Array.from(e.dataTransfer?.files ?? []);
    if (files.length === 0) return;
    const projectFile = files.find((f) => f.name.endsWith(PROJECT_FILE_EXT));
    try {
      if (projectFile) await openProjectFile(projectFile);
      else await importFiles(files, appState.project.tracks[0].id, appState.playheadS);
    } catch (err) {
      loadError = err instanceof Error ? err.message : String(err);
    }
  }
</script>
```

on the root `<div>`: `ondragover={(e) => e.preventDefault()} ondrop={onDrop}`, and just inside it:

```svelte
{#if appState.importing}
  <div class="absolute inset-x-0 top-0 z-50 bg-sky-700 px-2 py-1 text-xs">
    Loading {appState.importing.name} — {Math.round(appState.importing.fraction * 100)}%
  </div>
{/if}
{#if loadError}
  <button
    class="absolute inset-x-0 top-0 z-50 bg-red-800 px-2 py-1 text-left text-xs"
    onclick={() => (loadError = null)}
  >
    {loadError} — click to dismiss
  </button>
{/if}
```

Pass the real handler to the shortcuts component: `<KeyboardShortcuts onSave={saveProjectFile} ... />`.

In `src/lib/Toolbar.svelte`, add a File group before Import:

```svelte
<script lang="ts">
  import { FilePlus2, FolderOpen, Save } from "@lucide/svelte";
  import { createProject } from "../doc/document";
  import { openProjectFile, saveProjectFile } from "../persist/project-io.svelte";
  import { commit } from "../state/appState.svelte";

  let projectInput = $state<HTMLInputElement | null>(null);
  let fileError = $state<string | null>(null);
</script>

<button class={BTN} title="New project" onclick={() => commit(() => createProject())}>
  <FilePlus2 size={16} />
</button>
<button class={BTN} title="Open project" onclick={() => projectInput?.click()}>
  <FolderOpen size={16} />
</button>
<button class={BTN} title="Save project (⌘S)" onclick={saveProjectFile}>
  <Save size={16} />
  {#if appState.dirty}<span class="ml-0.5 text-sky-400">•</span>{/if}
</button>
<input
  bind:this={projectInput}
  type="file"
  accept=".slopaudio,application/zip"
  class="hidden"
  onchange={async (e) => {
    const f = e.currentTarget.files?.[0];
    e.currentTarget.value = "";
    if (!f) return;
    try {
      await openProjectFile(f);
    } catch (err) {
      fileError = err instanceof Error ? err.message : String(err);
    }
  }}
/>
{#if fileError}
  <span class="text-xs text-red-400">{fileError}</span>
{/if}
```

A corrupt or future-version file must surface `ProjectFileError.message` as visible text — never
only a console trace, and never a half-loaded project.

- [ ] **Step 7: Manual verification**

- Import two files, edit, reload the page: the project comes back with waveforms intact.
- Save a project file, reload, open it: identical result. Check the zip's size is close to the sum of the imported files, not ten times it.
- Open a project file saved with `version` hand-edited to `99`: a readable message appears, and the current project is untouched.
- Drag a `.slopaudio` onto the window: it opens. Drag an mp3: it imports.
- Zoom, toggle snap, reload: the view settings persist.
- Watch the network/disk while idling with a large project: the debounced save must not be writing source bytes repeatedly.

- [ ] **Step 8: Run tests, verify the build gate, commit**

Run: `npm test && npm run build`

```bash
git add src/persist/ src/state/appState.svelte.ts src/lib/Toolbar.svelte src/App.svelte
git commit -m "feat: project files, autosave and preferences"
```

---

### Task 29: README, deploy and final verification

**Files:**
- Modify: `README.md`
- Create: `CLAUDE.md`
- Test: the whole suite

- [ ] **Step 1: Update `README.md`** to describe what the app actually does — features, keyboard table, export formats (WAV always; MP3, M4A and WebM where the browser supports the encoder), the browser requirement, and the project-file format. Include the current test count from `npm test` output rather than guessing it.

- [ ] **Step 2: Write `CLAUDE.md`** as the handoff index, following slop-animator's shape: commands, the development workflow, an architecture map pointing at `src/doc/`, `src/audio/`, `src/state/`, `src/export/`, `src/persist/`, `src/lib/`, and a **Gotchas** section seeded with the ones this plan already knows:
  1. Solo is view state and `mixdown` passes an empty solo set — never move solo into the document.
  2. `trimClipStart` moves `startS` and `inS` by the same clamped delta; changing one without the other silently re-syncs clips.
  3. `planSchedule` is shared by preview and export; any playback-only special case belongs in `renderPlan`'s caller, not in the plan.
  4. `soloed` must be a `SvelteSet`; a plain `Set` is not reactive in runes mode.
  5. A component using the `$state` rune must import the store as `state as appState`.
  6. Autosave writes source bytes once on import, never on the document debounce.

- [ ] **Step 3: Full verification**

Run: `npm test && npm run build`
Expected: every test passes; 0 errors, 0 warnings. Record the test count.

- [ ] **Step 4: End-to-end acceptance pass**

Do a real edit, start to finish, and confirm each step works:
1. Import a narration take and a music bed onto two tracks.
2. Cut a flub out of the narration with a time range + ripple; the bed does not move.
3. Trim the head of a take; the surviving audio does not shift.
4. Copy a section and paste it later on the same track.
5. Fade the bed in and out; ride its fader under the narration during playback.
6. Solo the narration to check it, then unsolo.
7. Export a WAV; confirm both tracks are present and the fades are audible.
8. Save the project, reload the page, open it, and confirm it is byte-identical in behaviour.

Then check the spec's two open performance risks, and record the numbers in the task's review:
- **Node count.** Split a long clip into ~300 pieces (repeated `S` at moving playhead positions),
  then play from the start. If playback stutters or the audio glitches, say so — that is the
  trigger for the look-ahead scheduler noted in spec §6, and it is a follow-up, not a fix to
  improvise here.
- **Peak resolution.** Zoom to a single spoken word. If the waveform is visibly blocky rather than
  merely smooth, note it — spec §13's second peak level is the follow-up.

- [ ] **Step 5: Deploy**

Run: `npm run deploy`
Expected: the build gate passes, then wrangler uploads. Open the deployed URL and repeat steps 1 and 7 of the acceptance pass against it.

- [ ] **Step 6: Commit**

```bash
git add README.md CLAUDE.md
git commit -m "docs: README and CLAUDE.md handoff"
```
