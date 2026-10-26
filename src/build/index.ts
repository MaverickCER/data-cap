// The filesystem capability every public options object below carries as a
// required `fs` field -- `./build` never imports `node:fs` (ADR 0058). The
// `data-cap` CLI supplies a concrete adapter over `node:fs/promises`; a
// consumer running the generators from their own Node build script imports
// that same adapter from `data-cap/node` (`{ nodeBuildFileSystem }`).
export type { BuildDirent, BuildFileSystem, BuildStats } from "./types.js"

export { discoverCapabilityFiles, DEFAULT_INCLUDE } from "./discover.js"
export type { DiscoverOptions } from "./discover.js"

export { positionOf } from "./source-position.js"
export type { SourceLocation, SourcePosition } from "./source-position.js"

export { parseCapabilityFile } from "./parse.js"
export type {
  ImportBinding,
  OperationNames,
  OperationPresenceByKind,
  OperationWritesByKind,
  ParseResult,
  ParseWarning,
  RawCreateDataCall,
  RawDocumentDataCall,
  RawOperationPresence,
  RawOperationWrites,
  SchemaRef,
} from "./parse.js"

export { evaluateLiteral, getStaticPropertyName } from "./literal-eval.js"
export type { LiteralEvalResult } from "./literal-eval.js"

export { linkCapabilityFiles } from "./link.js"
export type { DiscoveredCapability, LinkOptions, LinkResult } from "./link.js"

export { buildInventory, CAPABILITY_MODEL_SCHEMA_VERSION } from "./inventory.js"
export type {
  CapabilityInventory,
  CapabilityNode,
  FieldNode,
  OperationNode,
  ResolvedGovernanceValue,
} from "./inventory.js"

export type {
  ReportFinding,
  ReportFindingCode,
  ReportFindingFamily,
  ReportSeverity,
} from "./findings.js"
export type { DependencyEdge, DependencyRelationship } from "./dependency-types.js"

export { buildFindingModel, locationOf, FINDING_MODEL_SCHEMA_VERSION } from "./finding-model.js"
export type {
  FindingLocation,
  FindingLocationCapability,
  FindingModel,
  LocatedFinding,
} from "./finding-model.js"

export { buildDependencyModel, DEPENDENCY_MODEL_SCHEMA_VERSION } from "./dependency-model.js"
export type { DependencyModel } from "./dependency-model.js"

export { groupEdgesByCapability, groupEdgesByConsumer } from "./dependency-projections.js"
export type {
  DependencyModelCapabilityEdges,
  DependencyModelConsumer,
} from "./dependency-projections.js"

export { checkExclusiveGroups } from "./exclusive-group.js"
export { checkDuplicateEndpoints, checkStructuralDuplication } from "./structural-duplication.js"
export { checkOwnershipAndSensitivity } from "./static-rules.js"

export { findManifestExportCollisions, renderManifest } from "./manifest.js"
export { buildManifestSnapshot, diffManifestSnapshots } from "./manifest-snapshot.js"
export type {
  CitationSnapshotEntry,
  ManifestCapabilityUpdate,
  ManifestChangeReport,
  ManifestFieldDiff,
  ManifestSnapshot,
  ManifestSnapshotCapability,
} from "./manifest-snapshot.js"
export { buildCitationSnapshots, verifyDynamicAccessCitations } from "./citation-verification.js"
export { buildChangeModel, CHANGE_MODEL_SCHEMA_VERSION } from "./change-model.js"
export type {
  BlastRadiusEntry,
  ChangeModel,
  ChangeModelCapability,
  RenamedField,
} from "./change-model.js"

export {
  buildLifecycleModel,
  computeExpiringEntries,
  LIFECYCLE_MODEL_SCHEMA_VERSION,
} from "./lifecycle-model.js"
export type {
  ExpiringEntry,
  LifecycleModel,
  LifecycleModelCapability,
  LifecycleModelField,
} from "./lifecycle-model.js"

export {
  buildRuntimeContractModel,
  RUNTIME_CONTRACT_MODEL_SCHEMA_VERSION,
} from "./runtime-contract-model.js"
export type { RuntimeContractModel, RuntimePolicyFact } from "./runtime-contract-model.js"

