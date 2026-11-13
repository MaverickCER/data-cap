# Manifest/docs/ownership/flow/evidence generator

This script generates these artifacts:

- `src/generated/data.manifest.ts`;
- `docs/DATA.md` (the rich Markdown catalog);
- `docs/OWNERSHIP.md` (the dependency & ownership report);
- `docs/flow/` (the Data Flow Diagram + Security Data-Flow Review set);
- `docs/data.evidence.json` (the composed Evidence Model, ADR 0050/0054).

A single `data-cap --location --docs --ownership --flow --evidence` invocation used to write them for this example. Then the first four flags were
removed from the CLI surface.

[ADR 0066](../../../../specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md) explains why: none of manifest/docs/ownership/flow has a real *runtime* consumer. This
example's own `src/main.ts` never imports the generated manifest, and nothing reads the
Markdown/Mermaid artifacts programmatically. So generating them is application-level code now, not a
CLI concern.

## What it calls

[`run.ts`](run.ts) calls `generateDataArtifacts()` directly from `data-cap/build` (fully exported).
This is the same orchestrator the removed CLI flags called internally. It composes
`generateManifest`/`generateDocumentation`/
`generateUsage`/`generateFlow` over one shared discover → link → inventory → scan pass. Here it is invoked directly
instead of through argv parsing.

It requests `evidence` too. So the Evidence Model this run writes includes every requested pass's own finding kinds (manifest export-collision, flow's
sensitive-boundary findings). See its own
header comment for two things:

- why that matters;
- why `npm run docs` still runs a standalone `data-cap --evidence` CLI step first, even though this
  script's own richer pass immediately supersedes its write. That step is a real, minimal exercise
  of the one flag the CLI still has.

[`check.ts`](check.ts) is the `--check` counterpart, via the same package's exported
`checkArtifacts()`. That is the removed
`data-cap --check --location --docs --ownership --flow` combination's own function. `check.ts` calls it directly with the same
(evidence-inclusive) options `run.ts` passes to `generateDataArtifacts()`.

`npm run check` (see `package.json`) runs only this script. It does not run a separate
`data-cap --check --evidence`. That would recompute the thinner, CLI-flags-only Evidence Model and
always report the richer committed file stale.

## Running it

```bash
npm run docs
```

This chains a standalone `data-cap --root . --include "src/**" --evidence
docs/data.evidence.json` CLI step first. Then it runs this script, which recomputes and overwrites
`docs/data.evidence.json` with the fuller version. `npm run check` runs `check.ts`
directly; see `package.json`.
