# 0049: Capability governance metadata vocabulary on `documentData()`

## Status

Accepted. Implemented in `src/core/document.ts` (`CapabilityDocs`/`FieldDocs`/
`OperationDocs`/`DataFlowEndpoint` types), `src/build/parse.ts`
(`extractCapabilityDocs` and its supporting extraction helpers), and
`src/build/link.ts` (`DiscoveredCapability.docs`).

## Context

Bringing `data-cap`'s build tooling to parity with `env-cap`'s report-
generation engine requires a metadata vocabulary richer than `description`
alone — one that lets a generator answer what a platform or security
reviewer actually asks about a piece of application data: what it is, why
it exists, who's accountable for it, how sensitive it is, whether a
safeguard is documented, and where it flows. `env-cap`'s `documentEnv()`
already has an equivalent vocabulary (`owner`, `active`, `exclusiveGroup`,
`category`, `expiresAt`, `metadata`), but it was designed for environment
variables living in one flat `process.env` namespace, where "two contracts
define the same key" is always a real collision and "expiresAt" maps
naturally to secret rotation. Neither assumption holds for `data-cap`:
capabilities are independent state trees (confirmed in `core/types.ts`),
so a same-named field in two capabilities is normal, not a collision; and
ordinary application data doesn't "expire" the way a credential does. This
ADR records the vocabulary actually adopted, field by field, and — just as
importantly — the epistemic boundary every future generator (manifest,
docs catalog, ownership/dependency reports, the data-flow diagram) must
respect when rendering any of it.

## Decision

Extend `CapabilityDocs`/`FieldDocs`/`OperationDocs` with the following
fields, all optional, all author-declared (never statically verified
against runtime behavior):

| Metadata         | Scope                             | Purpose                                                                                              | Epistemic status                                                                                                                                                                                                  |
| ---------------- | --------------------------------- | ---------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `owner`          | capability, **field (overrides)** | accountability                                                                                       | declared; a field's own `owner` overrides the capability's for that field specifically                                                                                                                            |
| `category`       | capability                        | classification                                                                                       | declared, free text, never validated                                                                                                                                                                              |
| `exclusiveGroup` | capability                        | mutual exclusivity                                                                                   | declared; the one field allowed to drive a hard error, since >1 active member sharing a group is a real conflict data-cap's own runtime semantics make true                                                       |
| `active`         | capability                        | participation                                                                                        | declared; defaults to `true` when omitted                                                                                                                                                                         |
| `sensitivity`    | capability, field                 | data classification                                                                                  | declared; standard vocabulary `public`/`internal`/`confidential`/`restricted` (ascending), custom values allowed but flagged non-standard                                                                         |
| `protections`    | capability, field                 | documented safeguard                                                                                 | declared — **presence only, never an adequacy claim**                                                                                                                                                             |
| `retention`      | capability, field                 | documented retention policy                                                                          | declared — **presence only, never an enforcement claim**                                                                                                                                                          |
| `metadata`       | capability                        | free-form extension bag                                                                              | declared, unvalidated; documented convention for jurisdiction-specific regulatory classification (e.g. `{ regulatory: "GDPR,PCI-DSS" }`) since data-cap can't validate which regime applies to a given deployment |
| `endpoints`      | operation                         | structured data-flow boundary (`DataFlowEndpoint[]`: `direction: "input"\|"output"`, `kind`, `name`) | declared                                                                                                                                                                                                          |

`source`/`credentials` (already existing on `OperationDocs`) keep their
meaning: acquisition label and what's required to call, respectively.

Three boundaries every generator must honor when rendering any of this:

1. **`sensitivity` vocabulary is a convention, not an enforced enum.**
   `public`/`internal`/`confidential`/`restricted` are the standard,
   documented values (see `README.md`). A custom string is still accepted
   — matching `FieldDocs`' existing open-index-signature philosophy — but
   participates in a `NONSTANDARD_SENSITIVITY_LEVEL`-class finding, never
   blocking. Any non-empty `sensitivity` value, standard or custom,
   participates in a missing-protections check identically.
2. **`protections`/`retention`/`credentials` are documentation-presence
   signals, never adequacy or enforcement claims.** A generator may only
   ever say a safeguard/policy is _"documented"_ or _"not documented."_ It
   must never render language implying the documented value is sufficient,
   correct, or actually enforced — this package cannot verify any of that
   from static analysis, and claiming otherwise would be a false signal
   from a tool with no way to back it up.
