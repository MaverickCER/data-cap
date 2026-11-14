# eslint-plugin

`data-cap/eslint-plugin`: lint rules that keep capability code readable by the build pass:
`stable-operation-reference`, `no-raw-external-io`, `no-fields-escape` and `no-node-fs`.

## Variables

### default

```ts
const default: {
  rules: {
     "no-fields-escape": RuleModuleWithName<"prop" | "spread" | "argument" | "exported", [RuleOptions], unknown, RuleListener>;
     "no-node-fs": RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
     "no-raw-external-io": RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
     "stable-operation-reference": RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener>;
  };
};
```

`data-cap/eslint-plugin`: a flat-config-shaped plugin object
({ rules: { ... } }), consumed as:

  import dataCapPlugin from "data-cap/eslint-plugin";
  export default [{ plugins: { "data-cap": dataCapPlugin }, rules: { "data-cap/stable-operation-reference": "warn" } }];

#### Type Declaration

##### rules

```ts
rules: {
  "no-fields-escape": RuleModuleWithName<"prop" | "spread" | "argument" | "exported", [RuleOptions], unknown, RuleListener>;
  "no-node-fs": RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
  "no-raw-external-io": RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
  "stable-operation-reference": RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener>;
};
```

Every rule this plugin ships, keyed by its flat-config rule name.

###### rules.no-fields-escape

```ts
"no-fields-escape": RuleModuleWithName<"prop" | "spread" | "argument" | "exported", [RuleOptions], unknown, RuleListener> = noFieldsEscape;
```

See [noFieldsEscape](#nofieldsescape).

###### rules.no-node-fs

```ts
"no-node-fs": RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener> = noNodeFs;
```

See [noNodeFs](#nonodefs).

###### rules.no-raw-external-io

```ts
"no-raw-external-io": RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener> = noRawExternalIo;
```

See [noRawExternalIo](#norawexternalio).

###### rules.stable-operation-reference

```ts
"stable-operation-reference": RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener> = stableOperationReference;
```

See [stableOperationReference](#stableoperationreference).

***

### noFieldsEscape

```ts
const noFieldsEscape: RuleModuleWithName<"prop" | "spread" | "argument" | "exported", [RuleOptions], unknown, RuleListener>;
```

Flags a capability's whole `.fields` (or a bare `getSnapshot()` result)
escaping this file's local, single-`.fields.<name>`-read visibility.
The escapes are a spread into JSX or an object literal, a rest-element
destructure, a bare function argument or named JSX prop, and an export
(direct, or returned from an exported function). Flagging
them keeps field-level data flow provable by data-cap's build-time
scanner instead of silently escaping it.

#### Remarks

**Exact matching rule, deliberately kept purely structural.** Matched by
property/method name alone (`.fields`, `.getSnapshot()`), like
`stable-operation-reference`'s `createData`/`buildData` name matching.
This never resolves an import or confirms the base expression is
actually a data-cap capability. It also never traces an intermediate
alias. It does not follow `const f = x.fields; const { ...rest } = f;`,
matching the "one level" scope of the build-time scanner in
[ADR 0060](_media/0060-usage-scanner-escape-sites.md).
An unrelated object that merely happens to expose a `.fields` property or
a `.getSnapshot()` method is indistinguishable to this rule and would be
flagged the same way. That
is rare in practice, but a real, documented tradeoff, not an oversight.

A **plain, non-exported local alias** (`const alias = x.fields;`, never
spread, never passed anywhere, never exported) is deliberately never
flagged on its own. Seeing a `const` declaration alone can't tell a
harmless local narrowing (`const f = x.fields; return f.email;`) apart
from a real escape without dataflow tracing this rule doesn't do. See
[ADR 0064](_media/0064-no-fields-escape-export-argument-and-prop.md)
for why *exported* reassignment is flagged (a provable, structural,
module-boundary fact) while plain reassignment stays out of scope (an
unprovable one).

This rule does not itself prove a leak: it proves a *shape* the
build-time scanner cannot see through, the same distinction
`no-raw-external-io`'s own doc comment draws for its own structural
check. `options.allow` exempts whole files by glob.

***

### noNodeFs

```ts
const noNodeFs: RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
```

Flags any `import`/`require`/dynamic `import()` of `node:fs` in library code, so a library surface acquires
its filesystem capability from the caller instead of reaching for `node:fs` itself.

#### Remarks

Nothing is exempt by default. A package's own config allows its CLI folder (for example `src/cli/**`),
which builds the `node:fs/promises` adapter, and a consuming project sets the `allow` option for its own CLI
or script entry points. The rule itself lives in `../_ipc/no-node-fs.ts`, a managed copy of
internal-package-contract's `runtime/no-node-fs.ts`; this supplies data-cap's documentation link and the decision
record the message cites.

***

### noRawExternalIo

```ts
const noRawExternalIo: RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
```

Flags a direct call to a global I/O function (`fetch` by default) outside a
capability's own `execute` or `subscribe`. External data access then goes
through a declared capability operation the build pass can read.

#### Remarks

**Exact matching rule, deliberately kept purely structural.** A
`fetch(...)` is exempt the moment it is lexically inside an
`execute`/`subscribe` function of an operation declared in a
`buildData`/`createData` call's `getters`/`mutators`/`subscriptions`
section: position alone. There is no cross-referencing against declared
`endpoints` metadata, no URL matching, and no inspection of what the
operation's body actually does. An operation body is opaque to `data-cap`'s
static analysis by design (`AGENTS.md` invariant 6). A rule that peeked
inside one would be the first thing in this package to break that.

The consequence is worth stating plainly: this rule proves *where* a call
is written, never that the capability declaring it is honest about what it
fetches. It is a structural convention check, not a security control.

`options.functions` names *global* identifiers, so the rule never learns
about a specific HTTP client library; `options.allow` exempts whole files
by glob, for a project's own transport layer or scripts.

***

### stableOperationReference

```ts
const stableOperationReference: RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener>;
```

Flags an `execute`/`subscribe` value inside a `createData()` call that
isn't a reference to a stable, module-level function, so the runtime
coordinator's function-identity-based sharing/deduplication actually
applies.

#### Remarks

Function identity controls sharing, not function syntax. An inline arrow
function is a fresh identity every time the surrounding code runs. To the
coordinator, that looks the same as opting out of sharing on purpose. The
same is true of an identifier that merely *looks* like a stable reference
syntactically but resolves to a binding declared inside a function (a
factory, a component, a parameter). That binding is a fresh identity every
time the enclosing function runs, exactly like an inline literal would be.
This rule makes both hard-to-spot cases visible; arrow functions stay
allowed. `execute: myStableArrowFunction`, declared at module scope or
imported, shares exactly like a `function` declaration and is never flagged.

What this rule deliberately does not attempt: proving stability through
a `CallExpression` (`execute: makeGetUser()`), a `MemberExpression`
(`execute: someObject.getUser`), a conditional, or cross-module aliasing.
Those are outside what static analysis can reliably decide; the runtime
coordinator's own behavior must stay correct independent of this rule.
