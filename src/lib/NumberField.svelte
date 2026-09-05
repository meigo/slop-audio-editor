<script lang="ts">
  import { untrack } from "svelte";

  const {
    label, value, min = 0, suffix = "", title = undefined, disabled = false,
    onCommit,
  }: {
    label: string; value: number; min?: number; suffix?: string; title?: string;
    disabled?: boolean;
    onCommit: (v: number) => void;
  } = $props();

  // `untrack`: we only want the INITIAL value here — the $effect below is what re-syncs `draft`
  // when `value` changes later. Without it, svelte-check flags this as a suspected missing
  // reactive read and the build gate (0 warnings) fails.
  let draft = $state(untrack(() => value.toFixed(2)));

  // Re-sync when the underlying value changes from elsewhere (a drag, an undo).
  $effect(() => {
    draft = value.toFixed(2);
  });

  function commitDraft() {
    // Both blur and Escape land here. Committing what is ALREADY displayed would be a real edit,
    // not a no-op: the field shows `value.toFixed(2)`, so for any value with finer precision than
    // two decimals — which every pointer drag produces — `Number(draft)` differs from `value` by a
    // few milliseconds. `edits.ts`'s `d === 0` and `c.gain === g` guards cannot catch a delta that
    // small-but-nonzero, so it would push an undo entry and, mid-playback, force a reschedule,
    // just for tabbing through the inspector.
    if (draft === value.toFixed(2)) return;
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(Math.max(min, v));
    else draft = value.toFixed(2);
  }
</script>

<!-- `whitespace-nowrap`: without it flex relieves a crowded row by WRAPPING the label, so
     "fade in" silently became two lines instead of the row admitting it was too full. -->
<label
  class="flex shrink-0 items-center gap-1 whitespace-nowrap text-[11px] {disabled
    ? 'text-disabled'
    : 'text-muted'}"
  {title}
>
  {label}
  <!-- `raised`, not `panel`: the toolbar and the inspector ARE panel, so a panel-coloured input
       is invisible against them and the label reads as unrelated to its own value. -->
  <input
    class="h-6 w-14 rounded bg-raised px-1 text-right tabular-nums {disabled
      ? 'text-disabled'
      : 'text-text'}"
    type="text"
    inputmode="decimal"
    {disabled}
    bind:value={draft}
    onblur={commitDraft}
    onkeydown={(e) => {
      if (e.key === "Enter") e.currentTarget.blur();
      if (e.key === "Escape") {
        draft = value.toFixed(2);
        e.currentTarget.blur();
      }
      e.stopPropagation(); // keep the global shortcuts out of a text field
    }}
  />
  {#if suffix}<span class={disabled ? "text-disabled" : "text-muted"}>{suffix}</span>{/if}
</label>
