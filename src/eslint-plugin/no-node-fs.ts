import { createNoNodeFs } from "../_ipc/no-node-fs.js"

/**
 * Flags any `import`/`require`/dynamic `import()` of `node:fs` in library code, so a library surface acquires
 * its filesystem capability from the caller instead of reaching for `node:fs` itself.
 *
 * @remarks
 * Nothing is exempt by default. A package's own config allows its CLI folder (for example `src/cli/**`),
 * which builds the `node:fs/promises` adapter, and a consuming project sets the `allow` option for its own CLI
 * or script entry points. The rule itself lives in `../_ipc/no-node-fs.ts`, a managed copy of
 * internal-package-contract's `runtime/no-node-fs.ts`; this supplies data-cap's documentation link and the decision
 * record the message cites.
 */
export const noNodeFs = createNoNodeFs({
  docsUrl: () => "https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md#eslint-plugin",
  adr: "ADR 0058",
  guide: "GUIDE.md's ESLint plugin section",
})