3. **Declared facts are never presented as proven facts.** `endpoints`,
   `source`, and `credentials` describe what the author asserts about an
   operation's external behavior — never verified against the operation's
   actual `execute`/`subscribe` body, which stays opaque per ADR 0002. Any
   future report combining this with AST-derived facts (a dependency
   graph, a usage scan) must label each rendered fact "declared" or
   "proven," never blend the two.

Two fields env-cap has that were deliberately **not** ported:

- **No `expiresAt`.** env-cap's `expiresAt` models secret rotation —
  ordinary application data doesn't have an equivalent lifecycle. Where a
  future data-flow report needs to reason about persistence/storage
  destinations, `DataFlowEndpoint`'s `kind: "database" | "cache" |
"storage"` already covers that without inventing a rotation-specific
  concept that doesn't fit the domain.
- **No structured "transformation" field.** A getter/mutator/subscription's
  `processor` function body is opaque per ADR 0002 (AST-only, never eval)
  — a structured field describing what a processor does could never be
  more truthful than free-text `description`, since neither can be
  verified against the actual body. Adding one would just duplicate
  `description` with false structure.
- **No `reads` field on operations.** `GetterDefinition`/`MutatorDefinition`/
  `SubscriptionDefinition` (`core/types.ts`) declare a required, literal
  `writes` shape, but have no equivalent `reads` declaration —
  `optimistic`/`processor` bodies receive the full authoritative state and
  may read whatever they want from it, unprovably. Only `writes` is ever
  statically extractable; inventing a `reads` field would violate the
  static-analysis invariant below (never infer a relationship from
  insufficient evidence).

Static extraction (`src/build/parse.ts`) follows the same literal-only,
warn-not-guess discipline as the rest of `build/`: a non-literal value for
any of these fields produces a `ParseWarning` naming the specific field and
capability, never a thrown error, never a guessed value. `endpoints`
extraction additionally validates each array entry's `direction`/`kind`
against a closed set — an entry with an unrecognized value, or a missing
`name`, is dropped individually (with its own warning), while the rest of
the array is still used.

## Consequences

- Every field/operation in a capability can now carry the vocabulary a
  platform, security, or privacy reviewer actually asks about — this is
  the prerequisite for the manifest/docs/ownership/data-flow generators
  the build tooling still needs to grow (tracked separately).
- `DiscoveredCapability.docs` (`build/link.ts`) carries the fully-extracted
  `CapabilityDocs` for any capability with a correlated `documentData()`
  call, `undefined` otherwise — no change to correlation itself (ADR 0040).
- The declared-vs-proven distinction becomes a formal invariant (see
  `AGENTS.md`) that every future generator must honor, not just this
  extraction layer.
- `sensitivity`/`protections`/`retention` intentionally carry no built-in
  enforcement — an application that documents `protections: "encrypted at
rest"` but doesn't actually encrypt anything gets no runtime or build-time
  contradiction from data-cap. This is the same posture `SECURITY.md`
  already takes for the package as a whole: `data-cap` makes ownership and
  intent explicit enough for dedicated tooling to reason about, but is not
  itself that tooling.

## Alternatives considered

- **Port `env-cap`'s vocabulary verbatim, including `expiresAt`.** Rejected
  — see "Decision" above; ordinary data has no secret-rotation lifecycle,
  and forcing the concept in would misrepresent what the field means.
  Persistence/storage is instead covered by `DataFlowEndpoint`.
- **Model `protections`/`credentials` as a structured, closed vocabulary
  (e.g. an enum of recognized safeguard types) instead of free text.**
  Rejected for this pass — the space of real-world safeguards (encryption
  schemes, access-control models, redaction policies) is too broad and
  organization-specific to enumerate usefully today; free text keeps the
  field honest about being documentation, not a checklist data-cap
  validates. A closed vocabulary remains possible later if a concrete need
  emerges.
- **Infer `reads` from a processor's parameter destructuring via limited
  static analysis (e.g. matching `authoritativeState.fields.x` access
  patterns).** Rejected — this is exactly the kind of heuristic guess the
  static-analysis-only invariant (ADR 0002) exists to avoid; a processor
  can derive what it reads through arbitrary intermediate logic no
  pattern-match could reliably cover, and a wrong guess is worse than no
  answer.
