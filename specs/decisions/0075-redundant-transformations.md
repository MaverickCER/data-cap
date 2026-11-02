# 0075: Redundant transformations: three kinds, one finding, tags beside the edges

## Status

Accepted. Extends ADR 0070 (the Flow Model and its projections) and ADR 0071 (every fact has a status; an unknown blocks a
verdict). Implemented in `src/flow/redundant-transform.ts` (the analysis), `src/flow/flow-model.ts` (`edgeTags`),
`src/build/flow-scan.ts` and `src/build/flow-derivation.ts` (what the scan records), `src/evidence/evidence-rules.ts`
(`maxRedundantTransforms`); pinned by `test/flow/redundant-transform.test.ts`,
`test/build/flow-redundant-transforms.test.ts`, `test/build/flow-redundant-pipeline.test.ts`,
`test/build/flow-derivation.test.ts`, `test/evidence/evidence-rules-redundant.test.ts` and, as the false-positive
guard, `test/examples/flow-redundant.test.ts`.

## Context

The least-data analysis (ADR 0070) answers "which data is held or sent that nothing uses". The same brief had a second
half that was dropped: data that is _handled more than it needs to be_. A record is serialized and parsed straight
back; a field travels through a stack of functions that only hand it on; a value is computed from a field and thrown
away. None of these is a leak, and none changes what reaches a boundary, so they never belonged in the policy model.
They are what a reviewer who is minimizing data handling wants to be told about, and they are cheap to get wrong: a
rule that calls every defensive copy "redundant" is noise that gets switched off. So the definition has to be narrow,
each kind has to say what it does _not_ cover, and the severity has to be information.

## Decision

### 1. Exactly three kinds

- **`round-trip`.** A tracked value is taken apart and put back, or copied again although it is already a fresh copy,
  and nothing is added, dropped or renamed. The recognized forms are `JSON.parse(JSON.stringify(x))` and
  `Object.fromEntries(Object.entries(x))` (always: the pair is the identity), and a copy of a value that is itself the
  result of a recognized copy: `structuredClone`, `{ ...x }` and nothing else in the literal, `[...x]` and nothing else,
  `Array.from(x)` with one argument. "Already a fresh copy" is exact: the value's allocation sites (ADR 0074 section 5)
  were all made by a recognized copy. A single copy of a parameter, of a call result or of a literal is not reported:
  it may be the defensive copy that stops the caller's object being changed. A copy that adds a field, renames one,
  drops one (a rest binding), maps the entries, or gives `JSON.stringify` a replacer is not a round trip.
- **`forwarding-hop`.** A chain of at least three functions, each of which, for one path of one field, only receives it
  through a parameter and hands it, as it got it, to exactly one callee (and hands the callee's answer back as its own
  result). The chain is reported once, from its first function, with the hop functions and the function that finally
  does something with the data (`hops`). It is found from the edges alone: a function that also sends or logs the path,
  transforms it (an `inferred` hand-over), hands it to a second callee, drops it, or returns something other than what
  the callee returned is not a hop. What it does with other data is not looked at: a wrapper that logs a constant is
  still a wrapper. A cycle of forwarders has no first function and is not reported; a chain that runs into one stops
  at it.
- **`dead-derivation`.** A value computed from a tracked field, bound to a name that nothing reads. "Computed" is
  strict: the initializer may only read names and members, build literals, apply operators, call `getSnapshot()`, and
  call the methods that make a new value from a value (`toUpperCase`, `map` with an expression-bodied callback, ...).
  `const r = send(x)` is not a dead derivation: the call is the point and `r` is incidental. A name is "unused" when it
  is written once in the whole function (declaration included, closures included, a shadowing declaration counts as
  a use, which only ever hides a finding) and does not start with `_`. A destructuring of which any name is used is not
  reported. The existing `discards` edge still covers a path a function _received_ and dropped; this kind is a result a
  function _computed_ and dropped.

### 2. One finding, information only

