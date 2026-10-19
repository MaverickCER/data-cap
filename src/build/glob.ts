/**
 * Glob-to-RegExp conversion for discovery. The behavior lives in `../_ipc/glob.ts`, a managed copy of
 * internal-package-contract's `runtime/glob.ts`. Not re-exported from `./index.js`: Private tier per VERSIONING.md.
 */
export { globToRegExp } from "../_ipc/glob.js"
