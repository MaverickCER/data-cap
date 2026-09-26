# 0063: The `eslint-plugin` ships more than one rule, each independently justified against the same bar — and adds `no-fields-spread`

## Status

Accepted. Supersedes [ADR 0038](0038-eslint-plugin-single-rule.md)'s "exactly
one rule" framing (see "Context" below for why that framing was already
factually overtaken before this decision). The "ships more than one rule"
half of this decision still stands as written below. The `no-fields-spread`
rule itself was renamed to `no-fields-escape` and gained three more escape
kinds (bare call argument, named JSX prop, exported reassignment) in
[ADR 0064](0064-no-fields-escape-export-argument-and-prop.md) — the rule's
current name, file, and full behavior are documented there; this decision's
own description of `no-fields-spread` below is left as written, as a record
of what shipped first.

## Context

ADR 0038 declared "the plugin ships exactly one rule" as a deliberate
scope limit, reserving the plugin for "the one mistake class specific
enough to this package's own architecture ... that a general-purpose rule
doesn't already catch." That premise was already stale by the time this
decision was made: `no-node-fs` shipped afterward (ADR 0058, "a library
surface acquiring node:fs isn't a style preference") and `no-raw-external-io`
shipped after that with no ADR of its own at all — neither addition ever
updated or superseded ADR 0038's "exactly one" claim, so the plugin has
been quietly shipping three rules under a design document that still says
one.

Separately, a cross-package `1.0`-readiness audit asked a direct question
about data-cap's own core value proposition: after
[ADR 0060](0060-usage-scanner-escape-sites.md) taught the build-time
scanner to report a capability's `.fields` (or a bare `getSnapshot()`
result) spread wholesale into JSX/an object literal, or destructured with
a rest element, as `indeterminate` rather than silently `unconsumed`, is
that enough? `indeterminate` is real, honest evidence — but it's a warning
a human has to notice in a generated report, discovered only the next time
someone regenerates and reads `docs/OWNERSHIP.md`. The exact same class of
mistake ADR 0038 originally justified a dedicated rule for
(coordinator-sharing defeated silently, discoverable only by noticing
dedup isn't happening) applies here too: a field escaping wholesale into a
spread is easy to write accidentally and easy to never notice, because
nothing turns red until someone happens to read a report section.

## Decision

**Supersede ADR 0038's "exactly one rule" framing.** The actual, durable
policy this plugin has followed in practice — correctly, just never
written down — is the bar ADR 0038 set for its _first_ rule, applied
independently to each candidate: a lint rule is reserved for a mistake
class specific enough to this package's own architecture that neither
TypeScript's type system nor a general-purpose lint rule already catches,
and it must stay purely structural (AST shape / scope analysis), never
attempting to trace what an operation's body actually does or resolve an
import across files. `stable-operation-reference`, `no-node-fs`, and
`no-raw-external-io` all already meet that bar independently; this
decision states it explicitly instead of leaving a stale "exactly one"
claim standing next to three rules.

**Add `no-fields-spread`.** Flags a capability's whole `.fields` (or a
bare `getSnapshot()` result, which spreads `info` alongside `fields`) used
as:

- a JSX spread attribute (`<Child {...userData.fields} />`),
- an object-literal spread (`{ ...userData.fields }`), or
- the initializer of a destructuring pattern containing a rest element
  (`const { ...rest } = userData.fields`, `const { email, ...rest } =
userData.fields`).

Matched by property/method name alone (`.fields`, `.getSnapshot()`) —
the same "by name, not by provenance" convention `capability-call.ts`'s
`isCapabilityCall` already established for `stable-operation-reference`
and `no-raw-external-io`. Deliberately does not resolve an import, confirm
the base expression actually came from `createData`/`buildData`, or trace
through an intermediate alias (`const f = x.fields; const { ...rest } =
f;` is one hop this rule declines to follow) — matching ADR 0060's own
"one level" scope for the build-time scanner this rule mirrors at lint
time instead of build time. Passing the whole `.fields` object as a single
_named_ prop (`<Child data={userData.fields} />`) is deliberately left
alone: it's still `indeterminate` in the generated report, but it doesn't
erase field-level granularity the way a spread or a rest element does, so
it stays below this rule's bar.

## Consequences

- The single highest-risk shape ADR 0060 made _provable as uncertain_ (a
  capability's fields wholesale-escaping into a spread) is now also
  _catchable before merge_, at the point a developer writes it, instead of
  discoverable only by reading a generated report section after the fact.
- Like `stable-operation-reference`'s own name-matching and
  `no-raw-external-io`'s own global-name matching, this rule can be
  fooled: an unrelated object that happens to expose a `.fields` property
  or a `.getSnapshot()` method is indistinguishable from a real capability
  to this rule. Stated plainly in the rule's own doc comment, not hidden —
  the same tradeoff this plugin has already accepted twice before for the
  same reason (a lint rule operating on one file's AST cannot resolve
  cross-file import provenance without a full type-checker, which none of
  this plugin's rules require consumers to configure).
- `no-raw-external-io` (previously undocumented in any ADR) is retroactively
  covered by this decision's "each rule independently justified" framing;
  its own mechanics remain as documented in its file header and in
  `GUIDE.md`'s ESLint plugin section, which now also names it explicitly
  (it was implemented and tested but never mentioned there before this
  audit either).

## Alternatives considered

- **Leave ADR 0038 as the sole governing document and simply not update
  it.** Rejected — a design document that says "exactly one rule" sitting
  next to four real rules is exactly the kind of drift this whole
  cross-package audit exists to catch and fix, not perpetuate.
- **Gate `no-fields-spread` on the capability's own declared sensitivity**
  (only flag a spread when at least one field is marked sensitive).
  Rejected — sensitivity metadata is a build-time fact
  (`documentData()`'s own declaration, cross-referenced by `data-cap/build`
  across the whole project); a single-file lint rule has no sound way to
  know which capability's fields are sensitive without either a
  project-wide manifest lookup (a new, heavier dependency this plugin has
  never needed) or a naming heuristic (contradicting "provable, not
  heuristic"). Flagging every wholesale escape regardless of sensitivity
  matches how the build-time scanner itself works too — ADR 0060 widens to
  `indeterminate` unconditionally; sensitivity-based severity is a
  downstream reporting concern, not a gate on whether the escape is
  detected at all.
- **Also flag a bare whole-`.fields` value passed as a single named JSX
  prop** (`<Child data={userData.fields} />`). Rejected for this rule
  specifically — narrower than a spread/rest (the prop name at least names
  what's being passed, and the receiving component's own prop type still
  constrains what it reads), and already visible as `indeterminate` in the
  generated report. Revisit if real-world usage shows this shape causing
  the same kind of silent, unnoticed drift the spread/rest shapes do.
- **A general "no wholesale object escape" rule, not specific to
  data-cap's own `.fields`/`getSnapshot()` vocabulary.** Rejected — would
  flag every spread in a codebase regardless of relevance, the opposite of
  "a mistake class specific enough to this package's own architecture"
  ADR 0038 (and this decision) require.
