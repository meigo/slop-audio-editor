<script lang="ts">
  const {
    label,
    amount,
    title,
    onInput,
    onCommit,
  }: {
    label: string;
    amount: number;
    title: string;
    onInput: (amount: number) => void;
    onCommit: () => void;
  } = $props();

  /** NOT bipolar, unlike the EQ bands and the filter: drive has no negative side, so its zero is
   *  at the LEFT end of the travel rather than the middle. It still detents to exactly off, for
   *  the same reason those do — 0.01 of drive is not off, and would keep a waveshaper in the
   *  graph forever. */
  const DETENT = 0.02;
  const snap = (v: number): number => (v <= DETENT ? 0 : v);
</script>

<div class="contents">
  <span class="text-right text-[10px] text-muted">{label}</span>
  <input
    type="range"
    class="slider w-full min-w-0"
    style="--fill-from: 0%; --fill-to: {amount * 100}%"
    {title}
    min={0}
    max={1}
    step="0.01"
    value={amount}
    oninput={(e) => onInput(snap(Number(e.currentTarget.value)))}
    onpointerup={onCommit}
    onpointercancel={onCommit}
    onkeyup={onCommit}
  />
  <span class="w-12 text-right text-[10px] text-muted tabular-nums">
    {amount === 0 ? "off" : `${Math.round(amount * 100)}%`}
  </span>
</div>
