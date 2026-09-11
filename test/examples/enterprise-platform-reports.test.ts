/**
 * Evidence-contract tests for `examples/enterprise-platform`'s three
 * consumer-authored report scripts (`reports/evidence-cache.ts`,
 * `reports/litigation-evidence.ts`, `reports/audit-prep.ts`) -- API-04.
 *
 * Until now these had CLI wiring only: `npm run check` runs each script's own
 * `--check` mode and diffs its committed output byte-for-byte. That catches
 * *drift*, but it cannot distinguish "the report changed because the engine
 * improved" from "the report changed because it broke" -- regenerating the
 * golden makes both look identical. These tests assert the facts each report
 * exists to establish, so a change that quietly inverts one (a sensitive
 * field dropping out of the litigation report, a developer's dynamic-access
 * citation no longer being honored, a finding losing its structured
 * location) fails here even after the golden is refreshed.
 *
 * Pure build-time analysis of this example's own real
 * `src/capabilities/*.capability.ts` declarations: no Mongo, no dev server,
 * no browser -- following env-cap's own
 * `examples/enterprise-platform/evidence/configuration-governance.test.ts`
 * pattern. `main-headless.ts`'s separate assertions cover the running
 * application; these prove the *reports* are right independently of whether
 * the app itself works.
 *
 * @remarks
 * Each report module is loaded through a **non-literal** dynamic import, on
 * purpose. A literal specifier would pull `examples/enterprise-platform`'s
 * sources into the root `tsc` program, and those import
 * `@maverickcer/data-cap/build` -- which resolves to the *built* `dist/`.
 * `npm run verify` runs `typecheck` before `build`, so that would make the
 * root typecheck fail whenever `dist/` is absent or stale, and it would
 * contradict this repo's own stated convention that each example is
 * typechecked by its own `npm run typecheck` in CI, not by the root config
 * (see `tsconfig.json`'s `exclude` comments). The shapes each report is
 * expected to produce are therefore declared right here instead of imported
 * -- which is what a contract test should do anyway: state the contract, and
 * fail when reality stops matching it.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { beforeAll, describe, expect, it } from "vitest"
import { examplesRoot, isInstalled } from "./support.js"

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const reportsDir = path.join(examplesRoot, "enterprise-platform/reports")

// Both gates are real: each example is its own npm project (its
// `node_modules` holds the `file:../..` link these reports import through),
// and the link resolves to `dist/`, so an unbuilt package has nothing to
// import. Skipping matches every other `test/examples/` file's posture.
const runnable = isInstalled("enterprise-platform") && existsSync(path.join(repoRoot, "dist/build.js"))

/** The subset of `EvidenceModel` these reports actually consume -- the contract this example depends on, not the full published type. */
interface ExpectedEvidence {
  readonly schemaVersion: number
  readonly provenance: {
    readonly generatedAt: string
    readonly toolVersion: string
    readonly commit: string | undefined
  }
  readonly computed: {
    readonly dependency: boolean
    readonly ownership: boolean
    readonly finding: boolean
    readonly change: boolean
  }
  readonly capability: { readonly capabilities: readonly { readonly file: string; readonly exportName: string }[] }
  readonly dependency: unknown
  readonly ownership: unknown
  readonly finding: unknown
  readonly change: unknown
}

interface ExpectedSourceLocation {
  readonly file: string
  readonly line: number
  readonly column: number
}

/** The eight declared governance properties every litigation row restates -- named, so a dropped one is a compile error here rather than a silently-missing table column. */
interface ExpectedDeclaredGovernance {
  readonly owner: string | undefined
  readonly sensitivity: string | undefined
  readonly purpose: string | undefined
  readonly legalBasis: string | undefined
  readonly dataResidency: string | readonly string[] | undefined
  readonly auditRequired: boolean | undefined
  readonly protections: string | undefined
  readonly retention: string | undefined
}

interface ExpectedLitigationField {
  readonly capability: string
  readonly field: string
  readonly declared: ExpectedDeclaredGovernance
  readonly consumptionStatus: string
  readonly provenAccessSites: readonly ExpectedSourceLocation[]
  readonly indeterminateSites: readonly ExpectedSourceLocation[]
  readonly dynamicAccessCitations: readonly string[]
  readonly citationIntegrityFindings: readonly { readonly code: string; readonly message: string }[]
  readonly handlingByOperation: readonly {
    readonly operation: string
    readonly direction: string
    readonly endpointName: string
    readonly url: string | undefined
    readonly handling: string | undefined
  }[]
}

