<script lang="ts">
  import { X } from "@lucide/svelte";
  import { SHORTCUT_GROUPS, SHORTCUTS } from "./shortcuts";

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
  <div class="max-h-full w-[38rem] overflow-y-auto rounded bg-panel p-4 text-sm text-text">
    <div class="mb-3 flex items-center justify-between">
      <h2 class="font-medium">Keyboard shortcuts</h2>
      <button class="rounded p-1 text-muted hover:bg-raised hover:text-text" title="Close (Esc)" onclick={onClose}>
        <X size={16} />
      </button>
    </div>

    <div class="columns-2 gap-x-8">
      {#each SHORTCUT_GROUPS as group (group)}
        <section class="mb-4 break-inside-avoid">
          <h3 class="mb-1 text-[11px] uppercase tracking-wide text-muted">{group}</h3>
          <dl class="grid grid-cols-[auto_1fr] items-baseline gap-x-3 gap-y-1">
            {#each SHORTCUTS.filter((s) => s.group === group) as s (s.keys)}
              <dt class="justify-self-start whitespace-nowrap rounded bg-raised px-1.5 py-0.5 text-[11px] tabular-nums text-text">
                {s.keys}
              </dt>
              <dd class="text-xs text-muted">{s.label}</dd>
            {/each}
          </dl>
        </section>
      {/each}
    </div>

    <p class="mt-4 text-[11px] text-muted">
      ⌘ is Ctrl on Windows and Linux. Shortcuts do not fire while a text field has focus.
    </p>
  </div>
</div>