`LEAST_DATA_REDUNDANT_TRANSFORM`, family `flow`, severity `info`, one per (kind, place, field): the kind is in the
message; `source`/`position` is the place (the copy, the declaration, the call that starts the chain); `capability` and
`field` name the data; `evidence` references the field node and the flow edges involved. It is never an error from this
analysis, and it is not escalated by `--strict-flow` (which turns `warning` into `error`; this finding is never a
`warning`), exactly like `LEAST_DATA_UNUSED_PATH`. SARIF and the report carry it with the rest of the flow findings; SARIF
anchors it where the flow evidence puts it, as for every finding that carries evidence. The CI rule is
`maxRedundantTransforms: n` (a count rule; it fails closed when no flow was computed).

### 3. What is persisted, and why the Flow Model's edges did not change

The analysis is a pure function of the Flow Model (`analyzeRedundantTransforms(flow)`), like `analyzeLeastData`: nothing
derived is persisted. What the scanner knows and the edges cannot say is persisted as an optional, additive list on the
Flow Model, `edgeTags`: `{ id, via, edge, source, fresh?, unused? }`, with `via` one of `copy`, `serialize-roundtrip`,
`derive` (and `forward`, reserved, never emitted: forwarding is found from the edges, so no reader depends on it).
`edge` is the id of an _existing_ edge, the one that carries the data into the function at that place; `source` is the
place. Edge kinds, edge ids and node ids are unchanged: a tag is beside the edge, not part of its identity, and the key
is absent from a model with no tags, so evidence produced without a copy or an unused derivation is byte-identical to
before. `buildFlowModel` rejects a tag whose edge is not in the model, merges the same place tagged twice, and orders
tags by id.

The scanner records a tag when it sees a recognized copy of tracked data (`copy`, with `fresh` when the operand was
itself a copy; `serialize-roundtrip` for the two pairs), and when it binds a pure derivation to a name nothing reads
(`derive`, `unused`). The analysis, not the scanner, decides which tags count: a `copy` that is not `fresh` is recorded
and never reported.

`FLOW_MODEL_SCHEMA_VERSION` stays 1 and `EVIDENCE_MODEL_SCHEMA_VERSION` stays 3. The change is additive and optional, a
reader of an earlier shape finds every field it knew unchanged (ADR 0070, VERSIONING.md), and the flow surface has not
been released. The published schemas are regenerated (`npm run schema`).

### 4. Nothing is concluded from an incomplete picture

A tag, or a chain, is not reported when an `unknown` of the same function concerns the data (names it, or does not say
which data it concerns): the code the analysis could not follow may be what reads the derived value, or may be the reason
for the copy (a defensive copy before an opaque call). An absent finding is therefore not proof that nothing is redundant,
the same reading as an absent flow (ADR 0071).

## Consequences

- A project sees, as information, the three places where data is handled for nothing, with the evidence to check each.
  A project that wants a ceiling sets `maxRedundantTransforms` in the rules file.
- The scanner gained a notion of "a copy made by a recognized copy" (the allocation sites of ADR 0074 section 5), and
  with it a precision gain: `JSON.parse(JSON.stringify(a))`, `structuredClone(a)`, `{ ...a }`, `Array.from(a)` and an
  object rest are new objects, so a store into the copy is no longer a store into the original.
- Limits, stated: forwarding is judged per path, so a wrapper that forwards `email` and transforms `name` is a hop for
  `email` only; copies through a variable that is mutated afterwards are still "fresh copies of copies" when the second
  copy happens (the analysis does not look for later writes); a dead derivation is found only inside a function body
  (not for a module-level binding) and only when the name is not mentioned anywhere else in that function; forms
  hidden behind a helper (`const clone = (x) => JSON.parse(JSON.stringify(x))`) are found in the helper, not at its
  call sites; and the three kinds do not look at statements that compute and discard a value without naming it.
- A noisy rule would show on the four consumer examples first: `test/examples/flow-redundant.test.ts` pins that they
  have none.
