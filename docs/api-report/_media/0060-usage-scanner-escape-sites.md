# 0060: The usage scanner reports an untraceable capability/field reference as `indeterminate`, never silently as `unconsumed`

## Status

Accepted. Implemented in `src/build/dependency-graph.ts` (`classifyUsage`,
`isDeclarationOrExportPosition`, `isNamePosition`, `isElementAccessIndex`,
`classifyFieldsAccess`); covered by `test/build/dependency-graph.test.ts`'s
"escape sites" and "name-position collisions" suites and
`test/build/scan-dependencies.test.ts`'s integration-level equivalents.
Extends `scan-dependencies.ts`'s own header invariant ("never infer from
insufficient evidence") to the one case it didn't yet honor.

## Context

Before this decision, `dependency-graph.ts`'s own header comment described
its scope honestly but incompletely: "a capability reference passed to
another function, stored under a new name, or destructured apart is a real
usage this module cannot follow ... so it contributes nothing beyond the
base `imports` edge." In practice this meant a capability's `.fields`
object — or the bare capability reference itself — handed whole to a
function argument, a spread (`{ ...x.fields }`), a `return`, or (in a React
consumer) passed as a component prop or a context value produced **zero**
edges for any field only reachable that way. Every field of that capability
not otherwise proven read elsewhere was then reported as `UNCONSUMED_FIELD`
— a **false claim of certainty**: "written but never statically read in the
scanned project," when a real, unattributable consumer was sitting right
there in the same file.

