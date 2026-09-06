<script lang="ts">
  import { encodeBuffer, availableFormats } from "../export/encode";
  import {
    exportFilename,
    exportWindow,
    FORMAT_EXT,
    FORMAT_LABELS,
    type ExportFormat,
  } from "../export/formats";
  import { measureMix, normaliseBuffer, NORMALISE_TARGETS } from "../export/normalise";
  import { limitBuffer } from "../export/limiter";
  import { mixdown } from "../export/mixdown";
  import { liveRange } from "../doc/selection";
  import { pool, state as appState } from "../state/appState.svelte";
  import { formatTime } from "./geometry";

  const { onClose }: { onClose: () => void } = $props();

  let formats = $state<ExportFormat[]>(["wav16", "wav32"]);
  let format = $state<ExportFormat>(appState.lastFormat);
  let busy = $state(false);
  let error = $state<string | null>(null);
  /** The rendered mix, kept between the level check and the actual write so acknowledging an over
   *  does not pay for a second render. Format is an ENCODING choice and does not affect these
   *  samples, so a format change keeps it — but ANY document edit invalidates it (see the effect
   *  below). Modality is not enough to make retention safe: keyboard shortcuts still reach the
   *  document behind the overlay, and a stale buffer would report a peak for a mix that no longer
   *  exists — then write that stale audio to the file. */
  let rendered: AudioBuffer | null = null;
  let peakDb = $state<number | null>(null);
  let acknowledgedOver = $state(false);
  /** What the last render actually measured, once normalisation has been applied. */
  let achievedLufs = $state<number | null>(null);
  let fellShort = $state(false);

  /** 32-bit float WAV stores values above 1.0 unchanged, so an over is not clipping there — it is
   *  only a problem once something quantises it. Every other format we write does. */
  const clipsAtWrite = $derived(peakDb !== null && peakDb > 0 && format !== "wav32");

  $effect(() => {
    void availableFormats()
      .then((f) => (formats = f))
      .catch(() => {
        // The encoder module failed to load (blocked chunk, offline, bad cache). WAV needs no
        // codec support and is unaffected, so degrade to it rather than failing the dialog — but
        // say why, or the missing formats look like a bug in the app.
        formats = ["wav16", "wav32"];
        format = "wav16";
        error = "Could not load the extra encoders; WAV export is still available.";
      });
  });

  // Any edit to the document invalidates the rendered mix and everything measured from it.
  $effect(() => {
    // Reading it IS the subscription — this effect exists to re-run on any document edit, so the
    // bare read is the point rather than a leftover. ESLint cannot know that.
    // eslint-disable-next-line @typescript-eslint/no-unused-expressions
    appState.project;
    rendered = null;
    peakDb = null;
    acknowledgedOver = false;
  });

  /** Opt-in, and session-only. A limiter CHANGES THE DYNAMICS, which is exactly why
   *  normalisation refuses to include one — the difference is that this is a box you tick. */
  let limit = $state(false);
  let reductionDb = $state<number | null>(null);

  const range = $derived(exportWindow(appState.project, appState.selection));
  // The same test `exportWindow` makes, or the label could say "Selection" over a whole-project
  // window when the selected range's track has been deleted.
  const isSelection = $derived(liveRange(appState.project, appState.selection) !== null);

  async function run() {
    busy = true;
    error = null;
    try {
      rendered ??= await mixdown(appState.project, pool, range.fromS, range.toS);
      // Normalisation is applied to the RENDERED BUFFER, never to the node graph: the graph is
      // shared by preview and export, and a gain stage in it would make the two drift.
      const target = appState.normaliseLufs;
      if (target !== null) {
        // Gain, then limit, then measure again — repeatedly, because limiting lowers loudness and
        // one pass always undershoots the target.
        const r = normaliseBuffer(rendered, target, limit);
        achievedLufs = Number.isFinite(r.achievedLufs) ? r.achievedLufs : null;
        fellShort = r.limitedByPeak;
        reductionDb = limit ? r.reductionDb : null;
      } else {
        achievedLufs = null;
        fellShort = false;
        // Limiting with no loudness target is still meaningful: it caps peaks and nothing else.
        reductionDb = limit ? limitBuffer(rendered).maxReductionDb : null;
      }
      peakDb = measureMix(rendered).peakDbfs;
      // Stop on an over rather than silently writing a clipped file. The buffer is kept, so
      // confirming costs only the encode.
      if (peakDb > 0 && format !== "wav32" && !acknowledgedOver) {
        acknowledgedOver = true;
        busy = false;
        return;
      }
      const blob = await encodeBuffer(rendered, format);
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
  <div class="w-96 rounded bg-panel p-4 text-sm text-text">
    <h2 class="mb-3 font-medium">Export mix</h2>

    <p class="mb-3 text-xs text-muted">
      {#if isSelection}
        Selection — {formatTime(range.fromS)} to {formatTime(range.toS)}
      {:else}
        Whole project — {formatTime(range.toS)}
      {/if}
    </p>

    <label class="mb-4 flex items-center gap-2">
      Format
      <select
        class="flex-1 rounded bg-raised p-1"
        bind:value={format}
        disabled={busy}
        onchange={(e) => {
          acknowledgedOver = false;
          appState.lastFormat = e.currentTarget.value as ExportFormat;
        }}
      >
        {#each formats as f (f)}
          <option value={f}>{FORMAT_LABELS[f]}</option>
        {/each}
      </select>
    </label>

    <label class="mb-3 flex items-center gap-2">
      Loudness
      <select
        class="flex-1 rounded bg-raised p-1"
        disabled={busy}
        value={String(appState.normaliseLufs)}
        onchange={(e) => {
          const v = e.currentTarget.value;
          appState.normaliseLufs = v === "null" ? null : Number(v);
          // The measured figures describe the PREVIOUS settings; drop them rather than show a
          // number that no longer matches what the next click will produce.
          rendered = null;
          peakDb = null;
          achievedLufs = null;
          acknowledgedOver = false;
        }}
      >
        {#each NORMALISE_TARGETS as t (t.label)}
          <option value={String(t.lufs)}>{t.label}</option>
        {/each}
      </select>
    </label>

    <label
      class="mb-3 flex items-center gap-2 text-xs"
      title="Brick-wall limiter on the finished mix, so a loudness target can be reached instead of falling short. It changes the dynamics — that is the trade."
    >
      <input
        type="checkbox"
        checked={limit}
        disabled={busy}
        onchange={(e) => {
          limit = e.currentTarget.checked;
          rendered = null;
          peakDb = null;
          achievedLufs = null;
          reductionDb = null;
          acknowledgedOver = false;
        }}
      />
      Limit peaks
    </label>

    {#if reductionDb !== null}
      <p class="mb-2 text-xs {reductionDb > 6 ? 'text-warn' : 'text-muted'}">
        {reductionDb < 0.01
          ? "Limiter did nothing — nothing reached the ceiling"
          : `Limiter pulled down ${reductionDb.toFixed(1)} dB at its deepest`}
      </p>
    {/if}

    {#if achievedLufs !== null}
      <p class="mb-2 text-xs text-muted">
        Normalised to {achievedLufs.toFixed(1)} LUFS{fellShort
          ? " — as close as the peak ceiling allows"
          : ""}
      </p>
    {/if}

    {#if peakDb !== null}
      <p class="mb-3 text-xs {clipsAtWrite ? 'text-danger' : 'text-muted'}">
        Peak {peakDb === -Infinity ? "silent" : `${peakDb > 0 ? "+" : ""}${peakDb.toFixed(2)} dBFS`}
        {#if clipsAtWrite}
          — will clip. Lower master by {peakDb.toFixed(2)} dB, or export 32-bit float.
        {/if}
      </p>
    {/if}

    {#if error}
      <p class="mb-3 text-xs text-danger">{error}</p>
    {/if}

    <div class="flex justify-end gap-2">
      <button class="rounded px-3 py-1 hover:bg-raised" disabled={busy} onclick={onClose}>
        Cancel
      </button>
      <button
        class="rounded bg-accent px-3 py-1 hover:bg-accent-hover disabled:opacity-50"
        disabled={busy || range.toS <= range.fromS}
        onclick={run}
      >
        {busy ? "Rendering…" : clipsAtWrite ? "Export anyway" : "Export"}
      </button>
    </div>
  </div>
</div>
