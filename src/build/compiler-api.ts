/**
 * Fails with a readable message when the installed `typescript` does not expose the classic
 * compiler API (`createSourceFile`) the build-time scanner is written against -- TypeScript 7 moved
 * its syntax-tree API to `typescript/unstable/*`, so a raw call would die with
 * "ts.createSourceFile is not a function".
 * @param compiler - The imported `typescript` module (a parameter so a test can hand in a stand-in).
 * @throws Error naming the installed version and the supported range.
 */
export function assertCompilerApi(compiler: {
  readonly createSourceFile?: unknown
  readonly version?: string
}): void {
  if (typeof compiler.createSourceFile === "function") return
  throw new Error(
    `data-cap's build-time scanner needs TypeScript's classic compiler API (typescript ^5 || ^6), but the installed typescript${
      compiler.version === undefined ? "" : ` ${compiler.version}`
    } does not expose it. Install typescript@6 alongside it for the build step ` +
      "(see VERSIONING.md, 'Supported toolchain').",
  )
}
