# Manifest/docs/ownership/flow/evidence generator

Generates `src/generated/data.manifest.ts`, `docs/DATA.md` (the rich Markdown
catalog), `docs/OWNERSHIP.md` (the dependency & ownership report),
`docs/flow/` (the Data Flow Diagram + Security Data-Flow Review set), and
`docs/data.evidence.json` (the composed Evidence Model, ADR 0050/0054) —
what a single `data-cap --location --docs --ownership --flow --evidence`
invocation used to write for this example before the first four flags were
removed from the CLI surface. See
[ADR 0066](../../../../specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md)
for why: none of manifest/docs/ownership/flow has a real *runtime* consumer
(nothing in `main-headless.ts` or the service itself imports the generated
manifest, or reads the Markdown/Mermaid artifacts programmatically), so
generating them is application-level code now, not a CLI concern.

This is separate from [`reports/evidence-cache.ts`](../../reports/evidence-cache.ts),
which also passes `location`/`docs`/`ownership`/`flow`/`evidence` to
`computeDataArtifacts()` directly -- but only to populate the composed
`EvidenceModel`'s own finding set (manifest export-collision findings,
flow's sensitive-boundary findings) that
`reports/litigation-evidence.ts`/`reports/audit-prep.ts` read; it never
writes any of those artifacts to disk (see its own header comment). This
script is what actually writes them.

## What it calls

[`run.ts`](run.ts) calls `generateDataArtifacts()` directly from
`data-cap/build` (fully exported) — the same orchestrator the removed CLI
flags called internally, composing `generateManifest`/`generateDocumentation`/
`generateUsage`/`generateFlow` over one shared discover → link → inventory →
scan pass, just invoked directly instead of through argv parsing. It
requests `evidence` too, so the Evidence Model this run writes includes
every requested pass's own finding kinds (manifest export-collision, flow's
sensitive-boundary findings) -- see its own header comment for why that
matters, and why `npm run docs` still runs a standalone `data-cap --evidence`
CLI step first (a real, minimal exercise of the one flag the CLI still has)
even though this script's own richer pass immediately supersedes its write.

[`check.ts`](check.ts) is the `--check` counterpart, via the same package's
exported `checkArtifacts()` — the removed
`data-cap --check --location --docs --ownership --flow` combination's own
function, called directly with the same (evidence-inclusive) options
`run.ts` passes to `generateDataArtifacts()`. `npm run check` (see
`package.json`) runs this script, then
`reports/litigation-evidence.ts --check`/`reports/audit-prep.ts --check` --
not a separate `data-cap --check --evidence`, which would recompute the
thinner, CLI-flags-only Evidence Model and always report the richer
committed file stale.

## Running it

```bash
npm run docs
```

which chains a standalone `data-cap --root . --include "src/**" --evidence
docs/data.evidence.json` CLI step first, then this script (which
recomputes and overwrites `docs/data.evidence.json` with the fuller
version). `npm run check` runs `check.ts`, followed by the two report
scripts' own `--check` modes — see `package.json`.
