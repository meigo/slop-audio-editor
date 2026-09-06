<script lang="ts">
  import { dbToGain, dbToPosition, formatDb, gainToDb, positionToDb } from "./geometry";

  const {
    gain,
    onInput,
    onCommit,
    label,
  }: {
    gain: number;
    onInput: (g: number) => void;
    onCommit: () => void;
    label: string;
  } = $props();

  const MIN_DB = -60;
  const MAX_DB = 12;
  // The slider itself is driven in POSITION space (0..1) so travel follows the piecewise-linear
  // fader taper (positionToDb/dbToPosition) instead of a straight dB-per-pixel line that buries
  // the useful range near unity in the bottom half — see geometry.ts.
  const UNITY_POSITION = dbToPosition(0);
  const UNITY_DETENT = 0.01;

  /** Below MIN_DB the fader means silence, not a very quiet signal. */
  const db = $derived(gain <= 0 ? MIN_DB : Math.max(MIN_DB, Math.min(MAX_DB, gainToDb(gain))));
  const position = $derived(gain <= 0 ? 0 : dbToPosition(db));
</script>

<div class="flex items-center gap-1">
  <!-- The gesture commits on `pointercancel` as well as `pointerup`: a ride cancelled by an edge
       swipe, palm rejection or a system alert otherwise leaves it open — the live gain is in the
       document but never recorded, so the next unrelated `endGesture` swallows it. Every slider in
       this app does the same. -->
  <input
    type="range"
    class="slider w-24"
    style="--fill-from: 0%; --fill-to: {position * 100}%"
    title={label}
    min={0}
    max={1}
    step="0.001"
    value={position}
    oninput={(e) => {
      const v = Number(e.currentTarget.value);
      if (v <= 0) {
        onInput(0);
        return;
      }
      // Detent at unity: without it, aiming for 0 dB lands on something like -0.3 dB almost every
      // time.
      const targetDb = Math.abs(v - UNITY_POSITION) < UNITY_DETENT ? 0 : positionToDb(v);
      onInput(dbToGain(targetDb));
    }}
    onpointerup={onCommit}
    onpointercancel={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-16 shrink-0 text-right text-[10px] text-muted tabular-nums">
    {formatDb(gain)}
  </span>
</div>
