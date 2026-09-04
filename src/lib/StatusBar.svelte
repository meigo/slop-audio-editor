<script lang="ts">
  import { state as appState } from "../state/appState.svelte";
  import { statusSummary } from "./status";

  /** Text of whatever control the pointer is over: its `title`, plus its `data-hint` if it has
   *  one.
   *
   *  The title is read by delegation rather than copied into a parallel attribute, so the tooltip
   *  and the status line cannot disagree and every tooltip added later appears here for free.
   *  `data-hint` is the deliberate exception: guidance that would make a hover tooltip unwieldy
   *  (which modifier keys a clip responds to) but reads well on a full-width status line. It is
   *  additional, never a second copy of the title. */
  let hovered = $state<string | null>(null);

  $effect(() => {
    const onOver = (e: PointerEvent): void => {
      const el = (e.target as Element | null)?.closest?.("[title], [data-hint]");
      const parts = [el?.getAttribute("title"), el?.getAttribute("data-hint")]
        .map((v) => v?.trim())
        .filter((v): v is string => !!v);
      hovered = parts.length > 0 ? parts.join(" · ") : null;
    };
    const onLeave = (): void => {
      hovered = null;
    };
    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerleave", onLeave);
    return () => {
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerleave", onLeave);
    };
  });

  const resting = $derived(
    statusSummary(appState.project, appState.selection, appState.playRange),
  );
</script>

<div
  class="flex h-[22px] shrink-0 items-center gap-2 border-t border-neutral-700 px-3 text-[11px]"
>
  <!-- One brightness for both states. The text swaps completely between the resting summary and
       the hovered control's help, so a colour change on top of that carries no extra information
       and just flickers on every pointer move. `neutral-400` is this app's tier for secondary
       informational text (ruler labels, field labels) — which is exactly what a status line is. -->
  <span class="truncate text-neutral-400">{hovered ?? resting}</span>
</div>
