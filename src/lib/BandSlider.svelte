<script lang="ts">
  import { formatSignedDb, snapBandDb } from "./geometry";

  const {
    label, db, maxDb, title, onInput, onCommit,
  }: {
    label: string;
    db: number;
    maxDb: number;
    title: string;
    onInput: (db: number) => void;
    onCommit: () => void;
  } = $props();
</script>

<div class="flex items-center gap-1">
  <span class="w-7 shrink-0 text-right text-[10px] text-muted">{label}</span>
  <!-- Bipolar and centred on flat, unlike the gain Fader: an EQ band cuts as well as boosts, so
       0 dB belongs in the MIDDLE of the travel rather than at 3/4 like unity gain. -->
  <input
    type="range"
    class="h-1 w-20 accent-accent"
    {title}
    min={-maxDb}
    max={maxDb}
    step="0.1"
    value={db}
    oninput={(e) => onInput(snapBandDb(Number(e.currentTarget.value)))}
    onpointerup={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-14 shrink-0 text-right text-[10px] tabular-nums text-muted">
    {formatSignedDb(db)}
  </span>
</div>
