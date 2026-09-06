<script lang="ts">
  import type { TrackFilter } from "../doc/document";
  import { filterFromPosition, filterPosition, formatFilter } from "./geometry";

  const {
    filter,
    title,
    onInput,
    onCommit,
  }: {
    filter: TrackFilter;
    title: string;
    onInput: (filter: TrackFilter) => void;
    onCommit: () => void;
  } = $props();

  /** Not a `BandSlider`: that one is in dB and detents to FLAT, this one is in Hz and detents to
   *  BYPASS, and its readout switches units and prefix. Sharing them would mean a component whose
   *  props explain more than the two copies of the markup do. */
  const pct = $derived(((filterPosition(filter) + 1) / 2) * 100);
</script>

<div class="contents">
  <span class="text-right text-[10px] text-muted">filter</span>
  <!-- Bipolar like an EQ band, but the centre means OFF rather than flat: left sweeps a high-pass
       up, right sweeps a low-pass down. -->
  <input
    type="range"
    class="slider bipolar w-full min-w-0"
    style="--fill-from: {Math.min(50, pct)}%; --fill-to: {Math.max(50, pct)}%"
    {title}
    min={-1}
    max={1}
    step="0.001"
    value={filterPosition(filter)}
    oninput={(e) => onInput(filterFromPosition(Number(e.currentTarget.value)))}
    onpointerup={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-12 text-right text-[10px] text-muted tabular-nums">
    {formatFilter(filter)}
  </span>
</div>
