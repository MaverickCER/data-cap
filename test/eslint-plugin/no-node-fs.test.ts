import { RuleTester } from "eslint"
import type { Rule } from "eslint"
import { describe, expect, it } from "vitest"
import { noNodeFs } from "../../src/eslint-plugin/no-node-fs.js"

// The rule's behavior is tested where it is written, in internal-package-contract (`runtime/no-node-fs.ts`). This
// pins what data-cap supplies to it, and proves the wiring works with the installed ESLint and typescript-eslint.
RuleTester.describe = describe
RuleTester.it = it

new RuleTester({ languageOptions: { ecmaVersion: 2022, sourceType: "module" } }).run(
  "no-node-fs (wiring)",
  noNodeFs as unknown as Rule.RuleModule,
  {
    valid: [
      {
        code: `import fs from "node:fs/promises";`,
        filename: "src/cli/index.ts",
        options: [{ allow: ["src/cli/**"] }],
      },
    ],
    invalid: [
      {
        code: `import fs from "node:fs";`,
        filename: "src/build/discover.ts",
        errors: [{ messageId: "noNodeFs", data: { specifier: "node:fs" } }],
      },
    ],
  },
)

describe("noNodeFs", () => {
  it("links to data-cap's own documentation", () => {
    expect(noNodeFs.meta.docs?.url).toBe(
      "https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md#eslint-plugin",
    )
  })

  it("cites data-cap's decision record and guide", () => {
    expect(noNodeFs.meta.messages.noNodeFs).toContain(
      "(see ADR 0058 / GUIDE.md's ESLint plugin section for the allow-list escape hatch).",
    )
  })
})
