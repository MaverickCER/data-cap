#!/usr/bin/env node
// TypeDoc's own bundled default theme (0.28.20, the current latest -- see
// node_modules/typedoc/dist/index.js's `toolbar` partial) renders the search
// box as `<input id="tsd-search-input" role="combobox" ...>` with no
// `aria-label`, `title`, or associated `<label>`. pa11y's WCAG2AA scan flags
// that as two errors (H91, F68) in docs/api/index.html -- markup TypeDoc
// itself generates, not anything hand-authored in this package.
//
// docs/api/ is regenerated from scratch by every `npm run docs:api` (it is
// not committed -- see scripts/check-api-report.mjs's doc comment), so
// hand-patching the emitted HTML would be silently undone the next time
// anyone builds the docs. Fixing it here, as a TypeDoc plugin registered in
// typedoc.json, keeps the fix in the build pipeline instead: it hooks the
// theme's own `body.end` extension point (the same mechanism the theme uses
// internally, e.g. for its dark-mode bootstrap script -- see `JSX.Raw` usage
// in the theme's `defaultLayout`) to inject a one-line script that sets the
// missing `aria-label` once the page has rendered.
//
// Dependency-free (only the `typedoc` peer this plugin runs inside) -- dev
// tooling, never shipped.

import { JSX } from "typedoc"

/**
 * @param {import("typedoc").Application} app
 */
export function load(app) {
  app.renderer.hooks.on("body.end", () =>
    JSX.createElement(
      "script",
      null,
      JSX.createElement(JSX.Raw, {
        html: 'document.getElementById("tsd-search-input")?.setAttribute("aria-label", "Search the documentation");',
      }),
    ),
  )
}
