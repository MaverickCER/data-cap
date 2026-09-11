# eslint-plugin

## Variables

### default

```ts
const default: {
  rules: {
     no-node-fs: RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
     no-raw-external-io: RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
     stable-operation-reference: RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener>;
  };
};
```

`@maverickcer/data-cap/eslint-plugin` -- a flat-config-shaped plugin object
({ rules: { ... } }), consumed as:

  import dataCapPlugin from "@maverickcer/data-cap/eslint-plugin";
  export default [{ plugins: { "data-cap": dataCapPlugin }, rules: { "data-cap/stable-operation-reference": "warn" } }];

A 6th public entry point alongside `.`, `./runtime`, `./build`,
`./helpers`, and `./evidence`.

#### Type Declaration

##### rules

```ts
rules: {
  no-node-fs: RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
  no-raw-external-io: RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
  stable-operation-reference: RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener>;
};
```

Every rule this plugin ships, keyed by its flat-config rule name.

###### rules.no-node-fs

```ts
no-node-fs: RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener> = noNodeFs;
```

See [noNodeFs](#nonodefs).

###### rules.no-raw-external-io

```ts
no-raw-external-io: RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener> = noRawExternalIo;
```

See [noRawExternalIo](#norawexternalio).

###### rules.stable-operation-reference

```ts
stable-operation-reference: RuleModuleWithName<"inlineFunctionLiteral" | "recreatedPerCall", [], unknown, RuleListener> = stableOperationReference;
```

See [stableOperationReference](#stableoperationreference).

***

### noNodeFs

```ts
const noNodeFs: RuleModuleWithName<"noNodeFs", [RuleOptions], unknown, RuleListener>;
```

Flags any `import`/`require`/dynamic `import()` of `node:fs` in library
code, so a library surface acquires its filesystem capability from the
caller instead of reaching for `node:fs` itself (the same discipline
`repo-contract`'s ADR-0011 established for `child_process`/`process.env`).
See ADR 0058.

#### Remarks

Nothing is exempt by default. data-cap's own config allows `src/cli/**`
(the executable capability boundary that builds the `node:fs/promises`
adapter); a consuming project sets its own `allow` for its own entry
points.

***

### noRawExternalIo

```ts
const noRawExternalIo: RuleModuleWithName<"noRawExternalIo", [RuleOptions], unknown, RuleListener>;
```

Flags a direct call to a global I/O function (`fetch` by default) written
anywhere other than inside a capability's own `execute`/`subscribe`, so
external data access always goes through a declared, analyzable
capability operation instead of being scattered through application code.

#### Remarks

**Exact matching rule, deliberately kept purely structural.** A
`fetch(...)` is exempt the moment it is lexically inside an
`execute`/`subscribe` function of an operation declared in a
`buildData`/`createData` call's `getters`/`mutators`/`subscriptions`
section -- position alone. There is no cross-referencing against declared
`endpoints` metadata, no URL matching, and no inspection of what the
operation's body actually does: an operation body is opaque to `data-cap`'s
static analysis by design (AGENTS.md invariant 6), and a rule that peeked
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

Function identity controls sharing (not function syntax) -- an inline
arrow function is a fresh identity every time the surrounding code runs,
which is indistinguishable, from the coordinator's perspective, from the
developer deliberately opting out of sharing. The same is true of an
identifier that merely *looks* like a stable reference syntactically but
resolves to a binding declared inside a function (a factory, a
component, a parameter) -- that binding is a fresh identity every time
the enclosing function runs, exactly like an inline literal would be.
This rule exists to make both easy-to-miss cases visible, not to ban
arrow functions -- `execute: myStableArrowFunction`, where
`myStableArrowFunction` is declared at module scope (or imported), is
exactly as sharable as a `function` declaration and never flagged.

What this rule deliberately does not attempt: proving stability through
a `CallExpression` (`execute: makeGetUser()`), a `MemberExpression`
(`execute: someObject.getUser`), a conditional, or cross-module aliasing.
Those are outside what static analysis can reliably decide; the runtime
coordinator's own behavior must stay correct independent of this rule.
