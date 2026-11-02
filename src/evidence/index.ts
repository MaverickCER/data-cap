/**
 * `data-cap`'s Evidence Model entry point (`data-cap/evidence`).
 *
 * `defineEvidenceProjection()` is the extensibility mechanism the seven
 * canonical fact models (ADR 0050) exist to serve. A projection is a pure
 * transform from the `EvidenceModel` -- assembled at build time by
 * `generateDataArtifacts()`/`buildEvidenceModel()`
 * (`data-cap/build`, Node-only) -- to any consumer-defined
 * output shape, with read-only enforcement and per-field provenance.
 *
 * This module is deliberately isomorphic: no `node:fs`, no `typescript`, no
 * knowledge of how an `EvidenceModel` gets built -- it only imports that
 * shape as a type (fully erased at compile time under
 * `verbatimModuleSyntax`, mirroring `helpers`' one sanctioned cross-folder
 * edge onto `runtime`). A dashboard backend, an edge function, or a CI step
 * can run a projection over a previously-generated, JSON-deserialized
 * `EvidenceModel` with zero Node dependency, and without pulling in the
 * TypeScript compiler API that `/build` necessarily carries.
 *
 * `data-cap/build` continues to re-export everything here, so
 * existing `/build` imports keep working unchanged -- this directory is the
 * canonical source, `/build` is the compatibility surface.
 */
export { defineEvidenceProjection } from "./define-evidence-projection.js"
export type {
  EvidenceProjection,
  EvidenceProjectionResult,
  EvidenceProjectionSchema,
  EvidenceProjector,
} from "./define-evidence-projection.js"
export type { EvidenceModel, EvidenceProvenance } from "../build/evidence-model.js"

// Pure queries and analyses over the Flow Model (ADR 0070). They live in `src/flow/`, a neutral
// directory with no Node or compiler dependency, so a browser, an edge function or a CI step can
// trace a field through a deserialized `EvidenceModel` exactly as the build can.
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
export { flowEdgeId, flowNodeId } from "../flow/flow-model.js"
export type {
  FlowBoundaryKind,
  FlowCoverage,
  FlowEdge,
  FlowEdgeKind,
  FlowHandling,
  FlowModel,
  FlowNode,
  FlowNodeKind,
  FlowStatus,
  FlowUnknown,
  FlowUnknownReason,
} from "../flow/flow-model.js"
export { analyzeLeastData, leastDataFindings } from "../flow/least-data.js"
export type {
  LeastDataIndeterminate,
  LeastDataReport,
  UnusedPath,
  WholeFieldToClient,
} from "../flow/least-data.js"
export {
  analyzeRedundantTransforms,
  MIN_FORWARDING_HOPS,
  redundantTransformFindings,
} from "../flow/redundant-transform.js"
export type { RedundantTransform, RedundantTransformKind } from "../flow/redundant-transform.js"
export type { FlowEdgeTag, FlowEdgeTagInput, FlowVia } from "../flow/flow-model.js"
export type { Claim, ClaimVerification, ClaimsModel, EvidenceRef } from "../flow/claims-model.js"
export type { Observation, ObservationModel } from "../flow/observation-model.js"
export type { PolicyModel, PolicyOutcome, PolicyResult } from "../flow/policy-model.js"

// Standards adapters and views over the one Evidence Model (ADR 0070): a graph view any renderer can read, its
// textual equivalent, DOT and Mermaid, W3C PROV-JSON, NIST OSCAL assessment-results, and OpenTelemetry. All are pure
// projections; the package renders nothing interactively -- a consumer draws the graph view however it likes.
export { buildFlowGraphView, FLOW_GRAPH_VIEW_VERSION } from "./flow-graph-view.js"
export type {
  FieldDestination,
  FieldView,
  FlowGraphView,
  FlowGraphViewInput,
  FunctionDiscard,
  FunctionEffect,
  FunctionForward,
  FunctionRead,
  FunctionView,
  NodeRef,
  StatusLegendEntry,
  ViewEdge,
  ViewNode,
} from "./flow-graph-view.js"
export { renderFlowText } from "./flow-text.js"
export type { FlowTextOptions } from "./flow-text.js"
export { renderFlowDot } from "./flow-dot.js"
export { renderFlowMermaid } from "./flow-mermaid.js"
export type { DiagramInput, FlowDiagramOptions } from "./flow-diagram-selection.js"
export { buildProvDocument } from "./flow-prov.js"
export type { ProvDocument, ProvInput } from "./flow-prov.js"
export { buildOscalAssessmentResults } from "./flow-oscal.js"
export type { OscalAssessmentResults, OscalInput, OscalOptions } from "./flow-oscal.js"
export { buildCycloneDxBom, renderFlowCycloneDx } from "./flow-cyclonedx.js"
export type {
  CycloneDxAnnotation,
  CycloneDxBom,
  CycloneDxData,
  CycloneDxInput,
  CycloneDxOptions,
  CycloneDxProperty,
  CycloneDxService,
} from "./flow-cyclonedx.js"
export { observationsFromOtlp, observationsToOtlp } from "./flow-otel.js"
export type {
  OtlpAttribute,
  OtlpInput,
  OtlpOptions,
  OtlpReadOptions,
  OtlpReadResult,
  OtlpSpan,
  OtlpTraces,
  OtlpValue,
} from "./flow-otel.js"

// CI enforcement (ADR 0070): deterministic rules evaluated only over the evidence. A rule that needs analysis that did
// not run fails closed, and an unknown or misspelled rule is rejected by name when the rules are parsed.
export { evaluateEvidenceRules, EVIDENCE_RULE_NAMES, parseEvidenceRules } from "./evidence-rules.js"
export type {
  EvidenceRules,
  EvidenceRulesInput,
  EvidenceRulesResult,
  EvidenceRuleViolation,
  ParsedEvidenceRules,
} from "./evidence-rules.js"
