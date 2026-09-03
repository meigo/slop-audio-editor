import { defineConfig } from "vitest/config";
import { svelte } from "@sveltejs/vite-plugin-svelte";
import tailwindcss from "@tailwindcss/vite";

export default defineConfig({
  plugins: [svelte(), tailwindcss()],
  build: {
    // mediabunny is ~668 kB minified and is what browser-side MP3/AAC/Opus encoding costs; it has
    // no lighter submodule to import. It is already split into its own chunk, loaded lazily only
    // when the user exports (see src/export/encode.ts), which is the part that actually mattered:
    // the entry chunk is ~114 kB. This threshold sits just above mediabunny's chunk so its
    // unactionable advisory stays quiet, while a real regression — an entry chunk ballooning past
    // 700 kB, roughly 6x its current size — would still be reported.
    chunkSizeWarningLimit: 700,
  },
  test: { environment: "node", include: ["src/**/*.test.ts"] },
});
