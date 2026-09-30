# Manifest/docs/ownership/evidence generator

Generates `src/generated/data.manifest.ts`, `docs/DATA.md` (the rich Markdown
catalog), `docs/OWNERSHIP.md` (the dependency & ownership report), and
`docs/data.evidence.json` (the composed Evidence Model, ADR 0050/0054) —
what a single `data-cap --location --docs --ownership --evidence`
invocation used to write for this example before the first three flags were
removed from the CLI surface. See
[ADR 0066](../../../../specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md)
for why: none of manifest/docs/ownership has a real *runtime* consumer (this
app never `import`s the generated manifest, and nothing reads the Markdown
catalog programmatically), so generating them is application-level code
now, not a CLI concern. This example never requested `--flow`, so
`generateFlow()` isn't called here either.

## What it calls

[`run.ts`](run.ts) calls `generateDataArtifacts()` directly from
`data-cap/build` (fully exported) — the same orchestrator the removed CLI
flags called internally, composing `generateManifest`/`generateDocumentation`/
`generateUsage` over one shared discover → link → inventory → scan pass, just
invoked directly instead of through argv parsing. It requests `evidence`
too, so the Evidence Model this run writes includes the manifest pass's own
finding kind (export-collision) -- see its own header comment for why that
matters, and why `npm run docs` still runs a standalone `data-cap --evidence`
CLI step first (a real, minimal exercise of the one flag the CLI still has)
even though this script's own richer pass immediately supersedes its write.

[`check.ts`](check.ts) is the `--check` counterpart, via the same package's
exported `checkArtifacts()` — the removed
`data-cap --check --location --docs --ownership` combination's own function,
called directly with the same (evidence-inclusive) options `run.ts` passes
to `generateDataArtifacts()`. `npm run check` (see `package.json`) runs only
this script -- not a separate `data-cap --check --evidence`, which would
recompute the thinner, CLI-flags-only Evidence Model and always report the
richer committed file stale.

## Running it

```bash
npm run docs
```

which chains a standalone `data-cap --root . --include "src/**" --evidence
docs/data.evidence.json` CLI step first, then this script (which
recomputes and overwrites `docs/data.evidence.json` with the fuller
version). `npm run typecheck`/`npm run dev`/`npm run build` all run
`npm run docs` first too; `npm run check` runs `check.ts` directly — see
`package.json`.
