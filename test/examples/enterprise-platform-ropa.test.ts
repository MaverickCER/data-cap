/**
 * Contract tests for `examples/enterprise-platform`'s GDPR Art. 30(1) ROPA
 * generator (`scripts/ropa/{types,build-model,render,print-lines,run}.ts`)
 * -- same posture as `enterprise-platform-reports.test.ts` (API-04): state
 * the facts this generator exists to establish, so a change that quietly
 * breaks one (a field silently omitted instead of marked "Not documented",
 * an empty `recipientCategories` array rendered blank instead of flagged,
 * controller identity rendered without its own honest caveat) fails here,
 * not just in a manual read of `docs/ROPA.md`.
 *
 * Two layers:
 * - Synthetic-fixture unit tests over `buildRopaModel()`/`renderRopa()`
 *   directly, covering exactly the scenarios that matter for a compliance
 *   document: every field populated, every field left undocumented, the
 *   recipient-categories array empty vs. populated, and controller identity
 *   present vs. missing.
 * - One real-evidence integration check, reusing this example's own shared
 *   `reports/evidence-cache.ts`, proving the generator produces a sane
 *   result against this example's actual, real capabilities -- not just
 *   hand-built fixtures.
 *
 * @remarks
 * Each script module is loaded through a **non-literal** dynamic import, for
 * the same reason `enterprise-platform-reports.test.ts` does -- see that
 * file's own header comment.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { examplesRoot, isInstalled } from "./support.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const ropaDir = path.join(examplesRoot, "enterprise-platform/scripts/ropa")
const reportsDir = path.join(examplesRoot, "enterprise-platform/reports")

const runnable = isInstalled("enterprise-platform") && existsSync(path.join(repoRoot, "dist/build.js"))

interface ControllerIdentity {
  readonly name: string
  readonly contact: string
  readonly representative?: string
  readonly dpoContact?: string
}

/** The minimal `EvidenceModel` shape `buildRopaModel()` actually reads -- a fixture contract, not the full published type (same convention `enterprise-platform-reports.test.ts` uses for its own `ExpectedEvidence`). */
interface FieldFixture {
  readonly path: readonly string[]
  readonly docs:
    | {
        readonly dataSubjectCategory?: string
        readonly recipientCategories?: readonly string[]
        readonly transferSafeguard?: string
        readonly retention?: string
        readonly protections?: string
      }
    | undefined
  readonly sensitivity: { readonly value: string | undefined }
  readonly purpose: { readonly value: string | undefined }
}

interface CapabilityFixture {
  readonly exportName: string
  readonly file: string
  readonly docs:
    | { readonly transferSafeguard?: string; readonly retention?: string; readonly protections?: string }
    | undefined
  readonly fields: readonly FieldFixture[]
}

interface EvidenceFixture {
  readonly provenance: { readonly generatedAt: string }
  readonly capability: { readonly capabilities: readonly CapabilityFixture[] }
}

interface RopaFieldEntry {
  readonly field: string
  readonly dataSubjectCategory: string
  readonly personalDataCategory: string
  readonly recipientCategories: readonly string[]
  readonly transferSafeguard: string
  readonly retention: string
  readonly securityMeasures: string
}

interface RopaRecord {
  readonly capability: string
  readonly file: string
  readonly purposesOfProcessing: string
  readonly fields: readonly RopaFieldEntry[]
}

interface RopaModel {
  readonly schemaVersion: 1
  readonly generatedAt: string
  readonly controllerIdentity: ControllerIdentity | "Not documented"
  readonly records: readonly RopaRecord[]
}

interface BuildModelModule {
  readonly buildRopaModel: (
    evidence: EvidenceFixture,
    controller: ControllerIdentity | undefined,
  ) => RopaModel
}

interface RenderModule {
  readonly renderRopa: (model: RopaModel) => string
}

interface PrintLinesModule {
  readonly printJsonLines: (value: unknown, print: (line: string) => void) => void
}

interface EvidenceCacheModule {
  readonly getEvidence: () => Promise<EvidenceFixture>
}

