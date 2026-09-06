<script lang="ts">
  import { PanelRightClose, PanelRightOpen } from "@lucide/svelte";
  import { state as appState } from "../state/appState.svelte";
  import ClipInspector from "./ClipInspector.svelte";
  import MasterInspector from "./MasterInspector.svelte";
  import TrackInspector from "./TrackInspector.svelte";
  import { clampPanelWidth, PANEL_RAIL_WIDTH, resizedPanelWidth } from "./panel-layout";

  /** Three levels, and the panel follows whatever you last touched: a clip shows Clip, a track
   *  header or empty lane space shows Track, and Master is only reached by asking for it. See
   *  `focusPanel`. A track is its own level — clips sit on it and more track-wide effects will
   *  land there — so folding it into Clip made the tab mean two things at once. */
  const TABS = [
    { id: "clip" as const, label: "Clip" },
    { id: "track" as const, label: "Track" },
    { id: "master" as const, label: "Master" },
  ];

  // Resize grip, mirroring slop-animator's. The arithmetic lives in `resizedPanelWidth` so it can
  // be tested — the pointer plumbing here cannot be, since `setPointerCapture` rejects synthetic
  // events and this harness delivers no real button presses.
  let gripStartX = 0;
  let gripStartW = 0;

  function gripDown(e: PointerEvent) {
    (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
    gripStartX = e.clientX;
    gripStartW = appState.sidePanelWidth;
  }

  function gripMove(e: PointerEvent) {
    if (!(e.currentTarget as HTMLElement).hasPointerCapture(e.pointerId)) return;
    appState.sidePanelWidth = resizedPanelWidth(
      gripStartW,
      gripStartX,
      e.clientX,
      window.innerWidth,
    );
  }

  function gripUp(e: PointerEvent) {
    try {
      (e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
    } catch {
      // Already released — `pointercancel` does it itself.
    }
  }

  /** A stored width from a wider screen must not strand the panel over half this one. */
  function onWindowResize() {
    appState.sidePanelWidth = clampPanelWidth(appState.sidePanelWidth, window.innerWidth);
  }
</script>

<svelte:window onresize={onWindowResize} />

<div
  class="relative flex shrink-0 flex-col border-l border-line bg-panel"
  style="width: {appState.sidePanelOpen ? appState.sidePanelWidth : PANEL_RAIL_WIDTH}px"
>
  {#if appState.sidePanelOpen}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div
      class="absolute inset-y-0 -left-1 z-10 w-2 cursor-ew-resize touch-none"
      title="Drag to resize the panel"
      onpointerdown={gripDown}
      onpointermove={gripMove}
      onpointerup={gripUp}
      onpointercancel={gripUp}
    ></div>
  {/if}

  <!-- The toggle is LAST, pinned to the panel's right edge. The panel grows leftwards, so its
       left edge moves by the full width it opens by while the right edge does not move at all —
       a toggle on the left would slide out from under the pointer that just clicked it. -->
  <div class="flex h-7 items-center border-b border-line">
    {#if appState.sidePanelOpen}
      {#each TABS as tab (tab.id)}
        <button
          class="h-full px-2 text-[11px] {appState.sidePanelTab === tab.id
            ? 'border-b border-accent text-text'
            : 'text-muted hover:text-text'}"
          aria-pressed={appState.sidePanelTab === tab.id}
          onclick={() => (appState.sidePanelTab = tab.id)}
        >
          {tab.label}
        </button>
      {/each}
    {/if}
    <button
      class="ml-auto shrink-0 self-stretch px-2 text-muted hover:bg-raised hover:text-text"
      title={appState.sidePanelOpen ? "Hide panel" : "Show panel"}
      onclick={() => (appState.sidePanelOpen = !appState.sidePanelOpen)}
    >
      {#if appState.sidePanelOpen}<PanelRightClose size={13} />
      {:else}<PanelRightOpen size={13} />{/if}
    </button>
  </div>

  {#if appState.sidePanelOpen}
    <div class="min-h-0 flex-1 overflow-y-auto">
      {#if appState.sidePanelTab === "clip"}
        <ClipInspector />
      {:else if appState.sidePanelTab === "track"}
        <TrackInspector />
      {:else}
        <MasterInspector />
      {/if}
    </div>
  {/if}
</div>
