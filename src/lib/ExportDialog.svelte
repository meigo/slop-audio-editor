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