async function loadRopaModule<TModule>(fileName: string): Promise<TModule> {
  return (await import(/* @vite-ignore */ path.join(ropaDir, fileName))) as TModule
}

async function loadModuleAt<TModule>(absolutePath: string): Promise<TModule> {
  return (await import(/* @vite-ignore */ absolutePath)) as TModule
}

function fixtureField(overrides: Partial<FieldFixture> = {}): FieldFixture {
  return {
    path: ["email"],
    docs: undefined,
    sensitivity: { value: undefined },
    purpose: { value: undefined },
    ...overrides,
  }
}

function fixtureCapability(overrides: Partial<CapabilityFixture> = {}): CapabilityFixture {
  return {
    exportName: "userData",
    file: "src/user.capability.ts",
    docs: undefined,
    fields: [],
    ...overrides,
  }
}

function fixtureEvidence(capabilities: readonly CapabilityFixture[]): EvidenceFixture {
  return {
    provenance: { generatedAt: "2030-01-01T00:00:00.000Z" },
    capability: { capabilities },
  }
}

describe.skipIf(!runnable)("example: enterprise-platform ROPA generator", () => {
  let buildRopaModel: BuildModelModule["buildRopaModel"]
  let renderRopa: RenderModule["renderRopa"]
  let printJsonLines: PrintLinesModule["printJsonLines"]

  beforeAll(async () => {
    ;({ buildRopaModel } = await loadRopaModule<BuildModelModule>("build-model.ts"))
    ;({ renderRopa } = await loadRopaModule<RenderModule>("render.ts"))
    ;({ printJsonLines } = await loadRopaModule<PrintLinesModule>("print-lines.ts"))
  }, 60000)

  describe("buildRopaModel -- synthetic fixtures", () => {
    it("resolves every field-level fact when fully declared", () => {
      const capability = fixtureCapability({
        exportName: "billingData",
        docs: { transferSafeguard: "capability-level SCCs" },
        fields: [
          fixtureField({
            path: ["invoices"],
            docs: {
              dataSubjectCategory: "clients",
              recipientCategories: ["payment processor", "tax authority"],
              transferSafeguard: "field-level SCCs",
              retention: "7 years",
              protections: "encrypted at rest",
            },
            sensitivity: { value: "confidential" },
            purpose: { value: "billing" },
          }),
        ],
      })
      const model = buildRopaModel(fixtureEvidence([capability]), undefined)
      expect(model.records).toEqual([
        {
          capability: "billingData",
          file: "src/user.capability.ts",
          purposesOfProcessing: "billing",
          fields: [
            {
              field: "invoices",
              dataSubjectCategory: "clients",
              personalDataCategory: "confidential",
              recipientCategories: ["payment processor", "tax authority"],
              // Field-level transferSafeguard wins over the capability-level one.
              transferSafeguard: "field-level SCCs",
              retention: "7 years",
              securityMeasures: "encrypted at rest",
            },
          ],
        },
      ])
    })

    it('marks every unset field "Not documented" rather than omitting it', () => {
      const capability = fixtureCapability({
        exportName: "bareData",
        fields: [fixtureField({ path: ["notes"] })],
      })
      const model = buildRopaModel(fixtureEvidence([capability]), undefined)
      const [record] = model.records
      expect(record?.purposesOfProcessing).toBe("Not documented")
      expect(record?.fields[0]).toEqual({
        field: "notes",
        dataSubjectCategory: "Not documented",
        personalDataCategory: "Not documented",
        recipientCategories: ["Not documented"],
        transferSafeguard: "Not documented",
        retention: "Not documented",
        securityMeasures: "Not documented",
      })
    })

    it("falls back to the capability-level transferSafeguard/retention/protections when the field declares none", () => {
      const capability = fixtureCapability({
        docs: {
          transferSafeguard: "capability SCCs",
          retention: "capability retention",
          protections: "capability protections",
        },
        fields: [fixtureField({ path: ["email"] })],
      })
      const model = buildRopaModel(fixtureEvidence([capability]), undefined)
      expect(model.records[0]?.fields[0]).toMatchObject({
        transferSafeguard: "capability SCCs",
        retention: "capability retention",
        securityMeasures: "capability protections",
      })
    })

    it("recipientCategories: an empty declared array is treated the same as absent (Not documented), a populated one is preserved verbatim", () => {
      const empty = fixtureCapability({
        fields: [fixtureField({ path: ["a"], docs: { recipientCategories: [] } })],
      })
      const populated = fixtureCapability({
        fields: [fixtureField({ path: ["b"], docs: { recipientCategories: ["support staff"] } })],
      })
      const model = buildRopaModel(fixtureEvidence([empty, populated]), undefined)
      expect(model.records[0]?.fields[0]?.recipientCategories).toEqual(["Not documented"])
      expect(model.records[1]?.fields[0]?.recipientCategories).toEqual(["support staff"])
    })

    it("aggregates distinct field-level purposes into one deduplicated, semicolon-joined string per capability", () => {
      const capability = fixtureCapability({
        fields: [
          fixtureField({ path: ["a"], purpose: { value: "purpose one" } }),
          fixtureField({ path: ["b"], purpose: { value: "purpose two" } }),
          fixtureField({ path: ["c"], purpose: { value: "purpose one" } }), // duplicate, deduplicated
        ],
      })
      const model = buildRopaModel(fixtureEvidence([capability]), undefined)
      expect(model.records[0]?.purposesOfProcessing).toBe("purpose one; purpose two")
    })

    it("controllerIdentity: present when supplied", () => {
      const controller: ControllerIdentity = { name: "Acme Corp", contact: "privacy@acme.example" }
      const model = buildRopaModel(fixtureEvidence([]), controller)
      expect(model.controllerIdentity).toEqual(controller)
    })

    it('controllerIdentity: "Not documented" when the caller supplies none', () => {
      const model = buildRopaModel(fixtureEvidence([]), undefined)
      expect(model.controllerIdentity).toBe("Not documented")
    })

    it("a capability with zero fields still produces a record, with an empty fields array", () => {
      const model = buildRopaModel(fixtureEvidence([fixtureCapability({ fields: [] })]), undefined)
      expect(model.records).toHaveLength(1)
      expect(model.records[0]?.fields).toEqual([])
      expect(model.records[0]?.purposesOfProcessing).toBe("Not documented")
    })

    it("zero capabilities produces zero records, never throwing", () => {
      const model = buildRopaModel(fixtureEvidence([]), undefined)
      expect(model.records).toEqual([])
    })
  })

  describe("renderRopa -- synthetic fixtures", () => {
    it("renders an explicit not-documented warning, naming controller-identity.ts, when controllerIdentity is absent", () => {
      const model = buildRopaModel(fixtureEvidence([]), undefined)
      const markdown = renderRopa(model)
      expect(markdown).toContain("Not documented")
      expect(markdown).toContain("controller-identity.ts")
    })

    it("renders the supplied controller's name and contact when present, with no representative/dpoContact lines when unset", () => {
      const model = buildRopaModel(fixtureEvidence([]), {
        name: "Acme Corp",
        contact: "privacy@acme.example",
      })
      const markdown = renderRopa(model)
      expect(markdown).toContain("**Name:** Acme Corp")
      expect(markdown).toContain("**Contact:** privacy@acme.example")
      expect(markdown).not.toContain("EU/UK representative")
      expect(markdown).not.toContain("Data Protection Officer")
    })

    it("renders the representative/dpoContact lines when present", () => {
      const model = buildRopaModel(fixtureEvidence([]), {
        name: "Acme Corp",
        contact: "privacy@acme.example",
        representative: "Acme EU Rep, Dublin",
        dpoContact: "dpo@acme.example",
      })
      const markdown = renderRopa(model)
      expect(markdown).toContain("Acme EU Rep, Dublin")
      expect(markdown).toContain("dpo@acme.example")
    })

    it("renders every declared field fact in both the summary table and the per-capability detail table", () => {
      const capability = fixtureCapability({
        exportName: "billingData",
        fields: [
          fixtureField({
            path: ["invoices"],
            docs: {
              dataSubjectCategory: "clients",
              recipientCategories: ["payment processor"],
              transferSafeguard: "SCCs",
              retention: "7 years",
              protections: "encrypted",
            },
            sensitivity: { value: "confidential" },
            purpose: { value: "billing" },
          }),
        ],
      })
      const model = buildRopaModel(fixtureEvidence([capability]), undefined)
      const markdown = renderRopa(model)
      expect(markdown).toContain("`billingData`")
      expect(markdown).toContain("`invoices`")
      expect(markdown).toContain("clients")
      expect(markdown).toContain("payment processor")
      expect(markdown).toContain("SCCs")
      expect(markdown).toContain("7 years")
      expect(markdown).toContain("encrypted")
      // The letter labels every one of the 7 items is keyed by.
      for (const letter of ["(a)", "(b)", "(c)", "(d)", "(e)", "(f)", "(g)"]) {
        expect(markdown).toContain(letter)
      }
    })

    it("reports 'nothing to report' when zero capabilities exist, without throwing", () => {
      const model = buildRopaModel(fixtureEvidence([]), undefined)
      expect(() => renderRopa(model)).not.toThrow()
      expect(renderRopa(model)).toContain("No capability was discovered")
    })
  })

  describe("printJsonLines (build-model.ts's own documented escape hatch)", () => {
    it("prints the model as indented JSON, one line at a time, matching JSON.stringify(value, null, 2)", () => {
      const model = buildRopaModel(fixtureEvidence([]), { name: "Acme", contact: "x@acme.example" })
      const printed: string[] = []
      printJsonLines(model, (line) => printed.push(line))
      expect(printed.join("\n")).toBe(JSON.stringify(model, null, 2))
      expect(printed.length).toBeGreaterThan(1)
    })
  })

  describe("real evidence integration", () => {
    it("produces a sane model against this example's own real capabilities", async () => {
      const { getEvidence } = await loadModuleAt<EvidenceCacheModule>(
        path.join(reportsDir, "evidence-cache.ts"),
      )
      const evidence = await getEvidence()
      const model = buildRopaModel(evidence, { name: "Atlas", contact: "privacy@atlas.example" })

      const byCapability = new Map(model.records.map((r) => [r.capability, r]))
      expect([...byCapability.keys()].sort()).toEqual(["billingData", "identityData", "projectsData"])

      // billingData.invoices declares dataSubjectCategory/recipientCategories/
      // transferSafeguard for real (see src/capabilities/billing.capability.ts)
      // -- proves the new schema fields flow end to end from a real
      // documentData() call through the Evidence Model into this generator.
      const billingInvoices = byCapability.get("billingData")?.fields.find((f) => f.field === "invoices")
      expect(billingInvoices?.dataSubjectCategory).toBe("clients")
      expect(billingInvoices?.recipientCategories).toEqual(["payment processor", "tax authority"])
      expect(billingInvoices?.transferSafeguard).toBe("EU Standard Contractual Clauses")

      // identityData.currentUser declares dataSubjectCategory but nothing
      // else new -- the honest "documented some, not all" real-world case.
      const identityCurrentUser = byCapability
        .get("identityData")
        ?.fields.find((f) => f.field === "currentUser")
      expect(identityCurrentUser?.dataSubjectCategory).toBe("staff members")
      expect(identityCurrentUser?.recipientCategories).toEqual(["Not documented"])

      // projectsData declares none of the new fields at all -- the fully
      // undocumented real-world case.
      const projectsField = byCapability.get("projectsData")?.fields.find((f) => f.field === "projects")
      expect(projectsField?.dataSubjectCategory).toBe("Not documented")
      expect(projectsField?.recipientCategories).toEqual(["Not documented"])
      expect(projectsField?.transferSafeguard).toBe("Not documented")
    }, 60000)
  })
})
