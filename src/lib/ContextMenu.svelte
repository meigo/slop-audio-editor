<script lang="ts">
  import {
    canPaste,
    cutSelection,
    copySelection,
    deleteSelection,
    duplicateSelection,
    pasteAtPlayhead,
    state as appState,
    zoomToFit,
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

  /** Every id gets its own case and the default is a compile error, NOT an action. This used to
   *  end in a bare `else deleteSelection()`, so adding a row to `contextItems` and forgetting a
   *  branch here would have made the new row DELETE the selection — silently, and with no test
   *  that could see it. The `never` makes that a build failure instead. */
  function run(item: ContextItem) {
    if (!item.enabled) return;
    close();
    switch (item.id) {
      case "cut":
        return cutSelection();
      case "copy":
        return copySelection();
      case "paste":
        return pasteAtPlayhead();
      case "duplicate":
        return duplicateSelection();
      case "delete":
        return deleteSelection();
      case "zoomFit":
        return zoomToFit("selection");
      default: {
        const unhandled: never = item.id;
        throw new Error(`unhandled context item: ${String(unhandled)}`);
      }
    }
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
