# 0064: `no-fields-spread` becomes `no-fields-escape` — adds argument, named-prop, and exported-reassignment escapes

## Status

Accepted. Renames `src/eslint-plugin/no-fields-spread.ts` to
`src/eslint-plugin/no-fields-escape.ts` (`git mv`), registered under the new
flat-config name `no-fields-escape` in `src/eslint-plugin/index.ts`; covered
by `test/eslint-plugin/no-fields-escape.test.ts` and
`test/eslint-plugin/index.test.ts`. Supersedes [ADR 0063](0063-eslint-plugin-multiple-rules-and-no-fields-spread.md)'s
scope for this one rule — 0063's own history (why the rule exists at all,
why it's independently justified against the plugin's shared bar) still
stands unedited; only the rule's name and the set of shapes it flags change
here.

## Context

A direct question about this plugin's own soundness asked whether the AST
can trace a variable's renaming and reassignment across files. It can't —
and 0063 already declined to try, by design (`capability-call.ts`'s own
"by name, not by provenance" convention, restated in `no-fields-spread`'s
own doc comment: no import resolution, no cross-file tracing). The
follow-up question was narrower and more useful: absent general dataflow
tracing, is there a lint rule that at least catches a `.fields` value being
handed off as a function argument, a named prop, or reassigned in a way
that leaks it out of this module? `no-fields-spread` only covered spread
and rest-destructure. Two of those three shapes were previously considered
and explicitly deferred:

- **Bare call argument** (`doSomething(x.fields)`) wasn't mentioned in 0063
  at all — an oversight, not a considered rejection.
- **Named JSX prop** (`<Child data={x.fields} />`) was considered and
  rejected in 0063's own "Alternatives considered", on the reasoning that a
  named prop at least tells a reader _something_ is being passed, and the
  receiving component's own prop type still constrains what it reads.
  Asked directly whether it should stay out, that reasoning didn't hold up
  well enough to leave it unflagged: this rule doesn't know what the
  receiving component's prop type actually constrains (it's a single-file,
  structural rule, same as ADR 0060's own build-time scanner), so "the
  component's type constrains it" was an assumption the rule has no way to
  verify. Revisited and now flagged.
- **Reassignment** is the shape that needed real design work, not just a
  scope call. A blanket "flag every reassignment of a `.fields` value" rule
  would be pure noise — `const f = x.fields; return f.email;` is a
  completely harmless local narrowing, and no single-file AST rule can
  soundly tell that apart from a real escape without dataflow tracing this
  plugin has never done and isn't taking on now. The explicit ask was
  narrower: target reassignment specifically when it's _exported_ in a
  manner that would leak a secret. That reframing turns an unsound
  heuristic into a structurally provable check: unlike a local alias, an ES
  module `export` is always a top-level `Program` statement (no
  conditional or nested export exists in the language), and a top-level
  name can't collide with another declaration of the same name in the same
  module (a duplicate declaration is a parse error). That means "is this
  value reachable through this module's own export surface" is answerable
  by scanning `program.body` alone, with the same soundness guarantee
  ADR 0060's build-time scanner already relies on — no scope-manager
  resolution, no cross-file import tracing, just the parser's own
  guarantees about where `export` can appear.

## Decision

**Rename `no-fields-spread` to `no-fields-escape`** — the rule now covers
more than spreading, and the old name undersold it.

**Add three new escape kinds**, each its own message id so a report names
exactly which shape it saw, alongside the existing `spread` kind:

- **`argument`** — `x.fields` (or a bare `getSnapshot()` result) passed as
  one of a `CallExpression`/`NewExpression`'s own arguments
  (`doSomething(x.fields)`, `new Sink(x.fields)`), at any argument
  position, never the callee itself.
- **`prop`** — the same value as the expression inside a single, _named_
  JSX attribute (`<Child data={x.fields} />`) — as opposed to a spread
  attribute, which `spread` already covers. A raw JSX _child_ expression
  (`<Child>{x.fields}</Child>`) is a different AST shape (a
  `JSXExpressionContainer` whose own parent is the element, not an
  attribute) and stays out of this rule's scope for the same reason a
  named object-literal property does: revisit if real usage shows it
  causing the same silent drift.
- **`exported`** — `x.fields` (or `getSnapshot()`) is:
  - the initializer of a top-level `const`/`let`/`var` binding that is
    itself exported, directly (`export const leaked = x.fields;`) or later
    by name via a same-file `export { leaked };`, or
  - returned from a function that is itself exported this same way — a
    named `export function`, an arrow assigned to an exported `const`
    (implicit- or explicit-return body), or a function declaration/
    expression later re-exported by name.

  A **plain, non-exported local alias** (`const alias = x.fields;`) stays
  explicitly out of scope, on purpose — this is the one place this rule
  follows a value past its immediate expression at all, and it only does
  so because `export` is the provable fact, not because it started
  tracing assignments in general. `default` exports
  (`export default x.fields;`, `export default function() { return
x.fields; }`) are a known, deliberate gap — see "Alternatives
  considered".

Matched, as every shape in this rule already is, by property/method name
alone (`.fields`, `.getSnapshot()`) — never by resolving whether the base
expression is actually a data-cap capability. Same tradeoff 0063 already
accepted twice over; restated, not re-litigated, here.

## Consequences

- Three more real escape shapes are caught before merge instead of only
  showing up as `indeterminate` in a generated report someone might not
  read.
- The rule's file (`no-fields-escape.ts`) now carries meaningfully more
  structural reasoning than 0063's spread/rest version — several of its
  helper checks lean on "this is the only child slot a `MemberExpression`/
  `CallExpression` could occupy here" arguments (mirroring `isSpread`'s own
  `JSXSpreadAttribute`/`SpreadElement` reasoning) to stay sound without a
  scope manager. Each is stated in the function's own doc comment, not
  hidden.
- Default-exported values/functions are not yet recognized as `exported`.
  A default export is a real, provable module-boundary crossing by the
  same reasoning as a named one, but wiring it in touches enough of
  `isDeclarationExported`/`isFunctionExported`'s shared logic (particularly
  the one place `FunctionDeclaration.id` is legitimately nullable — an
  anonymous `export default function() {}` — which TSESTree's own types
  already tie to exactly that parent) that it's being deferred rather than
  folded in as an afterthought. The rule's own tests assert this gap fails
  _closed_ (never flagged, never crashes) rather than silently.

## Alternatives considered

- **Trace reassignment generally, flag every hop.** Rejected — the
  motivating question ("does the AST support tracking renaming across
  files") already answered itself: no, not without a full scope
  manager/type checker this plugin has never required consumers to
  configure, and flagging harmless local narrowing (`const f = x.fields;
return f.email;`) would be pure noise with no actionable fix.
- **Gate the `exported` kind on the capability's declared sensitivity.**
  Rejected for the same reason 0063 already rejected it for spreads:
  sensitivity is a build-time fact (`documentData()`'s own declaration),
  not something a single-file lint rule can soundly look up.
- **Handle `export default` in this same pass.** Deferred, not rejected —
  see "Consequences" above. Tracked as a real, stated gap rather than
  silently expanding scope mid-rename.
- **Leave the named-JSX-prop case out, per 0063's original call.**
  Rejected on reconsideration — the reasoning 0063 gave (the receiving
  component's prop type constrains what it reads) isn't something this
  rule, or the build-time scanner it mirrors, can actually verify; it was
  an assumption, not a structural guarantee, and doesn't hold up once
  asked directly.
