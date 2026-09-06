<script lang="ts">
  import { X } from "@lucide/svelte";
  import { GESTURE_GROUPS, GESTURES, SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";

  const { onClose }: { onClose: () => void } = $props();
</script>

<!-- Same shell as the export dialog, so the app has one modal look. Wider, because the content
     is columns of key/label pairs rather than a form. -->
<div
  class="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-6"
  role="presentation"
  onclick={(e) => {
    if (e.target === e.currentTarget) onClose();
  }}
>
  <div class="max-h-full w-152 overflow-y-auto rounded bg-panel p-4 text-sm text-text">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-medium">Shortcuts</h2>
      <button
        class="rounded p-1 text-muted hover:bg-raised hover:text-text"
        title="Close (Esc)"
        onclick={onClose}
      >
        <X size={16} />
      </button>
    </div>

    <!-- Both halves render the same chip/label pair; only where the chip's text comes from
         differs. `columns-2` rather than a grid: grid rows are as tall as their tallest section,
         which left a large gap under the short columns. -->
    {#snippet rows(entries: { chip: string; label: string }[])}
      <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
        {#each entries as e (e.chip)}
          <dt
            class="justify-self-start rounded bg-raised px-1.5 py-0.5 text-[11px] whitespace-nowrap text-text tabular-nums"
          >
            {e.chip}
          </dt>
          <dd class="text-xs text-muted">{e.label}</dd>
        {/each}
      </dl>
    {/snippet}

    <h3 class="mb-2 text-xs text-text">Keyboard</h3>
    <div class="columns-2 gap-x-8">
      {#each SHORTCUT_GROUPS as group (group)}
        <section class="mb-4 break-inside-avoid">
          <h4 class="mb-1 text-[11px] tracking-wide text-muted uppercase">{group}</h4>
          {@render rows(
            SHORTCUTS.filter((s) => s.group === group).map((s) => ({
              chip: s.keys,
              label: s.label,
            })),
          )}
        </section>
      {/each}
    </div>

    <h3 class="my-2 border-t border-line pt-4 text-xs text-text">Pointer &amp; touch</h3>
    <div class="columns-2 gap-x-8">
      {#each GESTURE_GROUPS as group (group)}
        <section class="mb-4 break-inside-avoid">
          <h4 class="mb-1 text-[11px] tracking-wide text-muted uppercase">{group}</h4>
          {@render rows(
            GESTURES.filter((g) => g.group === group).map((g) => ({
              chip: g.gesture,
              label: g.label,
            })),
          )}
        </section>
      {/each}
    </div>

    <p class="mt-4 text-[11px] text-muted">
      ⌘ is Ctrl on Windows and Linux. Shortcuts do not fire while a text field has focus.
    </p>
  </div>
</div>
