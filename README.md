# slop-audio-editor

Browser-based multitrack audio editor: import audio onto tracks, move/trim/cut/copy-paste clips,
set track and clip gain, apply fade curves, export a mixdown.

**Stack:** Svelte 5 + TypeScript + Vite + Tailwind 4 + Vitest. No server, no upload — audio never
leaves the browser.

## Commands

- `npm run dev` — Vite dev server
- `npm run build` — `svelte-check && tsc --noEmit && vite build` (bar: 0 errors, 0 warnings)
- `npm test` — Vitest
- `npm run deploy` — build, then `wrangler deploy` to Cloudflare Workers static assets

## Design

See `docs/superpowers/specs/2026-09-03-slop-audio-editor-design.md`.
