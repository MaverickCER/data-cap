/**
 * Matching of the plugin's `allow` options against the file a rule is checking. The behavior lives in
 * `../_ipc/glob.ts`, a managed copy of internal-package-contract's `runtime/glob.ts`: a pattern written relative to
 * the working directory (`src/cli/**`) matches the absolute path ESLint passes, on Windows too.
 */
export { matchesAllowList } from "../_ipc/glob.js"
