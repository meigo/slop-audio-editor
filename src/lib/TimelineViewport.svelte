<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { MAX_PX_PER_S, MIN_PX_PER_S, pinchUpdate, pxToTime, type PinchStart } from "./geometry";

  const { children }: { children: import("svelte").Snippet } = $props();

  let el = $state<HTMLDivElement | null>(null);

  /** Live touch points, by pointerId. Only touch is tracked: a mouse has the wheel, and a stylus
   *  drags clips. Two entries means a pinch/pan gesture is in progress. */
  const touches = new Map<number, { x: number }>();
  let pinch: PinchStart | null = null;

  const centerAndSpread = (): { centerPx: number; spreadPx: number } => {
    const [a, b] = [...touches.values()];
    return { centerPx: (a.x + b.x) / 2, spreadPx: Math.abs(a.x - b.x) };
  };

  /** Two fingers on the timeline pan and zoom it. One finger is left alone so it still reaches
   *  the clip and lane handlers underneath — dragging a clip must not be hijacked into a scroll. */
  function onPointerDown(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    const rect = el!.getBoundingClientRect();
    touches.set(e.pointerId, { x: e.clientX - rect.left });
    if (touches.size === 2) {
      pinch = {
        pxPerSecond: appState.pxPerSecond,
        scrollS: appState.scrollS,
        ...centerAndSpread(),
      };
    }
  }

  function onPointerMove(e: PointerEvent) {
    if (e.pointerType !== "touch" || !touches.has(e.pointerId)) return;
    const rect = el!.getBoundingClientRect();
    touches.set(e.pointerId, { x: e.clientX - rect.left });
    if (touches.size !== 2 || !pinch) return;
    e.preventDefault();
    const next = pinchUpdate(pinch, centerAndSpread());
    appState.pxPerSecond = next.pxPerSecond;
    appState.scrollS = next.scrollS;
  }

  function onPointerUp(e: PointerEvent) {
    if (e.pointerType !== "touch") return;
    touches.delete(e.pointerId);
    // Re-anchor rather than ending the gesture outright: lifting one finger of two should leave
    // the timeline where it is, not snap it back or jump on the next move.
    pinch = null;
  }

  /** Ctrl/Cmd-wheel zooms about the pointer; plain wheel scrolls in time. */
  function onWheel(e: WheelEvent) {
    e.preventDefault();
    if (e.ctrlKey || e.metaKey) {
      const rect = el!.getBoundingClientRect();
      const anchorS = pxToTime(e.clientX - rect.left, appState.scrollS, appState.pxPerSecond);
      const next = Math.min(
        MAX_PX_PER_S,
        Math.max(MIN_PX_PER_S, appState.pxPerSecond * Math.pow(1.0015, -e.deltaY)),
      );
      // Keep the time under the pointer pinned while the scale changes.
      appState.scrollS = Math.max(0, anchorS - (e.clientX - rect.left) / next);
      appState.pxPerSecond = next;
    } else {
      const dx = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY;
      appState.scrollS = Math.max(0, appState.scrollS + dx / appState.pxPerSecond);
    }
  }
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<!-- `touch-action: none`: without it the browser claims a drag as page scroll or pinch-zoom and
     cancels the pointer stream mid-gesture, so clip drags would die partway on a touchscreen. -->
<div
  bind:this={el}
  class="relative flex-1 touch-none overflow-hidden"
  onwheel={onWheel}
  onpointerdown={onPointerDown}
  onpointermove={onPointerMove}
  onpointerup={onPointerUp}
  onpointercancel={onPointerUp}
>
  {@render children()}
</div>
