# tsconfig-aliases

**Build tooling.** `discoverCapabilityFiles`/`linkCapabilityFiles`
statically resolve a `buildData()` call's `fields` reference across files
-- including through a `tsconfig.json` path alias (`@schemas/*`), exactly
the way `tsc` itself resolves it. Nothing here ever imports, requires, or
evaluates `user-capability.ts` -- only its AST is read.

## Why this example exists separately from ordinary cross-file resolution

Following a `fields` reference across a relative import (`./schemas/user`)
needs no special handling -- `resolve-import.ts` already resolves that the
same way Node/`tsc` would. A `tsconfig.json` `paths` alias is a different,
harder case: `@schemas/user.js` in `src/user-capability.ts` isn't a
relative or package specifier at all, it only resolves if the build tooling
separately loads and interprets `tsconfig.json`'s own `paths`/`baseUrl`
configuration (see `resolve-tsconfig-paths.ts`) -- this example exists
specifically to prove that path is exercised for real, not just that plain
relative imports work ([`../../runtime-core/basic-standalone/`](../../runtime-core/basic-standalone/)
and most other examples/fixtures never touch this code path at all, since
none of their schemas use an alias).

`src/user-capability.ts`'s `documentData()` call references the exact same
imported `userFields` identifier `buildData()` does -- proving correlation
(matching a `documentData` call to the capability it documents) still works
when the shared identifier itself was only reachable through the alias, not
just when it's a local same-file const.

## Run it

```sh
npm install
npm start
```

`npm start` runs `discoverCapabilityFiles`/`linkCapabilityFiles` against
this example's own `src/`, asserts on the result, and writes `output.json`
-- compared against `expected/output.json` in CI.

## What it proves

- A `fields` reference that only resolves through a `tsconfig.json` path
  alias is followed correctly to its real object literal.
- A `documentData()` call sharing the same aliased `fields` identifier
  correlates with its `buildData()` capability.
- No unresolved-reference warnings are produced when alias resolution
  succeeds.

## Where to go next

- [`../tsconfig-aliases-consumer/`](../tsconfig-aliases-consumer/) -- the companion cross-package
  case: an allow-listed *installed package* declaring its own schema via
  `package.json#dataCap.schema`, resolved the same way a relative or
  aliased import would be, but across a package boundary instead of within
  one project.
- `specs/decisions/0032-tsconfig-path-alias-resolution-ported.md` for why
  this resolution logic exists at all (ported from, and kept in sync with,
  `env-cap`'s own equivalent resolver).
