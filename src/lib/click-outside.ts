/**
 * Svelte action: call `onOutside` when a pointerdown lands outside `node`.
 *
 * Attach it to a wrapper containing BOTH the trigger and the popup, so clicking the trigger to
 * close it is not also treated as "outside" — which would close and immediately reopen. Uses the
 * capture phase so it still fires when an inner handler stops propagation, as the timeline's own
 * pointer handlers do.
 *
 * Borrowed from slop-animator, where the same action backs the same menu pattern.
 */
export function clickOutside(node: HTMLElement, onOutside: () => void) {
  let cb = onOutside;
  function handler(e: PointerEvent) {
    if (!node.contains(e.target as Node)) cb();
  }
  document.addEventListener("pointerdown", handler, true);
  return {
    update(next: () => void) {
      cb = next;
    },
    destroy() {
      document.removeEventListener("pointerdown", handler, true);
    },
  };
}
