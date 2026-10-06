# evidence

## Interfaces

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

##### lifecycle

```ts
readonly lifecycle: LifecycleModel;
```

Lifecycle Model -- always populated, for the reason `EvidenceModelInputs.lifecycle` documents.

##### ownership

```ts
readonly ownership: OwnershipModel | undefined;
```

Ownership Model, or `undefined` when none was supplied -- see `computed.ownership`.

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
readonly schemaVersion: 2;
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
| `T` *extends* `Record`\<`string`, `unknown`\> |

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
| `T` *extends* `Record`\<`string`, `unknown`\> |

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

## Type Aliases

### EvidenceProjectionSchema

```ts
type EvidenceProjectionSchema<T> = { readonly [K in keyof T]: EvidenceProjector<T[K]> };
```

One independent, pure projector function per key of the projection's output shape `T`.

#### Type Parameters

| Type Parameter |
| ------ |
| `T` *extends* `Record`\<`string`, `unknown`\> |

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
| `T` |

#### Parameters

| Parameter | Type |
| ------ | ------ |
| `evidence` | [`EvidenceModel`](#evidencemodel) |

#### Returns

`T`

## Functions

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
| `T` *extends* `Record`\<`string`, `unknown`\> |

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
