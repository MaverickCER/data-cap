---
"data-cap": minor
---

Restricts the CLI to `--evidence` -- the only output with a verified real consumer or a versioned reporting contract (ADR 0050). `--location`, `--docs`, `--ownership`, and `--flow` are removed from the CLI surface: none of the manifest, documentation catalog, dependency & ownership report, or Data Flow Diagram has ever had a verified runtime consumer in this repo's own examples.

The underlying generator functions are **unchanged and remain fully exported** from `data-cap/build`: `generateManifest`, `generateDocumentation`, `generateUsage`, `generateFlow`, and the higher-level `generateDataArtifacts`/`checkArtifacts` orchestrators that compose them (including their own `location`/`docs`/`ownership`/`flow` options). A project that wants any of the four removed artifacts now calls these directly from its own build script -- see `examples/*/scripts/generate-docs/{run.ts,check.ts,README.md}` for a worked pattern used by all four of this repo's own examples, and [ADR 0066](specs/decisions/0066-cli-restricted-to-runtime-and-evidence-output.md) for the full reasoning.

`--expiring-within-days` stays a CLI flag (unlike the equivalent change env-cap made): it feeds the Evidence Model's Lifecycle Model unconditionally, independent of `--docs`. `--strict-docs`/`--strict-ownership`/`--strict-flow` also stay -- the findings they escalate are computed unconditionally alongside `--evidence` (F1/F2), even though `--strict-flow` is now a CLI-level no-op with `--flow` gone (it remains meaningful for a direct `generateDataArtifacts({ flow, strictFlow: true })` library call).

This is a breaking change to the CLI's flag set (minor, per this repo's pre-1.0 semver convention -- see `VERSIONING.md`): any script invoking `data-cap --location/--docs/--ownership/--flow ...` now fails with `Unknown argument: ...` instead of generating output. Migrate by calling the equivalent `data-cap/build` function directly, following the pattern in any of this repo's own `examples/*/scripts/generate-docs/` directories.
