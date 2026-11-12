# evidence

## Interfaces

### Claim

One claim.

#### Properties

##### contradicting

```ts
readonly contradicting: readonly EvidenceRef[];
```

##### derivedFrom

```ts
readonly derivedFrom: readonly EvidenceRefModel[];
```

Which sub-models this claim was derived from.

##### id

```ts
readonly id: string;
```

Content-addressed.

##### kind

```ts
readonly kind: ClaimKind;
```

##### lastObservedAt?

```ts
readonly lastObservedAt?: string;
```

The latest time any backing observation was seen (ISO 8601, UTC); absent when none carried a time.

##### object

```ts
readonly object: string;
```

Boundary name (`field-reaches-boundary`) or rule id (`policy-holds`).

##### observedPaths?

```ts
readonly observedPaths?: readonly string[];
```

The capability-qualified names of the observed paths that back this claim, sorted and distinct; absent when none did.

##### pathCoverage?

```ts
readonly pathCoverage?: ClaimPathCoverage;
```

Whether those paths cover the claim's whole path scope; present exactly when `observedPaths` is.

##### scope

```ts
readonly scope: ClaimScope;
```

##### statement

```ts
readonly statement: string;
```

Human-readable statement, derived from the structured fields and never parsed.

##### status

```ts
readonly status: FlowStatus;
```

Epistemic status of the underlying fact: the weakest status along the static path, or `observed` for an observation-only claim.

##### subject

```ts
readonly subject: string;
```

Capability-qualified dotted field name.

##### supporting

```ts
readonly supporting: readonly EvidenceRef[];
```

##### verification

```ts
readonly verification: ClaimVerification;
```

***

### ClaimsModel

`data-cap`'s Claims Model.

#### Properties

##### claims

```ts
readonly claims: readonly Claim[];
```

Every claim, ordered by id.

##### schemaVersion

```ts
readonly schemaVersion: 1;
```

Always `CLAIMS_MODEL_SCHEMA_VERSION`.

##### summary

```ts
readonly summary: ClaimsSummary;
```

***

### CycloneDxAnnotation

A CycloneDX annotation.

#### Properties

##### annotator

```ts
readonly annotator: {
  component: {
     name: string;
     type: "application";
     version: string;
  };
};
```

###### component

```ts
readonly component: {
  name: string;
  type: "application";
  version: string;
};
```

###### component.name

```ts
readonly name: string;
```

###### component.type

```ts
readonly type: "application";
```

###### component.version

```ts
readonly version: string;
```

##### bom-ref

```ts
readonly "bom-ref": string;
```

##### subjects

```ts
readonly subjects: readonly string[];
```

##### text

```ts
readonly text: string;
```

##### timestamp

```ts
readonly timestamp: string;
```

***

### CycloneDxBom

The CycloneDX 1.6 document, restricted to what this projection populates.

#### Properties

##### annotations?

```ts
readonly annotations?: readonly CycloneDxAnnotation[];
```

##### bomFormat

```ts
readonly bomFormat: "CycloneDX";
```

##### metadata

```ts
readonly metadata: {
  component: {
     "bom-ref": string;
     name: string;
     type: "application";
  };
  properties: readonly CycloneDxProperty[];
  timestamp: string;
  tools: {
     components: readonly {
        "bom-ref": string;
        name: string;
        type: "application";
        version: string;
     }[];
  };
};
```

###### component

```ts
readonly component: {
  "bom-ref": string;
  name: string;
  type: "application";
};
```

###### component.bom-ref

```ts
readonly "bom-ref": string;
```

###### component.name

```ts
readonly name: string;
```

###### component.type

```ts
readonly type: "application";
```

###### properties

```ts
readonly properties: readonly CycloneDxProperty[];
```

###### timestamp

```ts
readonly timestamp: string;
```

###### tools

```ts
readonly tools: {
  components: readonly {
     "bom-ref": string;
     name: string;
     type: "application";
     version: string;
  }[];
};
```

###### tools.components

```ts
readonly components: readonly {
  "bom-ref": string;
  name: string;
  type: "application";
  version: string;
}[];
```

##### serialNumber

```ts
readonly serialNumber: string;
```

##### services?

```ts
readonly services?: readonly CycloneDxService[];
```

##### specVersion

```ts
readonly specVersion: "1.6";
```

##### version

```ts
readonly version: 1;
```

***

### CycloneDxData

A CycloneDX `serviceData` entry.

#### Properties

##### classification

```ts
readonly classification: string;
```

##### description

```ts
readonly description: string;
```

##### destination?

```ts
readonly destination?: readonly string[];
```

##### flow

```ts
readonly flow: "unknown" | "inbound" | "outbound" | "bi-directional";
```

##### governance?

```ts
readonly governance?: {
  owners: readonly {
     organization: {
        name: string;
     };
  }[];
};
```

###### owners

```ts
readonly owners: readonly {
  organization: {
     name: string;
  };
}[];
```

##### name

```ts
readonly name: string;
```

##### source?

```ts
readonly source?: readonly string[];
```

***

### CycloneDxOptions

Options for `buildCycloneDxBom`.

#### Properties

##### name?

```ts
readonly name?: string;
```

Name of the described system (`metadata.component.name`; default `data-cap data-flow`).

***

### CycloneDxProperty

A CycloneDX name/value property.

#### Properties

##### name

```ts
readonly name: string;
```

##### value

```ts
readonly value: string;
```

***

### CycloneDxService

A CycloneDX service, restricted to what this projection populates.

#### Properties

##### bom-ref

```ts
readonly "bom-ref": string;
```

##### data?

```ts
readonly data?: readonly CycloneDxData[];
```

##### description

```ts
readonly description: string;
```

##### name

```ts
readonly name: string;
```

##### properties

```ts
readonly properties: readonly CycloneDxProperty[];
```

***

### EvidenceModel

`data-cap`'s Evidence Model: the composition of Capability, Lifecycle,
Dependency, Ownership, Finding, Change, and Runtime Contract Model into
one provenance-stamped artifact.

#### Properties

##### capability

```ts
readonly capability: CapabilityInventory;
```

Capability Model.

##### change

```ts
readonly change: ChangeModel | undefined;
```

Change Model, or `undefined` when no manifest diff was available -- see
`computed.change` before reading absence as "nothing changed." Not a
diffable input across two `EvidenceModel`s the way the other five
project-varying fields conceptually are -- it already IS a diff.

##### claims

```ts
readonly claims: ClaimsModel | undefined;
```

Claims Model, derived by `buildEvidenceModel` from `flow` (plus `policy`
and `observation` when present), never supplied by a caller -- one
derivation path, so the claims can never disagree with the facts they
cite. `undefined` exactly when `flow` is.

##### computed

```ts
readonly computed: EvidenceComputedModels;
```

Which of the four optional sub-models below this run actually computed
-- read this before concluding anything from an absent one (OUT-04).

##### dependency

```ts
readonly dependency: DependencyModel | undefined;
```

Dependency Model, or `undefined` when no usage scan was run -- see `computed.dependency` before reading absence as "no dependencies."

##### finding

```ts
readonly finding: FindingModel | undefined;
```

Finding Model, or `undefined` when nothing was supplied -- see `computed.finding` before reading absence as "no findings."

##### flow

```ts
readonly flow: FlowModel | undefined;
```

Flow Model, or `undefined` when no flow pass ran -- see `computed.flow` before reading absence as "no flows."

##### lifecycle

```ts
readonly lifecycle: LifecycleModel;
```

Lifecycle Model -- always populated, for the reason `EvidenceModelInputs.lifecycle` documents.

##### observation

```ts
readonly observation: ObservationModel | undefined;
```

Observation Model, or `undefined` when no observations were ingested -- see `computed.observation` before reading absence as "nothing was observed."

##### ownership

```ts
readonly ownership: OwnershipModel | undefined;
```

Ownership Model, or `undefined` when none was supplied -- see `computed.ownership`.

##### policy

```ts
readonly policy: PolicyModel | undefined;
```

Policy Model, or `undefined` when no rules were evaluated -- see `computed.policy`.

##### provenance

```ts
readonly provenance: EvidenceProvenance;
```

Who/when/what produced this instance -- always present (see `EvidenceProvenance`).

##### runtimeContract

```ts
readonly runtimeContract: RuntimeContractModel;
```