export { buildEvidenceModel, EVIDENCE_MODEL_SCHEMA_VERSION } from "./evidence-model.js"
export type {
  EvidenceComputedModels,
  EvidenceModel,
  EvidenceModelInputs,
  EvidenceProvenance,
} from "./evidence-model.js"
// Re-exported from `src/evidence/` (the canonical, isomorphic source) so
// every existing `data-cap/build` import keeps working -- see
// `src/evidence/index.ts`.
export { defineEvidenceProjection } from "../evidence/index.js"
export type {
  EvidenceProjection,
  EvidenceProjectionResult,
  EvidenceProjectionSchema,
  EvidenceProjector,
} from "../evidence/index.js"

export {
  projectFields,
  projectGetters,
  projectMutators,
  projectOperationInventory,
  projectSubscriptions,
} from "./inventory-projections.js"
export type { WithCapability } from "./inventory-projections.js"

export { renderDependencyGraphDot, renderOwnershipGraphDot } from "./graph-export.js"

export { buildSarifLog } from "./sarif.js"
export type { SarifLog } from "./sarif.js"

export {
  projectAuditEvidence,
  projectClassificationEvidence,
  projectComplianceEvidence,
  projectPrivacyEvidence,
  projectRetentionEvidence,
} from "./reference-projections.js"
export type {
  ClassificationEntry,
  ComplianceEntry,
  PrivacyEntry,
  ProjectAuditEvidenceOutput,
  ProjectClassificationEvidenceOutput,
  ProjectComplianceEvidenceOutput,
  ProjectPrivacyEvidenceOutput,
  ProjectRetentionEvidenceOutput,
  RetentionEntry,
} from "./reference-projections.js"

export { buildOpenApiSchemaArtifact } from "./openapi-schema.js"
export type { JsonSchemaLike, OpenApiSchemaArtifact } from "./openapi-schema.js"
export { generateManifest } from "./generate-manifest.js"
export type { GenerateManifestOptions, GenerateManifestResult } from "./generate-manifest.js"

export { renderDocumentation } from "./docs.js"
export { generateDocumentation } from "./generate-documentation.js"
export type {
  GenerateDocumentationOptions,
  GenerateDocumentationResult,
} from "./generate-documentation.js"

export {
  buildOwnershipMatrix,
  buildOwnershipModel,
  OWNERSHIP_MODEL_SCHEMA_VERSION,
  UNOWNED,
} from "./ownership-model.js"
export type {
  OwnershipCapabilityRef,
  OwnershipFieldRef,
  OwnershipMatrixEntry,
  OwnershipModel,
} from "./ownership-model.js"

export { scanDependencies } from "./scan-dependencies.js"
export type { ScanDependenciesOptions, ScanDependenciesResult } from "./scan-dependencies.js"
export { scanFileForUsage } from "./dependency-graph.js"
export type { ImportBindingMatch, ScanTarget } from "./dependency-graph.js"
export { deriveUsageFindings, renderUsageReport } from "./usage-report.js"
export { generateUsage } from "./generate-usage.js"
export type { GenerateUsageOptions, GenerateUsageResult } from "./generate-usage.js"

export { buildFlowGraph } from "./flow-graph.js"
export type { FieldFlow, FlowGraph } from "./flow-graph.js"
export {
  renderCapabilityDiagram,
  renderOverviewDiagram,
  renderSensitivityDiagram,
} from "./flow-diagram.js"
export { generateFlow } from "./generate-flow.js"
export type { GenerateFlowFile, GenerateFlowOptions, GenerateFlowResult } from "./generate-flow.js"

export { generatedBanner, evidenceDisclaimer, isGeneratedFile } from "./generated-banner.js"

export { computeDataArtifacts, generateDataArtifacts } from "./generate-data-artifacts.js"
export { DEFAULT_EXPIRING_WITHIN_DAYS } from "./expiring-window.js"
export type {
  ComputedArtifacts,
  GenerateDataArtifactsOptions,
  ReportResult,
} from "./generate-data-artifacts.js"
export {
  computeSourceFingerprint,
  fingerprintPathFor,
  getEvidenceModel,
  writeEvidenceFingerprint,
} from "./evidence-cache.js"
export type {
  ComputeSourceFingerprintOptions,
  GetEvidenceModelOptions,
  GetEvidenceModelResult,
} from "./evidence-cache.js"
export { checkArtifacts } from "./check-artifacts.js"
export type { CheckArtifactsResult } from "./check-artifacts.js"
export { DataProjectGenerationError } from "./errors.js"

