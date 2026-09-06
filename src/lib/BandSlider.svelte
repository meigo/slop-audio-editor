<script lang="ts">
  import { formatSignedDb, snapBandDb } from "./geometry";

  const {
    label,
    db,
    maxDb,
    title,
    onInput,
    onCommit,
  }: {
    label: string;
    db: number;
    maxDb: number;
    title: string;
    onInput: (db: number) => void;
    onCommit: () => void;
  } = $props();

  /** The thumb's position as a percentage, so the track can be filled from the CENTRE outward —
   *  a band that cuts should read as filled leftward, not as a track that is merely less full. */
  const pct = $derived(((db + maxDb) / (2 * maxDb)) * 100);
</script>

<!-- `contents`, so the three parts join the PARENT's grid: the slider then fills whatever width
     the panel has been dragged to, and every row's label and readout line up. -->
<div class="contents">
  <span class="text-right text-[10px] text-muted">{label}</span>
  <!-- Bipolar and centred on flat, unlike the gain Fader: an EQ band cuts as well as boosts, so
       0 dB belongs in the MIDDLE of the travel rather than at 3/4 like unity gain. -->
  <input
    type="range"
    class="slider bipolar w-full min-w-0"
    style="--fill-from: {Math.min(50, pct)}%; --fill-to: {Math.max(50, pct)}%"
    {title}
    min={-maxDb}
    max={maxDb}
    step="0.1"
    value={db}
    oninput={(e) => onInput(snapBandDb(Number(e.currentTarget.value)))}
    onpointerup={onCommit}
    onpointercancel={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-12 text-right text-[10px] text-muted tabular-nums">
    {formatSignedDb(db)}
  </span>
</div>
