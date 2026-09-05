import { state as appState } from "../state/appState.svelte";

/** How long a finger must stay down, and how far it may wander while doing so. Beyond the slop it
 *  is a drag, not a press. */
const LONG_PRESS_MS = 500;
const LONG_PRESS_SLOP_PX = 8;

let timer: ReturnType<typeof setTimeout> | null = null;
let origin: { x: number; y: number } | null = null;

function cancel(): void {
  if (timer !== null) clearTimeout(timer);
  timer = null;
  origin = null;
}

/**
 * Open the context menu when a TOUCH press is held still.
 *
 * Touch only: a mouse gets the menu from `contextmenu`, and arming this for a mouse would open it
 * on any slow click. The clip drag that the same pointerdown starts is deliberately left running —
 * a drag that never moves commits nothing, since `edits.ts` guards its no-ops on exact equality,
 * and cancelling it would need a cancel path through `clip-drag` that cannot be tested without
 * real touch hardware.
 */
export function armLongPress(e: PointerEvent): void {
  if (e.pointerType !== "touch") return;
  cancel();
  origin = { x: e.clientX, y: e.clientY };
  const { clientX: x, clientY: y } = e;
  timer = setTimeout(() => {
    timer = null;
    appState.contextMenu = { x, y };
  }, LONG_PRESS_MS);
}

/** Cancel once the finger has moved far enough to mean a drag. */
export function moveLongPress(e: PointerEvent): void {
  if (timer === null || !origin) return;
  if (Math.hypot(e.clientX - origin.x, e.clientY - origin.y) > LONG_PRESS_SLOP_PX) cancel();
}

/** Cancel on lift — a completed tap is not a press. */
export function endLongPress(): void {
  cancel();
}
