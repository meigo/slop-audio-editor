<script lang="ts">
  import type { Snippet } from "svelte";
  import { clickOutside } from "./click-outside";

  /** `children` receives `close()`, so an item can dismiss the menu after acting. */
  const {
    label, title = undefined, marked = false, markClass = "bg-accent", children,
  }: {
    label: string;
    title?: string;
    /** Draws an out-of-flow dot on the trigger — for state the menu now hides, such as unsaved
     *  changes once Save moved inside it. Out of flow so it cannot move the toolbar. */
    marked?: boolean;
    markClass?: string;
    children: Snippet<[() => void]>;
  } = $props();

  let open = $state(false);
  const close = () => (open = false);
</script>

<div class="relative shrink-0" use:clickOutside={close}>
  <button
    class="flex h-6 items-center gap-1 rounded px-2 text-xs {open
      ? 'bg-raised text-text'
      : 'text-muted hover:bg-raised hover:text-text'}"
    aria-expanded={open}
    {title}
    onclick={() => (open = !open)}
  >
    {label}<span class="text-[9px] opacity-70">▾</span>
    {#if marked}
      <span class="absolute right-0.5 top-0.5 size-1.5 rounded-full {markClass}"></span>
    {/if}
  </button>
  {#if open}
    <div
      class="absolute left-0 top-full z-30 mt-1 min-w-44 rounded border border-line bg-panel py-1
             shadow-lg"
      role="menu"
    >
      {@render children(close)}
    </div>
  {/if}
</div>
