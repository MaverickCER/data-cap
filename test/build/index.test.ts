import { describe, expect, it } from "vitest"
import * as build from "../../src/build/index.js"

describe("build public barrel exports", () => {
  it("exposes discoverCapabilityFiles, parseCapabilityFile, evaluateLiteral, linkCapabilityFiles", () => {
    expect(build.discoverCapabilityFiles).toBeTypeOf("function")
    expect(build.parseCapabilityFile).toBeTypeOf("function")
    expect(build.evaluateLiteral).toBeTypeOf("function")
    expect(build.getStaticPropertyName).toBeTypeOf("function")
    expect(build.linkCapabilityFiles).toBeTypeOf("function")
  })

  it("parseCapabilityFile imported from the barrel behaves identically to the direct module import", () => {
    const result = build.parseCapabilityFile(
      "/project/user.ts",
      `export const userCapability = createData({ fields: { id: "" } });`,
    )
    expect(result.createDataCalls).toHaveLength(1)
  })

  it("exposes the inventory/findings/report-generation surface (C1-C10)", () => {
    expect(build.buildInventory).toBeTypeOf("function")
    expect(build.checkExclusiveGroups).toBeTypeOf("function")
    expect(build.checkStructuralDuplication).toBeTypeOf("function")
    expect(build.checkOwnershipAndSensitivity).toBeTypeOf("function")
    expect(build.renderManifest).toBeTypeOf("function")
    expect(build.generateManifest).toBeTypeOf("function")
    expect(build.renderDocumentation).toBeTypeOf("function")
    expect(build.generateDocumentation).toBeTypeOf("function")
    expect(build.buildOwnershipMatrix).toBeTypeOf("function")
    expect(build.scanDependencies).toBeTypeOf("function")
    expect(build.generateUsage).toBeTypeOf("function")
    expect(build.buildFlowGraph).toBeTypeOf("function")
    expect(build.renderOverviewDiagram).toBeTypeOf("function")
    expect(build.generateFlow).toBeTypeOf("function")
    expect(build.computeDataArtifacts).toBeTypeOf("function")
    expect(build.generateDataArtifacts).toBeTypeOf("function")
    expect(build.checkArtifacts).toBeTypeOf("function")
    expect(build.DataProjectGenerationError).toBeTypeOf("function")
  })

  it("exposes the seven canonical fact models (ADR 0050)", () => {
    expect(build.CAPABILITY_MODEL_SCHEMA_VERSION).toBe(3)
    expect(build.buildDependencyModel).toBeTypeOf("function")
    expect(build.buildOwnershipModel).toBeTypeOf("function")
    expect(build.buildFindingModel).toBeTypeOf("function")
    expect(build.buildChangeModel).toBeTypeOf("function")
    expect(build.buildRuntimeContractModel).toBeTypeOf("function")
    expect(build.buildEvidenceModel).toBeTypeOf("function")
    expect(build.defineEvidenceProjection).toBeTypeOf("function")
  })

  it("re-exports defineEvidenceProjection from src/evidence/, the canonical source (NAM-08)", async () => {
    const evidenceEntry = await import("../../src/evidence/index.js")
    expect(build.defineEvidenceProjection).toBe(evidenceEntry.defineEvidenceProjection)
  })

  it("exposes the reference-projection wave over those models", () => {
    expect(build.projectGetters).toBeTypeOf("function")
    expect(build.projectMutators).toBeTypeOf("function")
    expect(build.projectSubscriptions).toBeTypeOf("function")
    expect(build.projectOperationInventory).toBeTypeOf("function")
    expect(build.projectFields).toBeTypeOf("function")
    expect(build.renderDependencyGraphDot).toBeTypeOf("function")
    expect(build.renderOwnershipGraphDot).toBeTypeOf("function")
    expect(build.buildSarifLog).toBeTypeOf("function")
    expect(build.projectClassificationEvidence).toBeTypeOf("function")
    expect(build.projectPrivacyEvidence).toBeTypeOf("function")
    expect(build.projectRetentionEvidence).toBeTypeOf("function")
    expect(build.projectComplianceEvidence).toBeTypeOf("function")
    expect(build.projectAuditEvidence).toBeTypeOf("function")
    expect(build.buildOpenApiSchemaArtifact).toBeTypeOf("function")
  })

  it("exposes exact source-position evidence (ADR 0052) and citation re-verification (ADR 0053)", () => {
    expect(build.positionOf).toBeTypeOf("function")
    expect(build.buildCitationSnapshots).toBeTypeOf("function")
    expect(build.verifyDynamicAccessCitations).toBeTypeOf("function")
  })
})
