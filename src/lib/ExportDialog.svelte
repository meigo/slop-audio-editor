<script lang="ts">
  import { encodeBuffer, availableFormats } from "../export/encode";
  import {
    exportFilename, exportWindow, FORMAT_EXT, FORMAT_LABELS, type ExportFormat,
  } from "../export/formats";
  import { amplitudeToDbfs, peakAmplitude } from "../audio/peak";
  import { mixdown } from "../export/mixdown";
  import { pool, state as appState } from "../state/appState.svelte";
  import { formatTime } from "./geometry";

  const { onClose }: { onClose: () => void } = $props();

  let formats = $state<ExportFormat[]>(["wav16", "wav32"]);
  let format = $state<ExportFormat>("wav16");
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
    appState.project;
    rendered = null;
    peakDb = null;
    acknowledgedOver = false;
  });

  const range = $derived(exportWindow(appState.project, appState.selection));
  const isSelection = $derived(appState.selection.kind === "range");

  async function run() {
    busy = true;
    error = null;
    try {
      rendered ??= await mixdown(appState.project, pool, range.fromS, range.toS);
      const channels = Array.from({ length: rendered.numberOfChannels }, (_, i) =>
        rendered!.getChannelData(i),
      );
      peakDb = amplitudeToDbfs(peakAmplitude(channels));
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
      <select
        class="flex-1 rounded bg-neutral-700 px-1 py-1"
        bind:value={format}
        disabled={busy}
        onchange={() => (acknowledgedOver = false)}
      >
        {#each formats as f (f)}
          <option value={f}>{FORMAT_LABELS[f]}</option>
        {/each}
      </select>
    </label>

    {#if peakDb !== null}
      <p class="mb-3 text-xs {clipsAtWrite ? 'text-red-400' : 'text-neutral-400'}">
        Peak {peakDb === -Infinity ? "silent" : `${peakDb > 0 ? "+" : ""}${peakDb.toFixed(2)} dBFS`}
        {#if clipsAtWrite}
          — will clip. Lower master by {peakDb.toFixed(2)} dB, or export 32-bit float.
        {/if}
      </p>
    {/if}

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
        {busy ? "Rendering…" : clipsAtWrite ? "Export anyway" : "Export"}
      </button>
    </div>
  </div>
</div>
