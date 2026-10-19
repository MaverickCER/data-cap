/**
 * The filesystem capability `./build` requires from its caller, and the two small structural types it returns.
 * Defined once in `../_ipc/build-fs.ts`, a managed copy of internal-package-contract's `runtime/build-fs.ts`, and
 * re-exported here so the public `build` entry keeps exporting them. See ADR 0058.
 */
export type { BuildDirent, BuildFileSystem, BuildStats } from "../_ipc/build-fs.js"
