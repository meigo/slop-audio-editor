<script lang="ts">
  import { formatPan } from "./geometry";

  const {
    pan,
    title,
    onInput,
    onCommit,
  }: {
    pan: number;
    title: string;
    onInput: (pan: number) => void;
    onCommit: () => void;
  } = $props();

  /** Snap to dead centre near the middle: a track left at 0.02 is not "centred", so it would keep
   *  five nodes in the graph forever — the same detent the EQ bands and the filter use. */
  const DETENT = 0.03;
  const snap = (p: number): number => (Math.abs(p) <= DETENT ? 0 : p);
  const pct = $derived(((pan + 1) / 2) * 100);
</script>

<div class="contents">
  <span class="text-right text-[10px] text-muted">pan</span>
  <input
    type="range"
    class="slider bipolar w-full min-w-0"
    style="--fill-from: {Math.min(50, pct)}%; --fill-to: {Math.max(50, pct)}%"
    {title}
    min={-1}
    max={1}
    step="0.01"
    value={pan}
    oninput={(e) => onInput(snap(Number(e.currentTarget.value)))}
    onpointerup={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-12 text-right text-[10px] text-muted tabular-nums">{formatPan(pan)}</span>
</div>
