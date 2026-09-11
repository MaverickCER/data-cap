# Build-time performance benchmark

Measures `discoverCapabilityFiles()` and the full `generateDataArtifacts()` pipeline (discover -> link ->
inventory -> manifest/documentation/ownership/flow/evidence generation, then write) as capability-file count
scales. See [`../README.md`](../README.md) for full methodology, tier definitions, and the "never compare"
rules. This README covers only what's specific to this example.

## Run it

```bash
npm install
npm run build --prefix ../.. # generateDataArtifacts's parsing needs a built dist/ to run against, the same as any real consumer
npm run benchmark
```

A real `npm install` here (not a monorepo-relative import) -- `data-cap` is a `file:../..`
dependency, so `data-cap/build` resolves exactly as a real consumer's `npm install` would (real
`exports` map, real `dist/build.js`), never a `../../dist/build.js` shortcut.

Writes `results.json` and `RESULTS.md`, both committed. `fixtures/` (the generated `.ts` capability trees
plus scratch manifest/docs/ownership/flow/evidence output from each sample) is entirely gitignored.

## What's measured

Two named benchmarks, both tiered `baseline`/`stress`/`extreme` by **capability-file count** (10/100/400) --
data-cap's build tooling scales with how many capability files a monorepo declares, a structurally different
axis from the runtime suite's fetched-collection-size tiers (see `../README.md`'s "Two independent axes").

- **`discovery`** -- `discoverCapabilityFiles()` alone. Filesystem-traversal-bound, independent of per-file
  content.
- **`artifacts`** -- the flagship number: `generateDataArtifacts()`'s full cost (one shared discover -> link
  -> inventory pass, then every requested generator against that same inventory instance -- manifest,
  documentation, ownership/usage scan, flow diagram, evidence model -- then writes all of it). Fixture
  capability files are realistic literal schemas (varied field/getter/mutator shapes, real `documentData()`
  calls, varied owner/department/residency/endpoint-URL per file so no two are byte-identical) -- mirroring
  [`examples/enterprise-platform/src/capabilities/projects.capability.ts`](../../examples/enterprise-platform/src/capabilities/projects.capability.ts),
  not a toy shape. AST-parsing cost genuinely depends on this source-text volume and variety, and build
  tooling never executes a discovered file (never `import()`/`eval()` -- see `src/build/parse.ts`'s own
  doc comment), so this realism costs nothing at measurement time.

## What's deliberately not here

env-cap's own build-time suite has a `standalone-vs-combined` benchmark validating its ADR 0011 shared-pass
design (comparing one combined `generateEnvArtifacts()` call against three standalone generators, each
redundantly re-discovering). **data-cap has no equivalent redundant-rediscovery antipattern to benchmark
against**: `generateManifest`/`generateDocumentation`/`generateFlow` are pure functions of an
already-built `CapabilityInventory` -- there is no code path by which calling one standalone could trigger
its own discovery pass, so the "naive" comparison point env-cap's benchmark exists to catch simply cannot
happen here. This is a stronger API design than a benchmark result, not a benchmarking gap -- see
`src/build/generate-manifest.ts`'s own doc comment ("Pure -- takes an already-built `CapabilityInventory`
... performs no discovery, linking, or filesystem access itself").

Also considered and cut, matching `../README.md`'s "what's not (yet) benchmarked" posture: a
`documentation-payload`-equivalent (isolating docs-payload size independent of capability count) and a
`scoped-include`-equivalent (the `include` option's discovery-vs-parse split) -- both real, narrower
questions than `discovery`/`artifacts`, deferred rather than rushed.
