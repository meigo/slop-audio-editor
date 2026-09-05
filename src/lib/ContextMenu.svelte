<script lang="ts">
  import {
    canPaste,
    cutSelection,
    copySelection,
    deleteSelection,
    duplicateSelection,
    pasteAtPlayhead,
    state as appState,
  } from "../state/appState.svelte";
  import { clickOutside } from "./click-outside";
  import { clampMenuPosition, contextItems, type ContextItem } from "./context-menu";

  const at = $derived(appState.contextMenu);
  const items = $derived(contextItems(appState.selection, canPaste()));

  /** Measured after mount, so the clamp uses the menu's real size rather than a guess that would
   *  drift the moment an item's label changes. */
  let el = $state<HTMLElement | null>(null);
  let size = $state({ width: 160, height: 180 });
  $effect(() => {
    if (!el) return;
    const r = el.getBoundingClientRect();
    size = { width: r.width, height: r.height };
  });

  const pos = $derived(
    at
      ? clampMenuPosition(at.x, at.y, size, { width: innerWidth, height: innerHeight })
      : { x: 0, y: 0 },
  );

  const close = () => (appState.contextMenu = null);

  function run(item: ContextItem) {
    if (!item.enabled) return;
    close();
    if (item.id === "cut") cutSelection();
    else if (item.id === "copy") copySelection();
    else if (item.id === "paste") pasteAtPlayhead();
    else if (item.id === "duplicate") duplicateSelection();
    else deleteSelection();
  }
</script>

<svelte:window onkeydown={(e) => e.key === "Escape" && close()} />

{#if at}
  <!-- `clickOutside` wraps the menu itself; the pointerdown that OPENED it has already happened,
       so there is no trigger to exclude here (unlike ToolbarMenu). -->
  <div
    bind:this={el}
    use:clickOutside={close}
    class="fixed z-40 min-w-40 rounded border border-line bg-panel py-1 shadow-lg"
    style="left: {pos.x}px; top: {pos.y}px"
    role="menu"
    tabindex="-1"
  >
    {#each items as item (item.id)}
      <button
        class="flex w-full items-center px-3 py-1 text-left text-xs {item.enabled
          ? 'text-text hover:bg-raised'
          : 'cursor-default text-disabled'}"
        role="menuitem"
        disabled={!item.enabled}
        onclick={() => run(item)}
      >
        {item.label}
      </button>
    {/each}
  </div>
{/if}