`@maverickcer/env-cap`'s equivalent scanner had exactly this bug once (its
own [ADR 0039](https://github.com/MaverickCER/env-cap/blob/main/specs/decisions/0039-scanner-local-dataflow-boundary.md)):
a bare reference to a tracked `documentEnv()` contract was silently
discarded as a "reference," so a destructured or prop-drilled contract had
every one of its keys wrongly reported as `UNCONSUMED_OWNED_VARIABLE`. env-cap
fixed it by tracking every such occurrence as an explicit **escape site**
and widening every not-otherwise-proven key on that contract from
`unconsumed` to `indeterminate`. data-cap's own scanner — seeded from the
same resolver lineage as env-cap ([ADR 0043](0043-env-cap-resolver-relocated-and-duplicated.md),
though that ADR covers only the specifier-resolution helpers, not this
usage-scanning logic) — never received the equivalent fix.

This was surfaced by a maintainer audit asking, in effect: "if a sensitive
field is handed to a child component as a prop, or returned from a context
provider, can data-cap still meaningfully say whether it's exposed outside
an allowed environment?" Before this ADR: no — and worse, it would
misreport "no consumer found."

## Decision

`classifyUsage` (`dependency-graph.ts`) now escalates every bare mention of
a tracked capability, or of its `.fields`/`.getSnapshot()` result, to an
`indeterminate` `imports`/`reads-field` edge — reusing the exact widening
mechanism already built for `x.fields[computed]` dynamic access
(`usage-report.ts`'s `collectIndeterminateSites` → `FIELD_ACCESS_INDETERMINATE`),
so no downstream report/finding code needed to change. Three helpers draw
the line between a real escape and something that only looks like one:

- **`isDeclarationOrExportPosition`** — the binding's own `import`
  specifier/clause, a re-`export` specifier, or (for a capability declared
  and read in the same file) its own `const`/`let` declaration name. Never
  a usage, matching the scanner's pre-existing guarantee that walking an
  import declaration never produces a usage edge.
- **`isNamePosition`** — `id` sits as some _other_ declaration's own label:
  an unrelated object's member access (`other.getUser()`), an object
  literal's property **key** (`{ getUser: 1 }`, as opposed to its value —
  `{ someKey: getUser }` is a real escape), or a class/interface member's
  own name. This pass matches identifiers by text alone (ADR 0010's
  "provable, not heuristic" — no `ts.Program`/type checker), so a local
  binding's name can coincidentally recur as an unrelated label elsewhere in
  the file; none of those recurrences is ever a reference to the tracked
  binding. Deliberately excludes `ShorthandPropertyAssignment` (`{ getUser
}`, meaning `{ getUser: getUser }`): there the identifier genuinely _is_ a
  value reference to the outer binding.
- **`isElementAccessIndex`** — `id` (or a `.fields`/`.getSnapshot()` access
  on it) is used only as _another_ expression's element-access **key**
  (`registry[x]`, `registry[x.fields]`) — the capability's own identity is
  used here, never its data, so this is neither a proven access nor an
  escape.

A computed `.fields[computed]` index and a bare `.fields` escape now
converge on the same `FieldsAccessOutcome` ("indeterminate") rather than
being distinguished, since no caller ever needed to tell them apart — they
produce an identical `DependencyEdge` either way (ADR 0052's five-state
model has no fourth "escape" sub-reason of its own; `usage-report.ts`'s
`INDETERMINATE_CONSUMER`/`FIELD_ACCESS_INDETERMINATE` messages were
reworded to plainly describe both origins).

Deliberately **not** included in this pass (see env-cap ADR 0039's own
"one level" precedent): recovering precision by following destructuring
(`const { email } = x.fields`) or `const` aliasing (`const f = x.fields`)
back to a named field. None of data-cap's own examples currently destructure
`.fields` directly, so this ships with zero precision regression on
existing fixtures; a future pass can add it the same way env-cap did, once
a real consumer pattern asks for it.

## Consequences

- A capability's `.fields` (or the capability itself) handed to a child
  component as a prop, spread into an object literal, returned from a
  context provider/custom hook, or otherwise passed beyond a single
  `x.fields.<name>`/`x.getSnapshot().fields.<name>` read now correctly
  widens every not-otherwise-proven field on that capability to
  `indeterminate`, with a real, cited source position — never silently
  `unconsumed`.
- `dependency-graph.ts` and `scan-dependencies.ts`'s own "genuinely unused"
  claims are now honest along the _dataflow-depth_ axis, not just the
  _scan-surface-breadth_ axis `renderScanSurface`/ADR 0036/ADR 0053 already
  covered.
- No change to any consumer of `DependencyEdge`/`ReportFinding` shapes —
  every new edge is a `resolution: "indeterminate"` edge the existing
  widening/rendering code already understood.
- 100% mutation score retained on `dependency-graph.ts` (`npx stryker run
--mutate src/build/dependency-graph.ts`); several of the surviving
  mutants this pass's first draft produced were themselves genuine
  equivalent mutants given the guards above (e.g. `isNamePosition` needs no
  `parent.name === id` check for `PropertySignature`/`MethodDeclaration`/
  `MethodSignature`/accessors, since none of those node kinds expose any
  OTHER direct-child identifier `id` could be) — resolved by simplifying the
  code to state the invariant in a comment rather than re-checking it at
  runtime, the same pattern `readFieldNameAfter`'s own comment already uses.

## Alternatives considered

- **Full dataflow/alias tracing via a `ts.Program` + type checker.**
  Rejected for the same reason ADR 0002/0010 already reject it for
  data-cap's build tooling generally: seconds-to-minutes on a large
  monorepo, and a checker can still be defeated (`any`, dynamic access,
  cross-module aliasing) — trading a large cost for a still-incomplete
  result.
- **Recover destructuring/const-aliasing precision in this same pass**
  (mirroring env-cap ADR 0039 in full). Deferred, not rejected — see
  "Decision" above. No currently-shipped example needs it, and adding it
  without a real driving case would be speculative scope.
- **A distinct `"escape"` edge relationship or a richer `via`-reason
  taxonomy** (mirroring env-cap's `EscapeReason` exactly). Rejected for now
  — no caller distinguishes _why_ something is indeterminate today; adding
  the taxonomy without a consumer for it would be unused surface. The
  reworded finding messages already name the realistic causes in prose.
