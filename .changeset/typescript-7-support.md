---
"data-cap": minor
---

TypeScript 7 is supported. `npm i typescript@7 data-cap` no longer fails with `ERESOLVE` (the optional `typescript` peer is now `^5 || ^6 || ^7`), and the `data-cap/build` scanner works under a TypeScript 7 root with no configuration: TypeScript 7 ships no programmatic compiler API, so the scanner uses your `typescript` when it has one (5 and 6, unchanged) and otherwise a bundled `@typescript/typescript6` (ADR 0069). Your `tsc` stays TypeScript 7.

- The compiler is bundled inside the package (`bundleDependencies`, about 5 MB packed / 26 MB installed) and used only by the build entry; the runtime, helpers, evidence and node entry points can never reach it (checked in CI by `verify:compiler-isolation`). Bundling also keeps your own `tsc` yours: installing the package does not change `node_modules/.bin/tsc`.
- With TypeScript 7, the `data-cap/build` and `data-cap/evidence` declarations name AST types TypeScript 7 does not export, so those two entry points need `skipLibCheck`; the runtime, helpers and node entry points type-check strictly. TypeScript 5 and 6 are unaffected.
- If the bundled compiler is stripped from an install, the scanner fails before writing anything, with a message that shows the alias to install.
- CI now installs the packed tarball beside TypeScript 5, 6 and 7 and runs the scanner from both the ESM and CJS entry points.
