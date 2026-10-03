---
"data-cap": minor
---

Audit fixes ahead of 1.0.

- Breaking (pre-1.0 minor): Node.js `>=22` (Node 20 is end-of-life) and an optional `typescript` peer of `^5 || ^6`, so `npm i typescript@6 data-cap` no longer fails with `ERESOLVE`. With TypeScript 7 the build step now says so instead of failing with `ts.createSourceFile is not a function`.
- Breaking (pre-1.0 minor): `data-cap/eslint-plugin` no longer vendors `@typescript-eslint/*`; `@typescript-eslint/utils` is an optional peer (ADR 0068). The entry shrinks from ~413 KB to a few KB per format.
- Breaking (pre-1.0 minor): `init` scaffolds `docs/DATA-OWNERSHIP.md` so it can no longer collide with env-cap's `docs/OWNERSHIP.md`.
- The GitHub Action's PR comment no longer has silently empty Manifest and Flow sections: it reads the evidence every run composes (an "Inventory" section). It also passes every input through environment variables, uses the project's own install, and requires `version` otherwise instead of running an unpinned `latest`.
- Generated Markdown reports tell the reader how they are really produced and regenerated (the script that calls the `./build` generators), not `npx data-cap`; internal ADR numbers are gone from them.
- Source maps no longer embed `sourcesContent` (about 60% of the unpacked package).
- `./node` and `./evidence` are listed as Stable and added to the API reference; `--help` links are absolute URLs; entry-point counts in the docs and agent skill no longer drift.
- Landing page: keyboard-focusable code blocks, a high-contrast theme toggle, forced-colors support.