Runtime Contract Model -- always populated, package-scoped rather than
project-scoped (see this module's own doc comment). A static append,
never itself a diffable "changed since last run" input.

##### schemaVersion

```ts
readonly schemaVersion: 3;
```

Always `EVIDENCE_MODEL_SCHEMA_VERSION`.

***

### EvidenceProjection()

The function `defineEvidenceProjection()` returns. Callable directly for
the common case (`projection(evidence)` -> `T`); `.project()` returns the
same value alongside automatic, per-field provenance.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t"></a> `T` *extends* `Record`\<`string`, `unknown`\> |

```ts
EvidenceProjection(evidence): T;
```

The function `defineEvidenceProjection()` returns. Callable directly for
the common case (`projection(evidence)` -> `T`); `.project()` returns the
same value alongside automatic, per-field provenance.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`EvidenceModel`](#evidencemodel) |

#### Returns

`T`

#### Properties

##### project

```ts
readonly project: (evidence) => EvidenceProjectionResult<T>;
```

Declared as a property holding a function, not as a method: what's
actually attached is a closure (`Object.assign(invoke, {project})`) that
never reads `this`, so a consumer is free to destructure or pass it
around. A method signature would claim otherwise and make every such
use look like an unbound-method bug.

###### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`EvidenceModel`](#evidencemodel) |

###### Returns

[`EvidenceProjectionResult`](#evidenceprojectionresult)\<`T`\>

***

### EvidenceProjectionResult

`project()`'s return shape: the computed output, plus which `EvidenceModel` field paths fed each output key.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-1"></a> `T` *extends* `Record`\<`string`, `unknown`\> |

#### Properties

##### sources

```ts
readonly sources: Readonly<Record<keyof T, readonly string[]>>;
```

Per output key, every dotted `EvidenceModel` path that key's own projector actually read, sorted.

##### value

```ts
readonly value: T;
```

The projection's own output -- exactly what calling the projection directly returns.

***

### EvidenceProvenance

Who/when/what produced a given `EvidenceModel` instance -- matching
env-cap's own `EvidenceProvenance` shape exactly, so a consumer reading
both packages' evidence artifacts reads one vocabulary, not two.

`generatedAt`/`toolVersion` are required: every real caller can supply
both (the tool version is `data-cap`'s own installed version, read from
its `package.json` -- see `package-version.ts`), and a provenance stamp
that might be missing either one is a provenance stamp no consumer can
rely on. `commit` stays caller-supplied and explicitly `string |
undefined` (never omitted from the shape): `data-cap` never shells out to
`git` itself, so an absent commit is a stated absence, never a guess --
ADR 0050's "provenance is caller-supplied, never ambient-detected"
convention, kept exactly where it still applies.

#### Properties

##### commit

```ts
readonly commit: string | undefined;
```

The commit SHA this evidence was generated against, or `undefined` when the caller didn't supply one.

##### generatedAt

```ts
readonly generatedAt: string;
```

ISO-8601 timestamp for when this evidence was generated.

##### toolVersion

```ts
readonly toolVersion: string;
```

`data-cap`'s own installed version at generation time.

***

### EvidenceRef

A pointer to one record inside the Evidence Model.

#### Properties

##### id

```ts
readonly id: string;
```

Flow node/edge id, observation id, or `ruleId#fieldNodeId` for a policy result group.

##### model

```ts
readonly model: EvidenceRefModel;
```

***

### EvidenceRules

The rules a gate can enforce. Each is optional; at least one is required.

#### Properties

##### maxContradictedClaims?

```ts
readonly maxContradictedClaims?: number;
```

At most this many claims are contradicted by evidence.

##### maxObservationAgeDays?

```ts
readonly maxObservationAgeDays?: number;
```

Every verified claim was last observed no more than this many days before the evidence was generated
(`provenance.generatedAt`; the check never reads a clock). Fails closed: a verified claim with no observation
time (the recorder was given no `clock`) is a violation, not a skip.

##### maxRedundantTransforms?

```ts
readonly maxRedundantTransforms?: number;
```

At most this many redundant transformations (a needless round trip, a forwarding chain, a derivation nobody reads; ADR 0075).

##### maxUnknowns?

```ts
readonly maxUnknowns?: number;
```

The flow analysis left at most this many unknowns (parts of the program it could not follow).

##### maxUnusedSensitivePaths?

```ts
readonly maxUnusedSensitivePaths?: number;
```

At most this many paths of a sensitive field are never read, forwarded or sent.

##### maxWholeFieldToClient?

```ts
readonly maxWholeFieldToClient?: number;
```

At most this many multi-key fields are sent whole to a client response.

##### minVerifiedClaims?

```ts
readonly minVerifiedClaims?: number;
```

At least this many claims are verified (static or declared, corroborated by an observation).

##### noIndeterminatePolicies?

```ts
readonly noIndeterminatePolicies?: boolean;
```

Every declared flow policy could be decided (none is left `indeterminate`).

##### noPolicyViolations?

```ts
readonly noPolicyViolations?: boolean;
```

No declared flow policy is violated.

##### requireComplete?

```ts
readonly requireComplete?: boolean;
```

The flow analysis is complete: nothing was left unfollowed.

##### requireObservations?

```ts
readonly requireObservations?: boolean;
```

Runtime observations were ingested and there is at least one.

##### requireVerified?

```ts
readonly requireVerified?: readonly string[];
```

Each named policy rule (by id) has every one of its claims verified -- held statically and corroborated at runtime.

***

### EvidenceRulesResult

The verdict.

#### Properties

##### evaluated

```ts
readonly evaluated: readonly (
  | "noPolicyViolations"
  | "noIndeterminatePolicies"
  | "maxContradictedClaims"
  | "maxUnknowns"
  | "requireComplete"
  | "maxUnusedSensitivePaths"
  | "maxWholeFieldToClient"
  | "requireObservations"
  | "minVerifiedClaims"
  | "requireVerified"
  | "maxObservationAgeDays"
  | "maxRedundantTransforms")[];
```

The rules that were evaluated, in order.

##### ok

```ts
readonly ok: boolean;
```

True exactly when there are no violations.

##### violations

```ts
readonly violations: readonly EvidenceRuleViolation[];
```

***

### EvidenceRuleViolation

One reason the gate did not pass.

#### Properties

##### evidence

```ts
readonly evidence: readonly EvidenceRef[];
```

The records in the evidence this rests on, for drill-down.

##### message

```ts
readonly message: string;
```

##### rule

```ts
readonly rule: 
  | "noPolicyViolations"
  | "noIndeterminatePolicies"
  | "maxContradictedClaims"
  | "maxUnknowns"
  | "requireComplete"
  | "maxUnusedSensitivePaths"
  | "maxWholeFieldToClient"
  | "requireObservations"
  | "minVerifiedClaims"
  | "requireVerified"
  | "maxObservationAgeDays"
  | "maxRedundantTransforms";
```

Which rule.

***

### FieldDestination

A boundary a field's data reaches.

#### Properties

##### boundary

```ts
readonly boundary: string;
```

##### boundaryKind?

```ts
readonly boundaryKind?: FlowBoundaryKind;
```

##### boundaryName

```ts
readonly boundaryName: string;
```

##### handling

```ts
readonly handling: readonly FlowHandling[];
```

##### paths

```ts
readonly paths: readonly (readonly string[])[];
```

Every path of the field that reaches it; `[]` is the whole field.

##### status

```ts
readonly status: FlowStatus;
```

The weakest status among the edges that carry it there.

***

### FieldView

Everything the evidence says about one field.

#### Properties

##### claims

```ts
readonly claims: readonly string[];
```

Ids of the claims about this field or a path inside it.

##### classification?

```ts
readonly classification?: string;
```

##### complete

```ts
readonly complete: boolean;
```

False when the field's trace touches something the analysis could not follow.

##### destinations

```ts
readonly destinations: readonly FieldDestination[];
```

##### discardedBy

```ts
readonly discardedBy: readonly {
  function: string;
  functionName: string;
  path: readonly string[];
}[];
```

##### id

```ts
readonly id: string;
```

##### name

```ts
readonly name: string;
```

##### readers

```ts
readonly readers: readonly {
  function: string;
  functionName: string;
}[];
```

##### scope

```ts
readonly scope: string;
```

##### sources

```ts
readonly sources: readonly {
  boundary: string;
  boundaryKind?: FlowBoundaryKind;
  boundaryName: string;
  handling?: FlowHandling;
  status: FlowStatus;
}[];
```

Declared sources of the field's data.

***

### FlowCoverage

What was and was not analyzed -- a projection must not call a graph complete unless `complete`.

#### Properties

##### complete

```ts
readonly complete: boolean;
```

True only when nothing above is non-zero apart from `functionsAnalyzed`.

##### edgesUnresolved

```ts
readonly edgesUnresolved: number;
```

Edges whose status is `unknown`.

##### functionsAnalyzed

```ts
readonly functionsAnalyzed: number;
```

Function nodes whose status is not `unknown`.

##### functionsUnanalyzed

```ts
readonly functionsUnanalyzed: number;
```

Function nodes whose status is `unknown`.

##### unknowns

```ts
readonly unknowns: number;
```

Number of `FlowUnknown` records.

***

### FlowDiagramOptions

Options shared by the diagram renderers.

#### Properties

##### field?

```ts
readonly field?: string;
```

Draw only this field's flow (by name, for example `userData.user`).

##### includeCalls?

```ts
readonly includeCalls?: boolean;
```

Draw control-flow `calls` edges (default false: they obscure the data).

##### path?

```ts
readonly path?: readonly string[];
```

Within `field`, draw only flow of this path (and of the whole field).

***

### FlowDiff

What changed between two Flow Models, by content-addressed id.

#### Properties

##### addedEdges

```ts
readonly addedEdges: readonly FlowEdge[];
```

##### addedNodes

```ts
readonly addedNodes: readonly FlowNode[];
```

##### addedUnknowns

```ts
readonly addedUnknowns: readonly FlowUnknown[];
```

##### changedNodes

```ts
readonly changedNodes: readonly FlowNodeChange[];
```

##### removedEdges

```ts
readonly removedEdges: readonly FlowEdge[];
```

##### removedNodes

```ts
readonly removedNodes: readonly FlowNode[];
```

##### removedUnknowns

```ts
readonly removedUnknowns: readonly FlowUnknown[];
```

##### unchanged

```ts
readonly unchanged: boolean;
```

True when nothing was added, removed or changed.

***

### FlowEdge

One edge of the Flow Model.

#### Extends

- [`FlowEdgeInput`](build.md#flowedgeinput)

#### Properties

##### from

```ts
readonly from: string;
```

Id of the source node.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`from`](build.md#from-1)

##### handling?

```ts
readonly handling?: FlowHandling;
```

The data-safety state of the value at this hop, when declared or established -- policy evaluation reads it at boundary crossings.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`handling`](build.md#handling)

##### id

```ts
readonly id: string;
```

Content-addressed: `kind:from->to[:path]@status[^origin]`.

##### kind

```ts
readonly kind: FlowEdgeKind;
```

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`kind`](build.md#kind-2)

##### origin?

```ts
readonly origin?: string;
```

Id of the `field` node whose data this edge carries. Present on every
data-carrying edge the flow pass derives, so a helper shared by several
fields does not make each field appear to reach every other field's
destinations. Absent on edges that are not about one field's data (a
`calls` edge). `path` is expressed in the origin field's frame.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`origin`](build.md#origin)

##### path?

```ts
readonly path?: readonly string[];
```

The field path this edge carries, for a field-sensitive edge; absent for an edge about the whole value or about control.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`path`](build.md#path-1)

##### source?

```ts
readonly source?: SourceLocation;
```

Where in source this edge arises (a call site, a read), when known.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`source`](build.md#source)

##### status

```ts
readonly status: FlowStatus;
```

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`status`](build.md#status)

##### to

```ts
readonly to: string;
```

Id of the target node.

###### Inherited from

[`FlowEdgeInput`](build.md#flowedgeinput).[`to`](build.md#to-1)

***

### FlowEdgeTag

One tag of the Flow Model.

#### Extends

- [`FlowEdgeTagInput`](#flowedgetaginput)

#### Properties

##### edge

```ts
readonly edge: string;
```

Id of the existing edge that carries the data at this place (an edge id as `flowEdgeId` derives it).

###### Inherited from

[`FlowEdgeTagInput`](#flowedgetaginput).[`edge`](#edge-1)

##### fresh?

```ts
readonly fresh?: true;
```

With `copy`: the value copied was already a fresh copy.

###### Inherited from

[`FlowEdgeTagInput`](#flowedgetaginput).[`fresh`](#fresh-1)

##### id

```ts
readonly id: string;
```

Content-addressed: `tag:via:edgeId@file:line:column`.

##### source

```ts
readonly source: SourceLocation;
```

Where the copy, the derivation or the hand-over is.

###### Inherited from

[`FlowEdgeTagInput`](#flowedgetaginput).[`source`](#source-3)

##### unused?

```ts
readonly unused?: true;
```

With `derive`: nothing ever reads the derived value.

###### Inherited from

[`FlowEdgeTagInput`](#flowedgetaginput).[`unused`](#unused-1)

##### via

```ts
readonly via: FlowVia;
```

###### Inherited from

[`FlowEdgeTagInput`](#flowedgetaginput).[`via`](#via-1)

***

### FlowEdgeTagInput

One tag as a producer supplies it -- the id is derived, never supplied.

#### Extended by

- [`FlowEdgeTag`](#flowedgetag)

#### Properties

##### edge

```ts
readonly edge: string;
```

Id of the existing edge that carries the data at this place (an edge id as `flowEdgeId` derives it).

##### fresh?

```ts
readonly fresh?: true;
```

With `copy`: the value copied was already a fresh copy.

##### source

```ts
readonly source: SourceLocation;
```

Where the copy, the derivation or the hand-over is.

##### unused?

```ts
readonly unused?: true;
```

With `derive`: nothing ever reads the derived value.

##### via

```ts
readonly via: FlowVia;
```

***

### FlowFilter

Criteria for `filterFlow`; every supplied criterion must match.

#### Properties

##### classification?

```ts
readonly classification?: string;
```

Exact `classification` match.

##### edgePathIncludes?

```ts
readonly edgePathIncludes?: string;
```

Keep only edges with a path segment equal to this value (applied to edges, not nodes).

##### kinds?

```ts
readonly kinds?: readonly FlowNodeKind[];
```

##### nameIncludes?

```ts
readonly nameIncludes?: string;
```

Case-insensitive substring of the node name.

##### scope?

```ts
readonly scope?: string;
```

Exact `scope` match (a root-relative file path, or a boundary namespace).

##### statuses?

```ts
readonly statuses?: readonly FlowStatus[];
```

***

### FlowGraphView

The graph view.

#### Properties

##### claims?

```ts
readonly claims?: Readonly<Record<ClaimVerification, number>>;
```

Counts of claims by verification status, when claims were derived.

##### coverage

```ts
readonly coverage: FlowCoverage;
```

##### edges

```ts
readonly edges: readonly ViewEdge[];
```

##### fields

```ts
readonly fields: readonly FieldView[];
```

##### functions

```ts
readonly functions: readonly FunctionView[];
```

##### nodes

```ts
readonly nodes: readonly ViewNode[];
```

##### schemaVersion

```ts
readonly schemaVersion: 1;
```

##### statusLegend

```ts
readonly statusLegend: readonly StatusLegendEntry[];
```

##### unknowns

```ts
readonly unknowns: readonly FlowUnknown[];
```

***

### FlowModel

`data-cap`'s Flow Model.

#### Properties

##### coverage

```ts
readonly coverage: FlowCoverage;
```

What was and was not analyzed.

##### edges

```ts
readonly edges: readonly FlowEdge[];
```

Every edge, ordered by id.

##### edgeTags?

```ts
readonly edgeTags?: readonly FlowEdgeTag[];
```

What the scanner saw happen to the data of some edges, ordered by id. Absent when it saw nothing worth noting (ADR 0075).

##### nodes

```ts
readonly nodes: readonly FlowNode[];
```

Every node, ordered by id.

##### schemaVersion

```ts
readonly schemaVersion: 1;
```

Always `FLOW_MODEL_SCHEMA_VERSION`.

##### unknowns

```ts
readonly unknowns: readonly FlowUnknown[];
```

Every explicit unknown, ordered by id.

***

### FlowNode

One node of the Flow Model.

#### Extends

- [`FlowNodeInput`](build.md#flownodeinput)

#### Properties

##### boundaryKind?

```ts
readonly boundaryKind?: FlowBoundaryKind;
```

What kind of boundary this is; only meaningful (and required by policy evaluation) on a `boundary` node.

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`boundaryKind`](build.md#boundarykind)

##### classification?

```ts
readonly classification?: string;
```

Declared or inherited sensitivity classification, when known -- carried verbatim, never inferred here.

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`classification`](build.md#classification)

##### id

```ts
readonly id: string;
```

Content-addressed: `kind:scope#name`.

##### kind

```ts
readonly kind: FlowNodeKind;
```

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`kind`](build.md#kind-3)

##### name

```ts
readonly name: string;
```

Name unique within `scope` and `kind` (`buildUserProfile`, `buildUserProfile.user`, `User.email`).

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`name`](build.md#name-3)

##### scope

```ts
readonly scope: string;
```

Root-relative POSIX path of the file that declares this node, or a stable namespace for a node with no file (a boundary).

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`scope`](build.md#scope)

##### source?

```ts
readonly source?: SourcePosition;
```

Declaration position within `scope`, when there is one.

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`source`](build.md#source-1)

##### status

```ts
readonly status: FlowStatus;
```

###### Inherited from

[`FlowNodeInput`](build.md#flownodeinput).[`status`](build.md#status-1)

***

### FlowNodeChange

A node whose content differs between two revisions under the same id.

#### Properties

##### after

```ts
readonly after: FlowNode;
```

##### before

```ts
readonly before: FlowNode;
```

***

### FlowTextOptions

Options for `renderFlowText`.

#### Properties

##### field?

```ts
readonly field?: string;
```

Limit the output to one field (by its name, for example `userData.user`) and the functions that touch it.

##### headingLevel?

```ts
readonly headingLevel?: number;
```

Heading level of the title (default 1); sections nest below it, so the text can be embedded in a larger document.

***

### FlowTrace

The result of `traceFlow`.

#### Properties

##### complete

```ts
readonly complete: boolean;
```

False when the trace crossed or touched any `unknown` fact: the real flow may reach further than shown.

##### direction

```ts
readonly direction: FlowTraceDirection;
```

Which way data edges were followed.

##### edges

```ts
readonly edges: readonly FlowEdge[];
```

Every traversed edge, ordered by id.

##### nodes

```ts
readonly nodes: readonly FlowNode[];
```

Every visited node, ordered by id.

##### start

```ts
readonly start: string;
```

Id of the node the trace started from.

##### unknowns

```ts
readonly unknowns: readonly FlowUnknown[];
```

Every explicit unknown attached to a visited node.

***

### FlowTraceOptions

Options narrowing a trace.

#### Properties

##### path?

```ts
readonly path?: readonly string[];
```

Follow only hops whose edge path is related (equal, prefix, or extension) to this path; an edge with no path applies to every path.

##### statuses?

```ts
readonly statuses?: readonly FlowStatus[];
```

Follow only edges, and visit only nodes, with one of these statuses.

***

### FlowUnknown

An explicit record that part of the program could not be analyzed.

#### Extends

- [`FlowUnknownInput`](build.md#flowunknowninput)

#### Properties

##### data?

```ts
readonly data?: readonly FlowUnknownData[];
```

The tracked data that entered the part of the program that could not be
followed. Absent means "unknown which data" -- every trace that reaches
the subject must treat itself as incomplete. Present, it lets a trace of
a different field or an unrelated path stay complete: an opaque call that
only ever saw `email` says nothing about where `passwordHash` went.

###### Inherited from

[`FlowUnknownInput`](build.md#flowunknowninput).[`data`](build.md#data)

##### detail?

```ts
readonly detail?: string;
```

Human-readable detail (never parsed).

###### Inherited from

[`FlowUnknownInput`](build.md#flowunknowninput).[`detail`](build.md#detail)

##### id

```ts
readonly id: string;
```

Content-addressed: `unknown:reason:file:line:column`.

##### reason

```ts
readonly reason: FlowUnknownReason;
```

###### Inherited from

[`FlowUnknownInput`](build.md#flowunknowninput).[`reason`](build.md#reason)

##### source

```ts
readonly source: SourceLocation;
```

Where the unanalyzable construct is.

###### Inherited from

[`FlowUnknownInput`](build.md#flowunknowninput).[`source`](build.md#source-2)

##### subject?

```ts
readonly subject?: string;
```

The node this unknown prevents us from fully describing, when there is one.

###### Inherited from

[`FlowUnknownInput`](build.md#flowunknowninput).[`subject`](build.md#subject)

***

### FlowView

A filtered view: never mistakable for the whole graph.

#### Properties

##### complete

```ts
readonly complete: boolean;
```

True only when nothing was hidden and the source model was itself complete.

##### edges

```ts
readonly edges: readonly FlowEdge[];
```

##### hiddenEdges

```ts
readonly hiddenEdges: number;
```

Edges removed by the filter.

##### hiddenNodes

```ts
readonly hiddenNodes: number;
```

Nodes removed by the filter.

##### nodes

```ts
readonly nodes: readonly FlowNode[];
```

##### unknowns

```ts
readonly unknowns: readonly FlowUnknown[];
```

***

### FunctionDiscard

A path of a field the function received and neither used nor forwarded.

#### Properties

##### field

```ts
readonly field: string;
```

##### origin

```ts
readonly origin: string;
```

##### path

```ts
readonly path: readonly string[];
```

***

### FunctionEffect

Data a function sends across a boundary.

#### Properties

##### boundary

```ts
readonly boundary: string;
```

##### boundaryKind?

```ts
readonly boundaryKind?: FlowBoundaryKind;
```

##### boundaryName

```ts
readonly boundaryName: string;
```

##### field

```ts
readonly field: string;
```

##### handling?

```ts
readonly handling?: FlowHandling;
```

##### origin

```ts
readonly origin: string;
```

##### path

```ts
readonly path: readonly string[];
```

##### status

```ts
readonly status: FlowStatus;
```

***

### FunctionForward

Data a function hands on: to a parameter, as its return value, or transformed.

#### Properties

##### field

```ts
readonly field: string;
```

##### kind

```ts
readonly kind: "transforms" | "passes" | "returns";
```

##### origin

```ts
readonly origin: string;
```

##### path

```ts
readonly path: readonly string[];
```

##### status

```ts
readonly status: FlowStatus;
```

##### to

```ts
readonly to: string;
```

##### toName

```ts
readonly toName: string;
```

***

### FunctionRead

Data a function takes in.

#### Properties

##### field

```ts
readonly field: string;
```

##### from

```ts
readonly from: string;
```

Id of the node it arrived from.

##### origin

```ts
readonly origin: string;
```

The field the data comes from.

##### path

```ts
readonly path: readonly string[];
```

Path inside the field.

##### status

```ts
readonly status: FlowStatus;
```

##### via

```ts
readonly via: "field" | "parameter" | "return";
```

How it arrived: read from the field itself, through a parameter, or as another function's return value.

***

### FunctionView

Everything the evidence says about one function.

#### Properties

##### callees

```ts
readonly callees: readonly NodeRef[];
```

##### callers

```ts
readonly callers: readonly NodeRef[];
```

##### classifications

```ts
readonly classifications: readonly string[];
```

Distinct classifications of the fields whose data this function touches.

##### confidence

```ts
readonly confidence: FlowStatus;
```

The weakest status of the evidence behind this function; `inferred` when part of it could not be followed.

##### discards

```ts
readonly discards: readonly FunctionDiscard[];
```

##### forwards

```ts
readonly forwards: readonly FunctionForward[];
```

##### id

```ts
readonly id: string;
```

##### inputs

```ts
readonly inputs: readonly NodeRef[];
```

##### name

```ts
readonly name: string;
```

##### output?

```ts
readonly output?: string;
```

##### reads

```ts
readonly reads: readonly FunctionRead[];
```

##### scope

```ts
readonly scope: string;
```

##### sideEffects

```ts
readonly sideEffects: readonly FunctionEffect[];
```

##### source?

```ts
readonly source?: {
  column: number;
  line: number;
};
```

###### column

```ts
readonly column: number;
```

###### line

```ts
readonly line: number;
```

##### status

```ts
readonly status: FlowStatus;
```

##### unknowns

```ts
readonly unknowns: readonly string[];
```

Ids of the explicit unknowns attached to this function.

***

### LeastDataIndeterminate

A field (or some of its paths) this analysis could not assess, and why.

#### Properties

##### capability

```ts
readonly capability: LeastDataCapability;
```

##### field

```ts
readonly field: string;
```

##### fieldNode

```ts
readonly fieldNode: string;
```

##### paths

```ts
readonly paths: readonly (readonly string[])[];
```

The single-key paths that could not be assessed; every other key of the field was.

##### reason

```ts
readonly reason: "flow-incomplete" | "not-analyzed";
```

***

### LeastDataReport

The result of `analyzeLeastData`.

#### Properties

##### indeterminate

```ts
readonly indeterminate: readonly LeastDataIndeterminate[];
```

##### unusedPaths

```ts
readonly unusedPaths: readonly UnusedPath[];
```

##### wholeFieldToClient

```ts
readonly wholeFieldToClient: readonly WholeFieldToClient[];
```

***

### NodeRef

A reference to a node by id and name.

#### Properties

##### id

```ts
readonly id: string;
```

##### name

```ts
readonly name: string;
```

***

### Observation

One aggregated observation.

#### Properties

##### boundary

```ts
readonly boundary: {
  kind: FlowBoundaryKind;
  name: string;
};
```

###### kind

```ts
readonly kind: FlowBoundaryKind;
```

###### name

```ts
readonly name: string;
```

##### count

```ts
readonly count: number;
```

How many matching events were recorded.

##### field

```ts
readonly field: string;
```

Capability-qualified dotted field path -- the Flow Model's field-node naming.

##### firstSeen?

```ts
readonly firstSeen?: string;
```

Earliest time any matching event carried (ISO 8601, UTC); absent when none carried one. Never used in the id.

##### handling?

```ts
readonly handling?: FlowHandling;
```

##### id

```ts
readonly id: string;
```

Content-addressed: `observation:scope|kind:boundary|field|handling-or-dash`.

##### lastSeen?

```ts
readonly lastSeen?: string;
```

Latest time any matching event carried; present exactly when `firstSeen` is.

##### scope

```ts
readonly scope: string;
```

##### status

```ts
readonly status: "observed";
```

Always `observed` (ADR 0071).

***

### ObservationModel

`data-cap`'s Observation Model.

#### Properties

##### observations

```ts
readonly observations: readonly Observation[];
```

Every observation, ordered by id.

##### schemaVersion

```ts
readonly schemaVersion: 1;
```

Always `OBSERVATION_MODEL_SCHEMA_VERSION`.

##### scopes

```ts
readonly scopes: readonly string[];
```

Every distinct scope that contributed at least one observation, sorted.

##### scopeTimes?

```ts
readonly scopeTimes?: readonly ObservationScopeTimes[];
```

First/last seen per scope, ordered by scope; absent when no event carried a time.

##### skipped

```ts
readonly skipped: number;
```

Events (and skip reports) dropped as malformed -- stated, never silent.

##### truncatedScopes?

```ts
readonly truncatedScopes?: readonly string[];
```

The scopes with a truncation, sorted -- a claim built on one cannot be called verified near the cut. Absent when none.

##### truncations?

```ts
readonly truncations?: readonly ObservationTruncation[];
```

What the recorder reported leaving out, ordered by scope, field, reason; absent when it reported nothing.

***

### ObservedFlow

What was witnessed.

#### Properties

##### edges

```ts
readonly edges: readonly FlowEdge[];
```

The edges on a witnessed route, ordered by id.

##### explained

```ts
readonly explained: readonly Observation[];
```

Observations (in the selected scope) the static flow carries a route for.

##### nodes

```ts
readonly nodes: readonly FlowNode[];
```

The nodes on a witnessed route, ordered by id.

##### scopes

```ts
readonly scopes: readonly string[];
```

Every scope that contributed any observation, whichever was selected.

##### unexplained

```ts
readonly unexplained: readonly Observation[];
```

Observations (in the selected scope) it does not.

***

### OscalAssessmentResults

The OSCAL assessment-results document, restricted to what this projection populates.

#### Properties

##### assessment-results

```ts
readonly "assessment-results": {
  "back-matter"?: {
     resources: readonly {
        description: string;
        rlinks: readonly {
           href: string;
           "media-type": string;
        }[];
        title: string;
        uuid: string;
     }[];
  };
  "import-ap": {
     href: string;
     remarks?: string;
  };
  metadata: {
     "last-modified": string;
     "oscal-version": string;
     remarks: string;
     title: string;
     version: string;
  };
  results: readonly {
     description: string;
     end: string;
     findings?: readonly {
        description: string;
        "related-observations"?: readonly {
           "observation-uuid": string;
        }[];
        target: {
           status: {
              reason: "pass" | "fail" | "other";
              remarks?: string;
              state: "satisfied" | "not-satisfied";
           };
           "target-id": string;
           type: "objective-id" | "statement-id";
        };
        title: string;
        uuid: string;
     }[];
     observations?: readonly {
        collected: string;
        description: string;
        methods: readonly ("EXAMINE" | "TEST")[];
        "relevant-evidence"?: readonly {
           description: string;
           href?: string;
        }[];
        types: readonly string[];
        uuid: string;
     }[];
     props?: readonly {
        name: string;
        value: string;
     }[];
     "reviewed-controls": {
        "control-selections": readonly {
           description?: string;
           "include-controls"?: readonly {
              "control-id": string;
           }[];
        }[];
     };
     start: string;
     title: string;
     uuid: string;
  }[];
  uuid: string;
};
```

###### back-matter?

```ts
readonly "back-matter"?: {
  resources: readonly {
     description: string;
     rlinks: readonly {
        href: string;
        "media-type": string;
     }[];
     title: string;
     uuid: string;
  }[];
};
```

One resource per evidence reference, each resolving to the evidence file; present only with `evidenceHref`.

###### back-matter.resources

```ts
readonly resources: readonly {
  description: string;
  rlinks: readonly {
     href: string;
     "media-type": string;
  }[];
  title: string;
  uuid: string;
}[];
```

###### import-ap

```ts
readonly "import-ap": {
  href: string;
  remarks?: string;
};
```

###### import-ap.href

```ts
readonly href: string;
```

###### import-ap.remarks?

```ts
readonly remarks?: string;
```

###### metadata

```ts
readonly metadata: {
  "last-modified": string;
  "oscal-version": string;
  remarks: string;
  title: string;
  version: string;
};
```

###### metadata.last-modified

```ts
readonly "last-modified": string;
```

###### metadata.oscal-version

```ts
readonly "oscal-version": string;
```

###### metadata.remarks

```ts
readonly remarks: string;
```

The shared evidence disclaimer: this document supports a review and establishes nothing by itself.

###### metadata.title

```ts
readonly title: string;
```

###### metadata.version

```ts
readonly version: string;
```

###### results

```ts
readonly results: readonly {
  description: string;
  end: string;
  findings?: readonly {
     description: string;
     "related-observations"?: readonly {
        "observation-uuid": string;
     }[];
     target: {
        status: {
           reason: "pass" | "fail" | "other";
           remarks?: string;
           state: "satisfied" | "not-satisfied";
        };
        "target-id": string;
        type: "objective-id" | "statement-id";
     };
     title: string;
     uuid: string;
  }[];
  observations?: readonly {
     collected: string;
     description: string;
     methods: readonly ("EXAMINE" | "TEST")[];
     "relevant-evidence"?: readonly {
        description: string;
        href?: string;
     }[];
     types: readonly string[];
     uuid: string;
  }[];
  props?: readonly {
     name: string;
     value: string;
  }[];
  "reviewed-controls": {
     "control-selections": readonly {
        description?: string;
        "include-controls"?: readonly {
           "control-id": string;
        }[];
     }[];
  };
  start: string;
  title: string;
  uuid: string;
}[];
```

###### uuid

```ts
readonly uuid: string;
```

***

### OscalOptions

Options for `buildOscalAssessmentResults`.

#### Properties

##### assessmentPlan?

```ts
readonly assessmentPlan?: string;
```

`href` of the assessment plan this result imports. OSCAL requires one; without it the document
carries the placeholder `#data-cap-assessment-plan` and says so in `import-ap.remarks`, which is
enough for review and nothing an OSCAL tool-chain should resolve. See [strict](#strict).

##### controls

```ts
readonly controls: Readonly<Record<string, readonly string[]>>;
```

data-cap rule id (as in `evidence.policy.rules[].id`, for example `userData/no-pii-to-log`) to the
control ids it is evidence for. Never inferred. A control id (`ac-4`) is targeted at its
assessment objective (`ac-4_obj`), the part id NIST's SP 800-53 OSCAL catalog gives it; an id that
already names a part (`ac-4_obj`, `ac-4_smt`, `ac-4_smt.a`) is targeted as given. Name each
objective once: `ac-4` and `ac-4_obj` are the same target and would give two findings.

##### evidenceHref?

```ts
readonly evidenceHref?: string;
```

`href` the evidence file is reachable at from where the document will live (for example
`docs/data.evidence.json`). With it, every evidence reference becomes a back-matter resource
with an `rlink`, and each observation's `relevant-evidence` points at that resource, so a
tool-chain can follow the trail; without it the references stay descriptive text.

##### strict?

```ts
readonly strict?: boolean;
```

Refuse to build a document a tool-chain could not use: `true` requires [assessmentPlan](#assessmentplan)
and [evidenceHref](#evidencehref), and throws when either is missing. The default builds the reviewable
document with placeholders named as such.

##### title?

```ts
readonly title?: string;
```

Document title (default `data-cap data-flow assessment`).

***

### OtlpAttribute

An OTLP/JSON attribute.

#### Properties

##### key

```ts
readonly key: string;
```

##### value

```ts
readonly value: OtlpValue;
```

***

### OtlpOptions

Options for `observationsToOtlp`.

#### Properties

##### scopeRoots?

```ts
readonly scopeRoots?: boolean;
```

Also emit one root span per scope (`data_cap.scope.root = "true"`, spanning the scope's first..last seen when the
scope carried times) and point each observation span of that scope at it with `parentSpanId`. Off by default so
the flat output stays byte-identical. The reader skips roots without counting them.

##### serviceName?

```ts
readonly serviceName?: string;
```

`service.name` of the resource (default `data-cap`).

***

### OtlpReadOptions

Options for `observationsFromOtlp`.

#### Properties

##### maxEventsPerSpan?

```ts
readonly maxEventsPerSpan?: number;
```

The most events one span's `data_cap.count` may expand to (default 10 000), so a hostile or buggy count cannot exhaust memory.

##### trustForeignTimes?

```ts
readonly trustForeignTimes?: boolean;
```

Also take `startTimeUnixNano`/`endTimeUnixNano` from spans NOT marked `data_cap.timed` (default false: such a
span's stamp is usually the exporter's own instant, not an observation time). The first event of a span gets the
start, the others the end. Only spans that carry the `data_cap.*` attributes are read at all. Invalid times are
ignored and counted in `ignoredTimes`.

***

### OtlpReadResult

What `observationsFromOtlp` read.

#### Properties

##### events

```ts
readonly events: readonly ObservationEvent[];
```

##### ignoredTimes?

```ts
readonly ignoredTimes?: number;
```

Start/end times that were read (the span was timed, or `trustForeignTimes` was set) but missing or not a decimal-nanosecond string; absent when none.

##### skipped

```ts
readonly skipped: number;
```

Spans that had some `data_cap.*` attributes but not a usable set, or a payload that was not OTLP traces at all.

***

### OtlpSpan

An OTLP/JSON span, restricted to the fields this mapping populates.

#### Properties

##### attributes

```ts
readonly attributes: readonly OtlpAttribute[];
```

##### endTimeUnixNano

```ts
readonly endTimeUnixNano: string;
```

##### kind

```ts
readonly kind: 1;
```

`1` is SPAN_KIND_INTERNAL.

##### name

```ts
readonly name: string;
```

##### parentSpanId?

```ts
readonly parentSpanId?: string;
```

Present on a scope's observation spans when `scopeRoots` is on: the root span of that scope.

##### spanId

```ts
readonly spanId: string;
```

##### startTimeUnixNano

```ts
readonly startTimeUnixNano: string;
```

##### status

```ts
readonly status: {
  code: 1;
};
```

`{ code: 1 }` is STATUS_CODE_OK.

###### code

```ts
readonly code: 1;
```

##### traceId

```ts
readonly traceId: string;
```

***

### OtlpTraces

An OTLP/JSON traces payload, restricted to the fields this mapping populates.

#### Properties

##### resourceSpans

```ts
readonly resourceSpans: readonly {
  resource: {
     attributes: readonly OtlpAttribute[];
  };
  scopeSpans: readonly {
     scope: {
        name: string;
        version: string;
     };
     spans: readonly OtlpSpan[];
  }[];
}[];
```

***

### PolicyModel

`data-cap`'s Policy Model.

#### Properties

##### results

```ts
readonly results: readonly PolicyResult[];
```

Every evaluation result, ordered by rule, subject, boundary.

##### rules

```ts
readonly rules: readonly FlowPolicyRule[];
```

The declared rules, ordered by id.

##### schemaVersion

```ts
readonly schemaVersion: 1;
```

Always `POLICY_MODEL_SCHEMA_VERSION`.

##### summary

```ts
readonly summary: PolicySummary;
```

Counts by outcome.

***

### PolicyResult

One evaluation result.

#### Properties

##### basis

```ts
readonly basis: FlowStatus;
```

The weakest epistemic status of the edges the result rests on (`unknown` for an indeterminate result).

##### boundary?

```ts
readonly boundary?: string;
```

Id of the boundary node this result concerns; absent when none was reached or the result is about the trace as a whole.

##### edges

```ts
readonly edges: readonly string[];
```

Ids of the edges on the path that justifies this result.

##### outcome

```ts
readonly outcome: PolicyOutcome;
```

##### reason?

```ts
readonly reason?: PolicyIndeterminateReason;
```

Present exactly when `outcome` is `indeterminate`.

##### ruleId

```ts
readonly ruleId: string;
```

##### subject?

```ts
readonly subject?: string;
```

Id of the field node the rule was evaluated for; absent only for `rule-matches-nothing`.

***

### ProvDocument

A PROV-JSON document, restricted to the sections this projection populates.

#### Properties

##### activity

```ts
readonly activity: Record<string, Attributes>;
```

##### agent

```ts
readonly agent: Record<string, Attributes>;
```

##### entity

```ts
readonly entity: Record<string, Attributes>;
```

##### prefix

```ts
readonly prefix: Readonly<Record<string, string>>;
```

##### used?

```ts
readonly used?: Record<string, Attributes>;
```

##### wasAssociatedWith?

```ts
readonly wasAssociatedWith?: Record<string, Attributes>;
```

##### wasDerivedFrom?

```ts
readonly wasDerivedFrom?: Record<string, Attributes>;
```

##### wasGeneratedBy?

```ts
readonly wasGeneratedBy?: Record<string, Attributes>;
```

##### wasInformedBy?

```ts
readonly wasInformedBy?: Record<string, Attributes>;
```

***

### RedundantTransform

One redundant transformation of the data of one field.

#### Properties

##### capability

```ts
readonly capability: LeastDataCapability;
```

The capability the field belongs to.

##### edges

```ts
readonly edges: readonly string[];
```

Ids of the flow edges this rests on, sorted.

##### field

```ts
readonly field: string;
```

The field's top-level name.

##### fieldNode

```ts
readonly fieldNode: string;
```

Id of the field's node in the Flow Model.

##### hops

```ts
readonly hops: readonly string[];
```

For `forwarding-hop`: the ids of the function nodes that only hand the data on, in order, then the function that finally does something with it. Empty otherwise.

##### kind

```ts
readonly kind: RedundantTransformKind;
```

##### paths

```ts
readonly paths: readonly (readonly string[])[];
```

The paths inside the field that are handled redundantly (`[]` is the whole field), sorted.

##### source?

```ts
readonly source?: SourceLocation;
```

Where it happens: the copy, the derivation, or the call that starts a forwarding chain.

##### via?

```ts
readonly via?: "serialized" | "copied";
```

For `round-trip`: how the data was taken apart and put back, `serialized` or `copied`.

***

### StatusLegendEntry

The meaning of each epistemic status (ADR 0071), for a legend.

#### Properties

##### meaning

```ts
readonly meaning: string;
```

##### status

```ts
readonly status: FlowStatus;
```

***

### UnusedPath

A top-level shape key of a field that nothing uses.

#### Properties

##### capability

```ts
readonly capability: LeastDataCapability;
```

##### fetchedFrom

```ts
readonly fetchedFrom: readonly string[];
```

Names of the declared input endpoints of the operations that write this field -- where a tighter projection could be applied.

##### field

```ts
readonly field: string;
```

The field's top-level key.

##### fieldNode

```ts
readonly fieldNode: string;
```

Id of the field's node in the Flow Model.

##### path

```ts
readonly path: readonly string[];
```

Always a single-key path: the unused key.

##### sensitivity

```ts
readonly sensitivity: string | undefined;
```

The field's resolved sensitivity, when declared.

***

### ViewEdge

An edge, as the Flow Model records it.

#### Properties

##### from

```ts
readonly from: string;
```

##### handling?

```ts
readonly handling?: FlowHandling;
```

##### id

```ts
readonly id: string;
```

##### kind

```ts
readonly kind: FlowEdgeKind;
```

##### origin?

```ts
readonly origin?: string;
```

##### path?

```ts
readonly path?: readonly string[];
```

##### source?

```ts
readonly source?: {
  column: number;
  file: string;
  line: number;
};
```

###### column

```ts
readonly column: number;
```

###### file

```ts
readonly file: string;
```

###### line

```ts
readonly line: number;
```

##### status

```ts
readonly status: FlowStatus;
```

##### to

```ts
readonly to: string;
```

***

### ViewNode

A node, with a display label.

#### Properties

##### boundaryKind?

```ts
readonly boundaryKind?: FlowBoundaryKind;
```

##### classification?

```ts
readonly classification?: string;
```

##### id

```ts
readonly id: string;
```

##### kind

```ts
readonly kind: FlowNodeKind;
```

##### label

```ts
readonly label: string;
```

Short text for a diagram: the parameter name, `return`, `kind: name` for a boundary, the name otherwise.

##### name

```ts
readonly name: string;
```

##### scope

```ts
readonly scope: string;
```

##### source?

```ts
readonly source?: {
  column: number;
  line: number;
};
```

###### column

```ts
readonly column: number;
```

###### line

```ts
readonly line: number;
```

##### status

```ts
readonly status: FlowStatus;
```

***

### WholeFieldToClient

A whole multi-key field sent to a client response.

#### Properties

##### boundary

```ts
readonly boundary: string;
```

Id of the boundary node.

##### boundaryName

```ts
readonly boundaryName: string;
```

##### capability

```ts
readonly capability: LeastDataCapability;
```

##### edges

```ts
readonly edges: readonly string[];
```

Ids of the edges that send the whole value.

##### field

```ts
readonly field: string;
```

##### fieldNode

```ts
readonly fieldNode: string;
```

##### keys

```ts
readonly keys: readonly string[];
```

Every top-level key of the field's declared shape, all of which go to the client.

## Type Aliases

### ClaimVerification

```ts
type ClaimVerification = 
  | "verified"
  | "inferred"
  | "unobserved"
  | "contradicted"
  | "observed-only"
  | "indeterminate";
```

How the evidence lines up for a claim.

***

### CycloneDxInput

```ts
type CycloneDxInput = Pick<EvidenceModel, 
  | "flow"
  | "policy"
  | "claims"
  | "observation"
  | "provenance"
| "capability">;
```

What the projection reads from the Evidence Model.

***

### DiagramInput

```ts
type DiagramInput = Pick<EvidenceModel, "flow" | "policy">;
```

The part of the Evidence Model a flow diagram reads: the flow and the policy results.

***

### EvidenceProjectionSchema

```ts
type EvidenceProjectionSchema<T> = { readonly [K in keyof T]: EvidenceProjector<T[K]> };
```

One independent, pure projector function per key of the projection's output shape `T`.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-2"></a> `T` *extends* `Record`\<`string`, `unknown`\> |

***

### EvidenceProjector

```ts
type EvidenceProjector<T> = (evidence) => T;
```

A pure function from the full Evidence Model to one field of a
projection's output shape. Must not mutate `evidence` -- the membrane
`defineEvidenceProjection()` wraps it in enforces that at runtime, see
`createTrackingProxy()` below -- and must not perform I/O; `data-cap` can
enforce the read-only half of purity but not the "no side effects" half.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-3"></a> `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`EvidenceModel`](#evidencemodel) |

#### Returns

`T`

***

### EvidenceRulesInput

```ts
type EvidenceRulesInput = Pick<EvidenceModel, 
  | "capability"
  | "flow"
  | "policy"
  | "claims"
  | "observation"
  | "computed"
| "provenance">;
```

What the evaluator reads from the Evidence Model.

***

### FlowEdgeKind

```ts
type FlowEdgeKind = 
  | "reads"
  | "writes"
  | "transforms"
  | "discards"
  | "passes"
  | "returns"
  | "calls"
  | "crosses-boundary"
  | "side-effect";
```

What an edge means. Data moves `from` -> `to` along `reads`, `writes`,
`transforms`, `passes`, `returns` and `crosses-boundary`; `calls` is
control flow and `discards` records that a function received a field and
deliberately did not forward it -- neither carries data, so tracing does
not follow them. `side-effect` links a function to the boundary it acts on.

***

### FlowGraphViewInput

```ts
type FlowGraphViewInput = Pick<EvidenceModel, "flow" | "claims">;
```

What the view reads from the Evidence Model.

***

### FlowNodeKind

```ts
type FlowNodeKind = "function" | "parameter" | "return" | "field" | "boundary";
```

What a flow node is.

***

### FlowStatus

```ts
type FlowStatus = "declared" | "static" | "observed" | "inferred" | "unknown";
```

ADR 0071: the five epistemic statuses, shared by every flow fact, claim and finding.

***

### FlowTraceDirection

```ts
type FlowTraceDirection = "upstream" | "downstream";
```

Which way to follow data edges from the start node.

***

### FlowUnknownReason

```ts
type FlowUnknownReason = 
  | "dynamic-access"
  | "unresolved-call"
  | "unresolved-import"
  | "unsupported-construct"
  | "missing-source"
  | "unanalyzed-function";
```

Why a part of the program could not be analyzed (ADR 0053 citations apply to each).

***

### FlowVia

```ts
type FlowVia = "copy" | "serialize-roundtrip" | "forward" | "derive";
```

What the scanner saw happen to the data of an edge at one place, beyond what the edge says (ADR 0075).

- `serialize-roundtrip`: the data was taken apart and put back together with nothing in between that reads it
  (`JSON.parse(JSON.stringify(x))`, `Object.fromEntries(Object.entries(x))`).
- `copy`: the data was copied and nothing was added, dropped or renamed (`structuredClone(x)`, `{ ...x }`,
  `[...x]`, `Array.from(x)`). `fresh` says the copied value was itself a copy made by one of these.
- `derive`: a value computed from the data was bound to a name that is never read (`unused`).
- `forward`: reserved for a producer that knows a function only hands the data on. The scanner does not emit it;
  forwarding chains are found from the edges alone, so no reader depends on this tag.

***

### OscalInput

```ts
type OscalInput = Pick<EvidenceModel, "flow" | "policy" | "claims" | "provenance">;
```

What the projection reads from the Evidence Model.

***

### OtlpInput

```ts
type OtlpInput = Pick<EvidenceModel, "observation" | "provenance">;
```

What the mapping reads from the Evidence Model.

***

### OtlpValue

```ts
type OtlpValue = 
  | {
  stringValue: string;
}
  | {
  intValue: string;
};
```

An OTLP/JSON attribute value, restricted to the two kinds this mapping uses.

***

### ParsedEvidenceRules

```ts
type ParsedEvidenceRules = 
  | {
  ok: true;
  rules: EvidenceRules;
}
  | {
  errors: readonly string[];
  ok: false;
};
```

The result of parsing a rules document.

***

### PolicyOutcome

```ts
type PolicyOutcome = "satisfied" | "violated" | "indeterminate";
```

How a rule fared against one field (and, when relevant, one boundary).

***

### ProvInput

```ts
type ProvInput = Pick<EvidenceModel, "flow" | "claims" | "observation" | "provenance">;
```

What the projection reads from the Evidence Model.

***

### RedundantTransformKind

```ts
type RedundantTransformKind = "round-trip" | "forwarding-hop" | "dead-derivation";
```

The kinds of redundant transformation.

## Variables

### EVIDENCE\_RULE\_NAMES

```ts
const EVIDENCE_RULE_NAMES: readonly ["noPolicyViolations", "noIndeterminatePolicies", "maxContradictedClaims", "maxUnknowns", "requireComplete", "maxUnusedSensitivePaths", "maxWholeFieldToClient", "requireObservations", "minVerifiedClaims", "requireVerified", "maxRedundantTransforms", "maxObservationAgeDays"];
```

Every rule name the evaluator understands, in the order they are evaluated.

***

### FLOW\_GRAPH\_VIEW\_VERSION

```ts
const FLOW_GRAPH_VIEW_VERSION: 1 = 1;
```

Bump only when a renderer written for the previous shape could misread the new one.

***

### MIN\_FORWARDING\_HOPS

```ts
const MIN_FORWARDING_HOPS: 3 = 3;
```

The fewest functions in a chain for it to be a `forwarding-hop`.

## Functions

### analyzeLeastData()

```ts
function analyzeLeastData(input): LeastDataReport;
```

Finds unused paths and whole-field client exposure.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `input` | [`LeastDataInput`](build.md#leastdatainput) |

#### Returns

[`LeastDataReport`](#leastdatareport)

***

### analyzeRedundantTransforms()

```ts
function analyzeRedundantTransforms(flow): RedundantTransform[];
```

Finds the redundant transformations in a Flow Model, in a fixed order (by place, then kind). A model without
`edgeTags` has no round trips or dead derivations to report; forwarding chains come from its edges.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flow` | [`FlowModel`](#flowmodel) |

#### Returns

[`RedundantTransform`](#redundanttransform)[]

***

### buildCycloneDxBom()

```ts
function buildCycloneDxBom(evidence, options?): CycloneDxBom | undefined;
```

Projects the flow, policy, claims and observations into CycloneDX 1.6, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`CycloneDxInput`](#cyclonedxinput) |
| `options?` | [`CycloneDxOptions`](#cyclonedxoptions) |

#### Returns

[`CycloneDxBom`](#cyclonedxbom) \| `undefined`

***

### buildFlowGraphView()

```ts
function buildFlowGraphView(evidence): FlowGraphView | undefined;
```

Builds the graph view, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`FlowGraphViewInput`](#flowgraphviewinput) |

#### Returns

[`FlowGraphView`](#flowgraphview) \| `undefined`

***

### buildOscalAssessmentResults()

```ts
function buildOscalAssessmentResults(evidence, options): OscalAssessmentResults | undefined;
```

Projects the policy results and claims into OSCAL assessment-results, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`OscalInput`](#oscalinput) |
| `options` | [`OscalOptions`](#oscaloptions) |

#### Returns

[`OscalAssessmentResults`](#oscalassessmentresults) \| `undefined`

***

### buildProvDocument()

```ts
function buildProvDocument(evidence): ProvDocument | undefined;
```

Projects the flow, claims and observations into a PROV-JSON document, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`ProvInput`](#provinput) |

#### Returns

[`ProvDocument`](#provdocument) \| `undefined`

***

### defineEvidenceProjection()

```ts
function defineEvidenceProjection<T>(schema): EvidenceProjection<T>;
```

Declares a projection: a pure transform from the `EvidenceModel` to any
consumer-defined output shape, built entirely from `schema`'s independent
per-field projector functions.

`data-cap`'s own reference projections (`reference-projections.ts`'s
Classification/Privacy/Retention/Compliance/Audit Evidence) are built
through this exact function, with no privileged internal path -- a
consumer's own projection is a first-class citizen, not a lesser one.

#### Type Parameters

| Type Parameter |
| ------ |
| <a id="type-parameter-t-4"></a> `T` *extends* `Record`\<`string`, `unknown`\> |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `schema` | [`EvidenceProjectionSchema`](#evidenceprojectionschema)\<`T`\> |

#### Returns

[`EvidenceProjection`](#evidenceprojection)\<`T`\>

#### Remarks

A per-field schema, rather than one monolithic `(evidence) => T` function,
is what makes automatic provenance possible at all: each projector runs
against its own read-tracking membrane, so `.project()` can say which
evidence a *specific output field* was derived from, not merely which
evidence the whole report touched. That is the difference between "this
report read the Capability Model" and "this row's `sensitivity` came from
`capability.capabilities.0.docs.sensitivity`" -- the second is reviewable
evidence, the first is trivia.

Superseded ADR 0050's earlier `(name, project)` signature, whose `name`
existed only to label a thrown error. That named-wrapper design predates
this mechanism and bought strictly less: the membrane below both enforces
the purity the old wrapper only documented, and produces provenance the
old wrapper had no way to compute.

***

### diffFlow()

```ts
function diffFlow(before, after): FlowDiff;
```

Compares `before` to `after` by content-addressed id (ADR 0070).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `before` | [`FlowModel`](#flowmodel) |
| `after` | [`FlowModel`](#flowmodel) |

#### Returns

[`FlowDiff`](#flowdiff)

***

### evaluateEvidenceRules()

```ts
function evaluateEvidenceRules(evidence, rules): EvidenceRulesResult;
```

Evaluates `rules` over `evidence`. A rule that needs analysis that did not run is a violation.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`EvidenceRulesInput`](#evidencerulesinput) |
| `rules` | [`EvidenceRules`](#evidencerules) |

#### Returns

[`EvidenceRulesResult`](#evidencerulesresult)

***

### filterFlow()

```ts
function filterFlow(model, filter): FlowView;
```

Keeps matching nodes, the edges between them, and the unknowns that still apply.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model` | [`FlowModel`](#flowmodel) |
| `filter` | [`FlowFilter`](#flowfilter) |

#### Returns

[`FlowView`](#flowview)

***

### flowEdgeId()

```ts
function flowEdgeId(
   kind, 
   from, 
   to, 
   path, 
   status, 
   origin?
): string;
```

The one place an edge id is derived. Status is part of the id so a declared and a static record of one edge stay two records (ADR 0071).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | [`FlowEdgeKind`](#flowedgekind-1) |
| `from` | `string` |
| `to` | `string` |
| `path` | readonly `string`[] \| `undefined` |
| `status` | [`FlowStatus`](#flowstatus) |
| `origin?` | `string` |

#### Returns

`string`

***

### flowNodeId()

```ts
function flowNodeId(
   kind, 
   scope, 
   name
): string;
```

The one place a node id is derived.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `kind` | [`FlowNodeKind`](#flownodekind-1) |
| `scope` | `string` |
| `name` | `string` |

#### Returns

`string`

***

### leastDataFindings()

```ts
function leastDataFindings(report): ReportFinding[];
```

Turns a `LeastDataReport` into report findings (family `flow`).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `report` | [`LeastDataReport`](#leastdatareport) |

#### Returns

[`ReportFinding`](build.md#reportfinding)[]

***

### observationsFromOtlp()

```ts
function observationsFromOtlp(payload, options?): OtlpReadResult;
```

Reads the `data_cap.*` attributes off any OTLP/JSON traces payload. Spans that carry none are not data-cap's and are ignored.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `payload` | `unknown` |
| `options?` | [`OtlpReadOptions`](#otlpreadoptions) |

#### Returns

[`OtlpReadResult`](#otlpreadresult)

***

### observationsToOtlp()

```ts
function observationsToOtlp(evidence, options?): OtlpTraces | undefined;
```

Maps the observations to OTLP/JSON traces, or `undefined` when none were ingested.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`OtlpInput`](#otlpinput) |
| `options?` | [`OtlpOptions`](#otlpoptions) |

#### Returns

[`OtlpTraces`](#otlptraces) \| `undefined`

***

### observedFlow()

```ts
function observedFlow(
   flow, 
   observation, 
   scope?
): ObservedFlow;
```

The witnessed part of `flow`, for one execution (`scope`) or for all of them.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `flow` | [`FlowModel`](#flowmodel) |
| `observation` | [`ObservationModel`](#observationmodel) |
| `scope?` | `string` |

#### Returns

[`ObservedFlow`](#observedflow)

***

### parseEvidenceRules()

```ts
function parseEvidenceRules(text): ParsedEvidenceRules;
```

Parses a rules document (JSON text), rejecting anything it does not fully understand.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `text` | `string` |

#### Returns

[`ParsedEvidenceRules`](#parsedevidencerules)

***

### redundantTransformFindings()

```ts
function redundantTransformFindings(items, flow): ReportFinding[];
```

Turns redundant transformations into report findings (family `flow`, always `info`: this analysis alone never fails a build).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `items` | readonly [`RedundantTransform`](#redundanttransform)[] |
| `flow` | [`FlowModel`](#flowmodel) |

#### Returns

[`ReportFinding`](build.md#reportfinding)[]

***

### renderFlowCycloneDx()

```ts
function renderFlowCycloneDx(evidence, options?): string | undefined;
```

`buildCycloneDxBom` serialized as stable, indented JSON with a trailing newline, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`CycloneDxInput`](#cyclonedxinput) |
| `options?` | [`CycloneDxOptions`](#cyclonedxoptions) |

#### Returns

`string` \| `undefined`

***

### renderFlowDot()

```ts
function renderFlowDot(evidence, options?): string | undefined;
```

Renders DOT, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`DiagramInput`](#diagraminput) |
| `options?` | [`FlowDiagramOptions`](#flowdiagramoptions) |

#### Returns

`string` \| `undefined`

***

### renderFlowMermaid()

```ts
function renderFlowMermaid(evidence, options?): string | undefined;
```

Renders a Mermaid flowchart, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`DiagramInput`](#diagraminput) |
| `options?` | [`FlowDiagramOptions`](#flowdiagramoptions) |

#### Returns

`string` \| `undefined`

***

### renderFlowText()

```ts
function renderFlowText(evidence, options?): string | undefined;
```

Renders the graph as Markdown, or `undefined` when no flow was computed.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`FlowGraphViewInput`](#flowgraphviewinput) |
| `options?` | [`FlowTextOptions`](#flowtextoptions) |

#### Returns

`string` \| `undefined`

***

### traceFlow()

```ts
function traceFlow(
   model, 
   start, 
   direction, 
   options?
): FlowTrace;
```

Follows data edges from `start` in `direction`, breadth-first, terminating
on cycles. Downstream from a `field` node follows only that field's own
data (edge `origin`, ADR 0070). Upstream collects, for every field whose
downstream flow reaches `start`, the edges of that flow that lead to
`start`, plus any declared source feeding that field.

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model` | [`FlowModel`](#flowmodel) |
| `start` | `string` |
| `direction` | [`FlowTraceDirection`](#flowtracedirection-1) |
| `options?` | [`FlowTraceOptions`](#flowtraceoptions) |

#### Returns

[`FlowTrace`](#flowtrace)

***

### traceFlowBetween()

```ts
function traceFlowBetween(
   model, 
   start, 
   target, 
   options?
): FlowTrace;
```

The part of a downstream flow from `start` that lies on some route to `target`: the nodes reachable from `start`
that can also reach `target`, and the edges between them. Empty when `target` is not reached. Follows the same
rules as `traceFlow` downstream (a field start carries only its own data; `options.path` narrows it).

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `model` | [`FlowModel`](#flowmodel) |
| `start` | `string` |
| `target` | `string` |
| `options?` | [`FlowTraceOptions`](#flowtraceoptions) |

#### Returns

[`FlowTrace`](#flowtrace)

## References

### FlowBoundaryKind

Re-exports [FlowBoundaryKind](core.md#flowboundarykind)

***

### FlowHandling

Re-exports [FlowHandling](core.md#flowhandling)