interface ExpectedLitigationReport {
  readonly disclaimer: string
  readonly generatedAt: string
  readonly scanSurface: { readonly scanned: readonly string[]; readonly notScanned: string }
  readonly fields: readonly ExpectedLitigationField[]
}

interface ExpectedAuditReport {
  readonly disclaimer: string
  readonly generatedAt: string
  readonly capabilityCount: number
  readonly ownedCapabilities: number | undefined
  readonly unownedCapabilities: number | undefined
  readonly findingsBySeverity: Record<string, number> | undefined
  readonly capabilities: readonly {
    readonly capability: string
    readonly owner: boolean
    readonly sensitivity: boolean
    readonly purpose: boolean
    readonly legalBasis: boolean
    readonly dataResidency: boolean
    readonly auditRequired: boolean
  }[]
  readonly sensitiveFields: readonly {
    readonly capability: string
    readonly field: string
    readonly handlingDeclared: string
  }[]
  readonly findings: readonly {
    readonly code: string
    readonly family: string
    readonly severity: string
    readonly message: string
    readonly location: { readonly kind: string }
  }[]
}

/** `reports/evidence-cache.ts`'s public surface, as this example's other two reports consume it. */
interface EvidenceCacheModule {
  readonly getEvidence: () => Promise<ExpectedEvidence>
  readonly EVIDENCE_PATH: string
  readonly COMPUTE_OPTIONS: { readonly evidence: string }
}

interface LitigationModule {
  readonly generateLitigationEvidenceReport: () => Promise<ExpectedLitigationReport>
}

interface AuditModule {
  readonly generateAuditPrepReport: () => Promise<ExpectedAuditReport>
}

async function loadReportModule<TModule>(fileName: string): Promise<TModule> {
  return (await import(/* @vite-ignore */ path.join(reportsDir, fileName))) as TModule
}

// One full pipeline run feeds every assertion below. These three reports
// share a single `EvidenceModel` by design -- that is precisely what
// `evidence-cache.ts` exists for -- so re-running discovery per test would
// be both slow and a weaker test of the sharing.
let evidence: ExpectedEvidence
let evidencePath: string
let cacheEvidenceOption: string
let litigation: ExpectedLitigationReport
let audit: ExpectedAuditReport

