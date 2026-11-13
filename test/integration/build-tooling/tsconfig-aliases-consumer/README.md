# tsconfig-aliases-consumer

**Build tooling.** `linkCapabilityFiles`'s `packages` option allow-lists an
installed package by name. A `fields` reference that bare-imports from it
then resolves to the schema file that package declares via its own
`package.json#dataCap.schema` field. That is a real versioning/trust boundary
crossing, unlike `tsconfig-aliases/`'s same-project alias.

`shared-schema-package/` is a second, local "published" package (never
actually published to npm) installed via `file:./shared-schema-package`. It mirrors how a real monorepo or a real published schema package would be
consumed.

## Run it

```sh
npm install
npm start
```

## What it proves

- A `fields` reference reaching into a _different_ package resolves
  correctly when that package is explicitly allow-listed via `packages`.
- Without the allowlist, the same reference is reported as an unresolved
  reference: never silently guessed at, never resolved implicitly.
