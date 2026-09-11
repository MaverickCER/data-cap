/**
 * `data-cap`'s own installed package version -- internal, shared by every
 * module in `build/` that needs it (`runtime-contract-model.ts`, `sarif.ts`,
 * `evidence-fingerprint.ts`, `generate-data-artifacts.ts`).
 *
 * Substituted at bundle time by `tsup`'s `define` (and by vitest's, for
 * tests) with a string literal read once from `package.json` -- see
 * `tsup.config.ts`. `./build` never reads its own manifest from disk (ADR
 * 0058). A module-scoped `declare` (not an ambient `.d.ts`) so every tool
 * that type-checks this file, including `ts-json-schema-generator`, sees the
 * name.
 */
declare const __PACKAGE_VERSION__: string

export const PACKAGE_VERSION: string = __PACKAGE_VERSION__
