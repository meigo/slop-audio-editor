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