describe.skipIf(!runnable)("example: enterprise-platform report scripts", () => {
  beforeAll(async () => {
    const cache = await loadReportModule<EvidenceCacheModule>("evidence-cache.ts")
    const litigationModule = await loadReportModule<LitigationModule>("litigation-evidence.ts")
    const auditModule = await loadReportModule<AuditModule>("audit-prep.ts")

    evidence = await cache.getEvidence()
    evidencePath = cache.EVIDENCE_PATH
    cacheEvidenceOption = cache.COMPUTE_OPTIONS.evidence
    litigation = await litigationModule.generateLitigationEvidenceReport()
    audit = await auditModule.generateAuditPrepReport()
  }, 180000)

  describe("reports/evidence-cache.ts", () => {
    it("points the cache read and the generated-artifact write at one and the same file", () => {
      // One option, not two: `evidence` is both "where a real run writes the
      // Evidence Model" and "where the cache reads it back from". Two names
      // for one file can drift apart; one cannot.
      expect(cacheEvidenceOption).toBe(evidencePath)
      expect(evidencePath).toBe(
        path.join(examplesRoot, "enterprise-platform/docs/data.evidence.json"),
      )
    })

    it("serves an Evidence Model covering all three of this example's capabilities", () => {
      expect(evidence.schemaVersion).toBeGreaterThanOrEqual(1)
      expect(evidence.capability.capabilities.map((c) => c.exportName).sort()).toEqual([
        "billingData",
        "identityData",
        "projectsData",
      ])
    })

    it("states which sub-models this run actually computed, so absence is never read as a negative finding", () => {
      // `COMPUTE_OPTIONS` requests location + docs + ownership + flow, so the
      // usage scan and the manifest diff both genuinely ran (OUT-04).
      expect(evidence.computed).toEqual({
        dependency: true,
        ownership: true,
        finding: true,
        change: true,
      })
    })

    it("keeps every `computed` flag consistent with whether that sub-model is actually present", () => {
      for (const key of ["dependency", "ownership", "finding", "change"] as const) {
        expect(evidence.computed[key]).toBe(evidence[key] !== undefined)
      }
    })

    it("publishes only root-relative paths -- no machine-specific absolute path reaches a consumer's report", () => {
      expect(JSON.stringify(evidence)).not.toContain(repoRoot)
      for (const capability of evidence.capability.capabilities) {
        expect(path.isAbsolute(capability.file)).toBe(false)
        expect(capability.file.startsWith("src/capabilities/")).toBe(true)
      }
    })

    it("carries required provenance, so a persisted artifact is never anonymous", () => {
      expect(evidence.provenance.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)
      expect(evidence.provenance.toolVersion.length).toBeGreaterThan(0)
      // `commit` is caller-supplied; this example supplies none, and a stated
      // absence is the honest answer -- never a guessed SHA.
      expect(evidence.provenance.commit).toBeUndefined()
    })
  })

  describe("reports/litigation-evidence.ts", () => {
    it("produces the documented top-level report shape", () => {
      expect(Object.keys(litigation).sort()).toEqual([
        "disclaimer",
        "fields",
        "generatedAt",
        "scanSurface",
      ])
      expect(litigation.disclaimer).toContain("does not itself establish compliance")
      expect(litigation.scanSurface.scanned).toContain("application source (src/**)")
      expect(litigation.scanSurface.notScanned).toContain("all other dependencies")
    })

    it("is scoped to declared-sensitive fields only -- one row each, and nothing else", () => {
      expect(litigation.fields.map((f) => `${f.capability}.${f.field}`).sort()).toEqual([
        "billingData.invoices",
        "identityData.currentUser",
        "projectsData.projects",
      ])
      for (const entry of litigation.fields) {
        expect(entry.declared.sensitivity).toBeDefined()
      }
    })

    it("resolves a field with a developer citation to declared-dynamic, carrying the citation itself", () => {
      // Exactly why `billing.capability.ts` declares an
      // `evidence.fields.invoices.dynamicAccess` citation: the legacy
      // compliance-sync utility reads that field through a computed key
      // static analysis cannot attribute on its own.
      const invoices = litigation.fields.find((f) => f.field === "invoices")
      expect(invoices?.consumptionStatus).toBe("declared-dynamic")
      expect(invoices?.dynamicAccessCitations.length).toBeGreaterThan(0)
      expect(invoices?.dynamicAccessCitations[0]).toMatch(
        /^src\/server\/legacy-compliance-sync\.ts:\d+:\d+$/,
      )
      // A citation is an assertion, never a verification -- nothing here may
      // claim the access was proven.
      expect(invoices?.citationIntegrityFindings).toEqual([])
    })

    it("resolves an UNcited dynamically-accessed field to indeterminate, disclosing the candidate sites", () => {
      // `identityData.currentUser` is deliberately NOT cited -- a real,
      // undisclosed gap this report must surface rather than paper over.
      const currentUser = litigation.fields.find((f) => f.field === "currentUser")
      expect(currentUser?.consumptionStatus).toBe("indeterminate")
      expect(currentUser?.dynamicAccessCitations).toEqual([])
      expect(currentUser?.indeterminateSites.length).toBeGreaterThan(0)
      for (const site of currentUser?.indeterminateSites ?? []) {
        expect(path.isAbsolute(site.file)).toBe(false)
        expect(site.file.length).toBeGreaterThan(0)
        expect(site.line).toBeGreaterThanOrEqual(1)
        expect(site.column).toBeGreaterThanOrEqual(1)
      }
    })

    it("distinguishes unconsumed from indeterminate rather than collapsing both into 'unused'", () => {
      const projects = litigation.fields.find((f) => f.field === "projects")
      expect(projects?.consumptionStatus).toBe("unconsumed")
      expect(projects?.indeterminateSites).toEqual([])
    })

    it("reports each field's own declared-handling stages, per writing operation", () => {
      const invoices = litigation.fields.find((f) => f.field === "invoices")
      expect(invoices?.handlingByOperation.length).toBeGreaterThan(0)
      // Every boundary `invoices` crosses declares encryption -- the fact a
      // litigation reviewer is actually asking about.
      expect(invoices?.handlingByOperation.every((stage) => stage.handling === "encrypted")).toBe(
        true,
      )
      for (const stage of invoices?.handlingByOperation ?? []) {
        expect(["input", "output"]).toContain(stage.direction)
        expect(stage.operation).toMatch(/^(getter|mutator|subscription):/)
        expect(stage.endpointName.length).toBeGreaterThan(0)
      }
    })

    it("carries every declared governance property through for each row", () => {
      const invoices = litigation.fields.find((f) => f.field === "invoices")
      expect(Object.keys(invoices?.declared ?? {}).sort()).toEqual([
        "auditRequired",
        "dataResidency",
        "legalBasis",
        "owner",
        "protections",
        "purpose",
        "retention",
        "sensitivity",
      ])
      expect(invoices?.declared.owner).toBeDefined()
      expect(invoices?.declared.sensitivity).toBe("confidential")
    })
  })

  describe("reports/audit-prep.ts", () => {
    it("produces the documented top-level report shape", () => {
      expect(Object.keys(audit).sort()).toEqual([
        "capabilities",
        "capabilityCount",
        "disclaimer",
        "findings",
        "findingsBySeverity",
        "generatedAt",
        "ownedCapabilities",
        "sensitiveFields",
        "unownedCapabilities",
      ])
      expect(audit.disclaimer).toContain("does not itself establish compliance")
    })

    it("rolls up ownership across every discovered capability", () => {
      expect(audit.capabilityCount).toBe(3)
      expect(audit.ownedCapabilities).toBe(3)
      // No `(unowned)` bucket exists at all when every capability has an
      // owner, so this reads `undefined` rather than `0`: "there is no
      // unowned bucket", not "a bucket was counted and held zero".
      expect(audit.unownedCapabilities).toBeUndefined()
    })

    it("renders a per-capability completeness matrix -- presence only, never an adequacy claim", () => {
      expect(audit.capabilities.map((c) => c.capability).sort()).toEqual([
        "billingData",
        "identityData",
        "projectsData",
      ])
      for (const row of audit.capabilities) {
        for (const flag of [
          row.owner,
          row.sensitivity,
          row.purpose,
          row.legalBasis,
          row.dataResidency,
          row.auditRequired,
        ] as const) {
          expect(typeof flag).toBe("boolean")
        }
        // Every capability declares an owner; none declares a
        // capability-level `sensitivity` (it is declared per-field here) --
        // which proves the matrix reports real per-property presence rather
        // than a blanket `true`.
        expect(row.owner).toBe(true)
        expect(row.sensitivity).toBe(false)
      }
    })

    it("reports declared-endpoint handling completeness as a fraction per sensitive field", () => {
      expect(audit.sensitiveFields.map((f) => f.field).sort()).toEqual([
        "currentUser",
        "invoices",
        "projects",
      ])
      for (const row of audit.sensitiveFields) {
        expect(row.handlingDeclared).toMatch(/^\d+\/\d+$/)
      }
      // Every one of `invoices`' declared endpoints states its handling.
      const invoices = audit.sensitiveFields.find((f) => f.field === "invoices")
      const [declared, total] = (invoices?.handlingDeclared ?? "0/0").split("/")
      expect(declared).toBe(total)
    })

    it("carries every finding with both its family and its structured location", () => {
      expect(audit.findings.length).toBeGreaterThan(0)
      for (const finding of audit.findings) {
        expect(["governance", "structural", "usage", "citation", "flow"]).toContain(finding.family)
        expect(["none", "capability", "field", "operation", "consumer"]).toContain(
          finding.location.kind,
        )
        // OUT-02: the flat locators are gone -- `location` is the one path a
        // consumer reads, with nothing redundant beside it to drift.
        expect(Object.keys(finding).sort()).toEqual([
          "code",
          "family",
          "location",
          "message",
          "severity",
        ])
      }
    })

    it("counts findings by severity, matching the findings it actually carries", () => {
      const recounted: Record<string, number> = {}
      for (const finding of audit.findings) {
        recounted[finding.severity] = (recounted[finding.severity] ?? 0) + 1
      }
      expect(audit.findingsBySeverity).toEqual(recounted)
      // This example is a real `--strict-docs`/`--strict-flow` CI subject: it
      // must stay free of blocking errors or its own `guard` script breaks.
      expect(audit.findingsBySeverity?.error ?? 0).toBe(0)
    })
  })

  describe("all three reports read one shared Evidence Model", () => {
    it("agree on the same capability set, rather than each re-deriving its own", () => {
      const fromEvidence = evidence.capability.capabilities.map((c) => c.exportName).sort()
      expect(audit.capabilities.map((c) => c.capability).sort()).toEqual(fromEvidence)
      expect([...new Set(litigation.fields.map((f) => f.capability))].sort()).toEqual(fromEvidence)
    })

    it("stamp an ISO-8601 generatedAt sourced from the Evidence Model's own provenance", () => {
      for (const stamp of [litigation.generatedAt, audit.generatedAt]) {
        expect(stamp).toMatch(/^\d{4}-\d{2}-\d{2}T/)
        expect(Number.isNaN(Date.parse(stamp))).toBe(false)
      }
    })
  })
})
