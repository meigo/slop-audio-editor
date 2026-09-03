<script lang="ts">
  import { untrack } from "svelte";

  const {
    label, value, min = 0, suffix = "",
    onCommit,
  }: {
    label: string; value: number; min?: number; suffix?: string;
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
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(Math.max(min, v));
    else draft = value.toFixed(2);
  }
</script>

<label class="flex items-center gap-1 text-[11px] text-neutral-400">
  {label}
  <input
    class="w-16 rounded bg-neutral-800 px-1 py-0.5 text-right tabular-nums text-neutral-100"
    type="text"
    inputmode="decimal"
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
  {#if suffix}<span class="text-neutral-600">{suffix}</span>{/if}
</label>
