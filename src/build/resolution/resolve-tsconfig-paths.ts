import { loadTsconfigPaths as loadFor } from "../../_ipc/resolve-tsconfig-paths.js"
import type { LoadTsconfigPathsResult } from "../../_ipc/resolve-tsconfig-paths.js"
import type { BuildFileSystem } from "../types.js"

/**
 * TypeScript path-alias resolution. The behavior lives in `../../_ipc/resolve-tsconfig-paths.ts`, a managed copy of
 * internal-package-contract's `runtime/resolve-tsconfig-paths.ts`; this binds the one package-specific input, the
 * name used when no usable compiler resolved.
 */
export {
  createAliasResolutionCache,
  resolveAliasImport,
} from "../../_ipc/resolve-tsconfig-paths.js"
export type {
  AliasResolutionCache,
  LoadTsconfigPathsResult,
  TsconfigPathsResolution,
} from "../../_ipc/resolve-tsconfig-paths.js"

/**
 * Loads and parses a `tsconfig.json` for alias resolution, once per run.
 * @param root - The project root; a missing default `tsconfig.json` there is silent.
 * @param tsconfigOption - `false` disables alias resolution, a path overrides the default file.
 * @param fs - The filesystem capability.
 * @returns The resolution and at most one warning.
 */
export function loadTsconfigPaths(
  root: string,
  tsconfigOption: string | false | undefined,
  fs: BuildFileSystem,
): Promise<LoadTsconfigPathsResult> {
  return loadFor("data-cap", root, tsconfigOption, fs)
}
