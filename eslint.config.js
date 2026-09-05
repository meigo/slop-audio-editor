import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import svelte from "eslint-plugin-svelte";
import svelteConfig from "./svelte.config.js";
import globals from "globals";
import prettier from "eslint-config-prettier";
import betterTailwind from "eslint-plugin-better-tailwindcss";

export default tseslint.config(
  eslint.configs.recommended,
  ...tseslint.configs.recommended,
  ...svelte.configs.recommended,
  {
    languageOptions: { globals: { ...globals.browser } },
  },
  {
    rules: {
      // `varsIgnorePattern` as well as args: `const { glue: _glue, ...rest }` is how the tests
      // build a document with one field removed, and the discarded half is the whole point.
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "no-constant-condition": "warn",
      // `destructuring: "all"` — the default reports `let { p, trackId } = …` because `trackId`
      // alone is never reassigned, and the only way to satisfy it is to split one destructure into
      // two statements. Report only when EVERY name in the pattern could be const.
      "prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  {
    // TypeScript parsing for `<script lang="ts">` + runes awareness via svelte.config.js.
    files: ["**/*.svelte", "**/*.svelte.ts", "**/*.svelte.js"],
    languageOptions: {
      parserOptions: {
        parser: tseslint.parser,
        extraFileExtensions: [".svelte"],
        svelteConfig,
      },
    },
  },
  {
    rules: {
      // svelte-check owns Svelte compiler + a11y diagnostics — don't duplicate them in ESLint.
      "svelte/valid-compile": "off",
      // The media pool is a plain Map ON PURPOSE: it holds decoded audio, lives outside $state and
      // outside undo history, and must NOT be reactive (see the pool notes in CLAUDE.md). Where
      // reactivity IS required the code already uses SvelteSet — `state.soloed` would silently stop
      // updating the UI as a plain Set, which is its own gotcha.
      "svelte/prefer-svelte-reactivity": "off",
      // Clip drags, the ruler and the timeline viewport use setPointerCapture and read/write
      // element geometry directly; that is the gesture layer, not state Svelte should reconcile.
      "svelte/no-dom-manipulating": "off",
    },
  },
  {
    // Core prefer-const mis-fires on runes destructures (`let { x } = $props()`, `let x = $state()`
    // legitimately need `let`); use the runes-aware svelte/prefer-const instead.
    files: ["**/*.svelte"],
    rules: {
      "prefer-const": "off",
      "svelte/prefer-const": ["warn", { destructuring: "all" }],
    },
  },
  // Disable rules that conflict with Prettier (must be after the rule configs).
  prettier,
  ...svelte.configs.prettier,
  {
    // Vitest files run in Node and use its globals.
    files: ["**/*.test.ts"],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // Tailwind class-level lint. ONLY the conflict/duplicate rules: they catch real bugs (two
    // classes fighting over the same property), which is exactly how the loop button's
    // `class:text-accent` over `BTN`'s `text-text` went unnoticed. Deliberately NOT class-ORDER
    // (prettier-plugin-tailwindcss already sorts) or `no-unregistered-classes` (this codebase has
    // legitimate custom classes such as `slider` and `bipolar`).
    // Tailwind 4 is CSS-first, so the plugin needs the entry stylesheet to resolve the theme.
    files: ["**/*.svelte", "**/*.html"],
    plugins: { "better-tailwindcss": betterTailwind },
    settings: {
      "better-tailwindcss": { entryPoint: "src/app.css" },
    },
    rules: {
      "better-tailwindcss/no-conflicting-classes": "error",
      "better-tailwindcss/no-duplicate-classes": "warn",
      "better-tailwindcss/enforce-canonical-classes": "warn",
      // canonical-classes leaves double spaces behind when it collapses pairs — this tidies them.
      "better-tailwindcss/no-unnecessary-whitespace": "warn",
    },
  },
  {
    ignores: ["dist/"],
  },
);
