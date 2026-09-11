import { spawnSync } from "node:child_process"
import { existsSync, readFileSync } from "node:fs"
import fs from "node:fs/promises"
import path from "node:path"
import { fileURLToPath } from "node:url"
import Ajv from "ajv"
import { describe, expect, it } from "vitest"
import { generateReportSchema } from "../../scripts/generate-json-schema.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const projectRoot = path.resolve(here, "../..")
const schemaPath = path.resolve(projectRoot, "schemas/data-cap-report.schema.json")
const cliDist = path.resolve(projectRoot, "dist/cli/index.js")
const distMissing = !existsSync(cliDist)

describe("published JSON Schema: freshness", () => {
  // ts-json-schema-generator runs a real TypeScript program/type-check over
  // src/cli/json.ts's whole type graph -- inherently slower than a typical
  // unit test, and slow enough under v8 coverage instrumentation's overhead
  // to exceed vitest's default 5000ms test timeout.
  it("matches a fresh generation byte-for-byte (fails if committed but stale)", () => {
    const fresh = `${JSON.stringify(generateReportSchema(), null, 2)}\n`
    const committed = readFileSync(schemaPath, "utf8")
    expect(committed).toBe(fresh)
  }, 15000)
})

describe.skipIf(distMissing)(
  "published JSON Schema: correctness (requires `npm run build`)",
  () => {
    const ajv = new Ajv({ strict: false })
    const schema = JSON.parse(readFileSync(schemaPath, "utf8")) as object
    const validate = ajv.compile(schema)

    const fixtureRoot = path.resolve(here, "fixtures-json-schema")

    async function write(relativePath: string, content: string): Promise<void> {
      const filePath = path.join(fixtureRoot, relativePath)
      await fs.mkdir(path.dirname(filePath), { recursive: true })
      await fs.writeFile(filePath, content, "utf8")
    }

    function runCli(args: string[]): unknown {
      const result = spawnSync(process.execPath, [cliDist, ...args], { encoding: "utf8" })
      return JSON.parse(result.stdout)
    }

    it("a real success payload validates against the schema", async () => {
      await fs.rm(fixtureRoot, { recursive: true, force: true })
      await write(
        "features/payments/payments.ts",
        `import { createData, documentData } from "data-cap";
const fields = { cardToken: "" };
export const paymentsCapability = createData({ fields: fields });
documentData({ fields: fields }, { owner: "payments-team", fields: { cardToken: { description: "Tokenized card reference." } } });
`,
      )

      const payload = runCli([
        "--root",
        fixtureRoot,
        "--location",
        "src/generated/data.manifest.ts",
        "--json",
      ])
      expect(validate(payload)).toBe(true)
      if (!validate(payload)) console.error(validate.errors)

      await fs.rm(fixtureRoot, { recursive: true, force: true })
    })

    it("a real failure payload (no target flags) validates against the schema", () => {
      const payload = runCli(["--json"])
      expect(validate(payload)).toBe(true)
      if (!validate(payload)) console.error(validate.errors)
    })

    it("a real --check payload (with checkResult) validates against the schema", async () => {
      await fs.rm(fixtureRoot, { recursive: true, force: true })
      await write(
        "features/payments/payments.ts",
        `import { createData, documentData } from "data-cap";
const fields = { cardToken: "" };
export const paymentsCapability = createData({ fields: fields });
documentData({ fields: fields }, { owner: "payments-team", fields: { cardToken: { description: "Tokenized card reference." } } });
`,
      )

      // No prior generation -- "missing" findings, checkResult.ok: false.
      const payload = runCli([
        "--root",
        fixtureRoot,
        "--location",
        "src/generated/data.manifest.ts",
        "--check",
        "--json",
      ])
      expect(validate(payload)).toBe(true)
      if (!validate(payload)) console.error(validate.errors)
      expect((payload as { checkResult?: { ok: boolean } }).checkResult).toBeDefined()

      await fs.rm(fixtureRoot, { recursive: true, force: true })
    })

    it("a real --flow payload (Data Flow Diagram + Security Data-Flow Review) validates against the schema", async () => {
      await fs.rm(fixtureRoot, { recursive: true, force: true })
      await write(
        "features/payments/payments.ts",
        `import { createData, documentData } from "data-cap";
const fields = { cardNumber: "" };
export const paymentsCapability = createData({
  fields: fields,
  getters: { getCard: { writes: { cardNumber: true } } },
});
documentData({ fields: fields }, {
  owner: "payments-team",
  fields: { cardNumber: { sensitivity: "restricted" } },
  getters: {
    getCard: { endpoints: [{ direction: "input", kind: "external-service", name: "stripe-api" }] },
  },
});
`,
      )

      const payload = runCli(["--root", fixtureRoot, "--flow", "docs/flow", "--json"])
      expect(validate(payload)).toBe(true)
      if (!validate(payload)) console.error(validate.errors)

      await fs.rm(fixtureRoot, { recursive: true, force: true })
    })
  },
)
