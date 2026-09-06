<script lang="ts">
  const {
    label,
    value,
    min = 0,
    max = Infinity,
    step = 0.01,
    suffix = "",
    title = undefined,
    disabled = false,
    onCommit,
  }: {
    label: string;
    value: number;
    min?: number;
    max?: number;
    /** How much one pixel of horizontal drag is worth. Per unit: seconds want 0.01, dB 0.1. */
    step?: number;
    suffix?: string;
    title?: string;
    disabled?: boolean;
    onCommit: (v: number) => void;
  } = $props();

  // A WRITABLE `$derived`: typing assigns to it, a scrub assigns to it, and it re-syncs on its own
  // whenever `value` changes from elsewhere (a drag on the timeline, an undo).
  let draft = $derived(value.toFixed(2));

  let input = $state<HTMLInputElement | null>(null);
  const clamp = (v: number): number => Math.max(min, Math.min(max, v));

  function commitDraft() {
    // Both blur and Escape land here. Committing what is ALREADY displayed would be a real edit,
    // not a no-op: the field shows `value.toFixed(2)`, so for any value with finer precision than
    // two decimals — which every pointer drag produces — `Number(draft)` differs from `value` by a
    // few milliseconds. `edits.ts`'s `d === 0` and `c.gain === g` guards cannot catch a delta that
    // small-but-nonzero, so it would push an undo entry and, mid-playback, force a reschedule,
    // just for tabbing through the inspector.
    if (draft === value.toFixed(2)) return;
    const v = Number(draft);
    if (Number.isFinite(v)) onCommit(clamp(v));
    else draft = value.toFixed(2);
  }

  /**
   * Drag horizontally to change the value — the convention every creative tool uses, because
   * typing a number you want to *feel* your way to is the wrong instrument.
   *
   * A press that never moves is left alone, so it still puts a caret in the field to type: the
   * scrub only takes over once the pointer has travelled, and it is the movement that suppresses
   * the focus, not a timer.
   *
   * The document is written ONCE, on release. The draft carries the value during the drag, so a
   * whole scrub is one undo entry and playback is not rescheduled on every pixel.
   */
  let scrub: { startX: number; startValue: number; moved: boolean } | null = null;

  function scrubDown(e: PointerEvent) {
    if (disabled) return;
    scrub = { startX: e.clientX, startValue: value, moved: false };
    window.addEventListener("pointermove", scrubMove);
    window.addEventListener("pointerup", scrubUp);
    window.addEventListener("pointercancel", scrubUp);
  }

  function scrubMove(e: PointerEvent) {
    if (!scrub) return;
    const dx = e.clientX - scrub.startX;
    if (!scrub.moved) {
      if (Math.abs(dx) < 3) return;
      scrub.moved = true;
      input?.blur(); // a scrub is not a text edit; a caret left blinking in it is a lie
    }
    // Shift is the fine step, the same modifier the timeline nudge uses.
    draft = clamp(scrub.startValue + dx * step * (e.shiftKey ? 0.1 : 1)).toFixed(2);
  }

  function scrubUp() {
    window.removeEventListener("pointermove", scrubMove);
    window.removeEventListener("pointerup", scrubUp);
    window.removeEventListener("pointercancel", scrubUp);
    if (scrub?.moved) commitDraft();
    scrub = null;
  }

  function onKeyDown(e: KeyboardEvent) {
    if (e.key === "Enter") (e.currentTarget as HTMLInputElement).blur();
    if (e.key === "Escape") {
      draft = value.toFixed(2);
      (e.currentTarget as HTMLInputElement).blur();
    }
    // Arrow keys step the value while the field has focus — ten steps with Shift, which is the
    // coarse direction here because the base step is already small.
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const dir = e.key === "ArrowUp" ? 1 : -1;
      draft = clamp(value + dir * step * (e.shiftKey ? 10 : 1)).toFixed(2);
      commitDraft();
    }
    e.stopPropagation(); // keep the global shortcuts out of a text field
  }
</script>

<!-- A shared three-column grid, set by the PARENT: labels, then the inputs, then the units. Each
     row used to be its own flex, so the box started wherever that row's label happened to end and
     "in" / "fade out" put four different left edges down the column. `display: contents` lets
     these three children sit in the parent's grid while the label still wraps the input. -->
<label
  class="contents text-[11px] whitespace-nowrap {disabled ? 'text-disabled' : 'text-muted'}"
  {title}
>
  <span class="text-right">{label}</span>
  <!-- `raised`, not `panel`: the toolbar and the inspector ARE panel, so a panel-coloured input
       is invisible against them and the label reads as unrelated to its own value. -->
  <input
    bind:this={input}
    class="h-6 w-full min-w-0 rounded bg-raised px-1 text-right tabular-nums {disabled
      ? 'text-disabled'
      : 'cursor-ew-resize text-text'}"
    type="text"
    inputmode="decimal"
    {disabled}
    bind:value={draft}
    onpointerdown={scrubDown}
    onblur={commitDraft}
    onkeydown={onKeyDown}
  />
  <span class={disabled ? "text-disabled" : "text-muted"}>{suffix}</span>
</label>