// Field-level data flow, policy, observation and claims (ADR 0070): the sub-models of the one Evidence Model,
// the flow pass that populates them, and the analyses derived from them. Pure queries over a Flow Model
// (`traceFlow`/`filterFlow`/`diffFlow`) are also re-exported by the isomorphic `data-cap/evidence`.
export {
  buildFlowModel,
  FLOW_MODEL_SCHEMA_VERSION,
  flowEdgeId,
  flowNodeId,
  FlowModelError,
} from "../flow/flow-model.js"
export type {
  FlowBoundaryKind,
  FlowCoverage,
  FlowEdge,
  FlowEdgeInput,
  FlowEdgeKind,
  FlowHandling,
  FlowModel,
  FlowModelInput,
  FlowNode,
  FlowNodeInput,
  FlowNodeKind,
  FlowStatus,
  FlowUnknown,
  FlowUnknownInput,
  FlowUnknownReason,
} from "../flow/flow-model.js"
export { diffFlow, filterFlow, traceFlow, traceFlowBetween } from "../flow/flow-projections.js"
export { observedFlow } from "../flow/observed-flow.js"
export type { ObservedFlow } from "../flow/observed-flow.js"
export type {
  FlowDiff,
  FlowFilter,
  FlowNodeChange,
  FlowTrace,
  FlowTraceDirection,
  FlowTraceOptions,
  FlowView,
} from "../flow/flow-projections.js"
export { DEFAULT_FLOW_SINKS, scanFlow } from "./flow-scan.js"
export type { FlowSinkPattern, ScanFlowOptions, ScanFlowResult } from "./flow-scan.js"
export {
  buildPolicyModel,
  collectFlowPolicyRules,
  POLICY_MODEL_SCHEMA_VERSION,
} from "../flow/policy-model.js"
export type {
  FlowPolicyAppliesTo,
  FlowPolicyRule,
  PolicyIndeterminateReason,
  PolicyModel,
  PolicyOutcome,
  PolicyResult,
  PolicySummary,
} from "../flow/policy-model.js"
export {
  buildObservationModel,
  OBSERVATION_MODEL_SCHEMA_VERSION,
} from "../flow/observation-model.js"
export type { Observation, ObservationModel } from "../flow/observation-model.js"
export type {
  ObservationEvent,
  ObservationSink,
  ObservedBoundary,
  ObserveBoundaryInput,
} from "../observe/index.js"
export { buildClaimsModel, CLAIMS_MODEL_SCHEMA_VERSION } from "../flow/claims-model.js"
export type {
  Claim,
  ClaimKind,
  ClaimScope,
  ClaimsModel,
  ClaimsModelInputs,
  ClaimsSummary,
  ClaimVerification,
  EvidenceRef,
  EvidenceRefModel,
} from "../flow/claims-model.js"
export { analyzeLeastData, leastDataFindings } from "../flow/least-data.js"
export type {
  LeastDataCapability,
  LeastDataIndeterminate,
  LeastDataInput,
  LeastDataReport,
  UnusedPath,
  WholeFieldToClient,
} from "../flow/least-data.js"
export { flowAnalysisFindings, policyFindings } from "../flow/flow-findings.js"
// The isomorphic projections and standards adapters, re-exported so one import covers a build script.
export {
  buildFlowGraphView,
  buildOscalAssessmentResults,
  buildProvDocument,
  evaluateEvidenceRules,
  EVIDENCE_RULE_NAMES,
  FLOW_GRAPH_VIEW_VERSION,
  observationsFromOtlp,
  observationsToOtlp,
  parseEvidenceRules,
  renderFlowDot,
  renderFlowMermaid,
  renderFlowText,
} from "../evidence/index.js"
export type {
  EvidenceRules,
  EvidenceRulesResult,
  EvidenceRuleViolation,
  FlowDiagramOptions,
  FlowGraphView,
  FlowTextOptions,
  OscalAssessmentResults,
  OscalOptions,
  OtlpTraces,
  ProvDocument,
} from "../evidence/index.js"
export type { BuildSarifLogOptions } from "./sarif.js"
