# Security policy

You are deciding whether to allow `data-cap` into a codebase. Here is what the package protects, what it leaves to the application, and which check fails when a statement stops being true.

## Reporting a vulnerability

Report a suspected vulnerability privately through a [GitHub security advisory](https://github.com/maverickcer/data-cap/security/advisories/new). Private vulnerability reporting is a repository setting; no check fails if it is turned off. Do not open a public issue for a suspected vulnerability.

## Disclosure

Reports are handled in private until they can be disclosed without helping an attacker. Each is acknowledged, then assessed and prioritised by severity, exploitability and impact. Acknowledgement does not promise that the report is accepted or that a fix is possible.

When a fix is ready, a security advisory on this repository names the affected versions, the patched version and the severity. It says what a user can do if they cannot upgrade at once, and whether exploitation is known. It does not publish a working exploit. If a vulnerability is being exploited, or a fix cannot ship promptly, users are warned and given mitigations first. Resolved advisories stay public. These are commitments; no check enforces them.

## What each check covers

| Statement                                                                                                                           | Check that fails when it is false                                                                         | Where it blocks                     | Limit                                                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | ----------------------------------- | ----------------------------------------------------------------------------------------------------- |
| An unowned write is dropped, and the warning never includes the value.                                                              | `test/core/ownership.test.ts`, `test/runtime/capability.test.ts`                                          | `contract`                          | The value check covers one string value on the `createData` path.                                     |
| Every published snapshot is deep-frozen.                                                                                            | `test/core/build.test.ts`, `test/core/patch.test.ts`                                                      | `contract`                          | `Map`, `Set` and `Date` methods can still mutate.                                                     |
| The build tool never evaluates a discovered file.                                                                                   | ESLint `no-eval`, `no-implied-eval`, `no-new-func` over `src/`; `test/build/parse.test.ts`                | `lint`, `contract`                  | No rule forbids a computed `import()` in `src/build`; review holds that.                              |
| `evaluateLiteral` accepts a closed list of literal forms and runs nothing else.                                                     | `test/build/literal-eval.test.ts`                                                                         | `contract`                          | None known.                                                                                           |
| No shipped file reaches `child_process`; only the CLI, `./node` and the ESLint plugin reach `fs`; only the CLI reads `process.env`. | `AmbientCapabilities` over the packed tarball; ESLint `no-restricted-imports`                             | `contract`, `lint`                  | A reach the analysis cannot see is not reported.                                                      |
| Cross-package discovery reads only allow-listed packages, one `package.json` and one file each.                                     | `test/build/resolution/resolve-package-schema.test.ts`                                                    | `contract`                          | None known.                                                                                           |
| `./observe` records names, never values, does no I/O, and imports only types from the package.                                      | `test/observe/observe-value-no-values.test.ts`, `test/observe/isolation.test.ts`                          | `contract`                          | A key that looks like a value is recorded as a name.                                                  |
| The bundled compiler is unreachable from every runtime entry.                                                                       | `internal-package-contract tool compiler-isolation`                                                       | `verify`, which `contract` requires | None known.                                                                                           |
| Dependencies, secrets, licences, Socket alerts, code scanning, dist URLs and minification pass.                                     | `SecurityDeps`, `SecuritySecrets`, `Licenses`, `SecuritySocket`, `CodeScanning`, `DistNoUrls`, `NoMinify` | `contract`                          | A finding can be waived by a record under `.repo-contract/exceptions/`. `SecurityDevDeps` only warns. |
| Each release is the tarball CI built, published with provenance.                                                                    | The shared release workflow's build and publish jobs                                                      | release                             | See [Supply-chain posture](#supply-chain-posture).                                                    |

`contract` and `lint` are the two checks the branch ruleset requires. That is a repository setting; no check fails if it changes.

## Runtime security model

`data-cap` is not an authorization, authentication or encryption system. A field in `fields` does not mean every consumer may read or write it. Access control stays with the application, around the capability.

- **No self-redaction.** `fields` and `info` print as plain objects under `console.log`, `util.inspect` and `JSON.stringify` ([ADR 0006](specs/decisions/0006-no-self-redaction.md)). An application that stores sensitive data in a field redacts it where it logs.
- **Ownership is enforced by warning.** An operation that writes a field it does not own has that write dropped. The development-mode warning names the operation, path and reason, never the value ([ADR 0005](specs/decisions/0005-warn-not-throw-runtime-throw-schema-authoring.md), [ADR 0011](specs/decisions/0011-getter-mutator-ownership-rules.md)).
- **No conflict policy.** The package never applies last-write-wins, first-write-wins or a merge to concurrent writes ([ADR 0023](specs/decisions/0023-no-automatic-rollback-or-conflict-resolution.md)). An application with integrity needs writes its own policy in its processor.
- **Frozen snapshots, with a caveat.** Every published `DataState` is deep-frozen with `Object.freeze` ([ADR 0044](specs/decisions/0044-snapshots-deep-frozen-amortized.md)). `Object.freeze` does not stop `Map.prototype.set`, `Set.prototype.add` or a `Date` setter. For those types, never mutate a value you were handed; nothing detects it.

## Dual-package hazard

`data-cap/runtime`'s `defaultCoordinator` is one per module instance. If your dependency tree loads this package as both ESM and CommonJS, Node creates two instances, each with its own coordinator. No package that ships both formats can prevent this.

`test/runtime/dual-package-hazard.test.ts` pins the consequence ([ADR 0041](specs/decisions/0041-dual-package-hazard-checked-documented.md)). Each coordinator stays correct on its own. Dedup and subscription sharing stop crossing between the two. The test covers Node's two loaders; a bundler that resolves the package twice is not tested.

`FIELD_MARKER` uses `Symbol.for`, so core and runtime still recognise each other's fields when bundled separately (`test/runtime/cross-bundle-field-marker.test.ts`).

## Build-time security model

`data-cap/build` never imports, requires or evaluates a discovered file ([ADR 0002](specs/decisions/0002-build-tooling-static-analysis-only.md)). It reads each file's AST through the TypeScript Compiler API. `evaluateLiteral` accepts a closed list: object, array and primitive literals, and `Date`, `URL`, `RegExp`, `Map` and `Set` with literal arguments. Anything else is reported as unresolvable and never run.

Cross-package discovery resolves only the package names you allow-list, through Node's resolution from your project root. It never scans `node_modules` for schema-like files.

What the package can reach on the machine is checked mechanically:

1. A lint rule bans `node:fs` and `node:child_process` imports in `src/`. Only the CLI may import `node:fs`, to build the filesystem it hands to `./build`.
2. The `AmbientCapabilities` check scans the packed tarball. It fails when a file outside the CLI, `./node` or the ESLint plugin reaches `fs`. It also fails when any file reaches `child_process`, or a file outside the CLI reads `process.env`.
3. A test holds `./observe` to importing only types from the rest of the package, with no `node:` import.

## Application responsibilities

`data-cap` does not decide:

- who may read or write a field;
- how a value is encrypted at rest or in transit;
- how retention or regulatory requirements are enforced;
- what counts as sensitive for your application.

Those stay with the application and its infrastructure. The capability contract makes ownership and dependencies visible to tools that do decide them. The generated reports can support a security or privacy review; they do not establish compliance.

## Supply-chain posture

- **Publishing:** releases go through npm trusted publishing over OIDC (`.github/workflows/release.yml`, which calls a shared, pinned workflow). The repository holds no `NPM_TOKEN` secret today; nothing fails if one is added.
- **What is published:** the release's build job runs `npm run verify`, packs the tarball, installs it into an empty project and imports every entry point. Only then does the publish job publish exactly that tarball, from the default branch, with a provenance attestation.
- **After publishing:** the workflow asks npm for the version and its attestation, and the run fails if either is missing. This check runs after the publish; a failure marks the run red but does not withdraw the version.
- **Workflows:** permissions are least-privilege and actions are pinned by commit SHA. The `GithubActions` and `PinConsistency` checks fail otherwise. The Bun setup step uses the latest Bun.
- **Tests:** coverage floors are 90% branches, 100% functions, and 95% lines and statements (`vitest.config.ts`). The `contract` check fails below them; review raises them and never lowers them. Mutation testing fails `contract` unless every mutant is killed or recorded as equivalent.
- **Runtimes:** each isomorphic entry is smoke-tested under Bun and Deno, one test per entry, in a job that does not block a merge.

[RELEASING.md](RELEASING.md) has the trusted-publisher setup and recovery steps.

## Supported versions

This project has not reached 1.0.

**Before 1.0:** security fixes go to the latest published `0.x` only. There is no long-term-support branch. An older `0.x` does not receive backports; upgrading is the only supported fix. See [VERSIONING.md](VERSIONING.md).

**From 1.0:** security fixes will be backported to the previous major's latest minor. That lasts at least six months after a new major ships ([ADR 0061](specs/decisions/0061-security-backport-window.md)). The window may be extended. Once a minimum end date is stated for a major, it will not be shortened. This is a commitment about a future release line; it has not been exercised yet.
