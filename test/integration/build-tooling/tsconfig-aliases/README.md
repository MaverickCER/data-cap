# tsconfig-aliases

**Build tooling.** `discoverCapabilityFiles`/`linkCapabilityFiles`
statically resolve a `buildData()` call's `fields` reference across files.
That includes a `tsconfig.json` path alias (`@schemas/*`), resolved exactly
the way `tsc` itself resolves it. Nothing here ever imports, requires, or
evaluates `user-capability.ts`; only its AST is read.

## Why this example exists separately from ordinary cross-file resolution

Following a `fields` reference across a relative import (`./schemas/user`)
needs no special handling: `resolve-import.ts` already resolves that the
same way Node/`tsc` would. A `tsconfig.json` `paths` alias is a different,
harder case. `@schemas/user.js` in `src/user-capability.ts` isn't a
relative or package specifier at all. It only resolves if the build tooling
separately loads and interprets `tsconfig.json`'s own `paths`/`baseUrl`
configuration (see `resolve-tsconfig-paths.ts`).

This example exists specifically to prove that path is exercised for real,
not only that plain relative imports work.
[`../../runtime-core/basic-standalone/`](../../runtime-core/basic-standalone/)
and most other examples/fixtures never touch this code path at all, since
none of their schemas use an alias.

`src/user-capability.ts`'s `documentData()` call references the exact same
imported `userFields` identifier `buildData()` does. This proves correlation
(matching a `documentData` call to the capability it documents) still works
when the shared identifier was only reachable through the alias. It is not
limited to a local same-file const.

## Run it

```sh
npm install
npm start
```

`npm start` runs `discoverCapabilityFiles`/`linkCapabilityFiles` against
this example's own `src/`, asserts on the result, and writes `output.json`.
CI compares it against `expected/output.json`.

## What it proves

- A `fields` reference that only resolves through a `tsconfig.json` path
  alias is followed correctly to its real object literal.
- A `documentData()` call sharing the same aliased `fields` identifier
  correlates with its `buildData()` capability.
- No unresolved-reference warnings are produced when alias resolution
  succeeds.

## Where to go next

- [`../tsconfig-aliases-consumer/`](../tsconfig-aliases-consumer/): the companion cross-package
  case. An allow-listed *installed package* declares its own schema via
  `package.json#dataCap.schema`. It is resolved the same way a relative or
  aliased import would be, but across a package boundary instead of within
  one project.
- `specs/decisions/0032-tsconfig-path-alias-resolution-ported.md` for why
  this resolution logic exists at all (ported from, and kept in sync with,
  `env-cap`'s own equivalent resolver).
