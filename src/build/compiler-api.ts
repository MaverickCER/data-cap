import { assertCompilerApi as assertFor } from "../_ipc/compiler-api.js"

/**
 * Fails with a readable message when the resolved compiler lacks the classic API the scanner needs. The wording
 * lives in `../_ipc/compiler-api.ts`, a managed copy of internal-package-contract's `runtime/compiler-api.ts`;
 * this binds it to data-cap.
 * @param compiler - The resolved compiler module (a parameter so a test can hand in a stand-in).
 * @throws Error naming the installed version and how to restore the bundled compiler.
 */
export function assertCompilerApi(compiler: {
  readonly createSourceFile?: unknown
  readonly version?: string
}): void {
  assertFor("data-cap", compiler)
}
