---
"data-cap": patch
---

Mostly documentation and message wording. Two compatible changes reach behaviour: the script `data-cap init` scaffolds gains a `--check` mode, and `checkArtifacts()` stops reporting a freshly written catalog as stale.

- Messages and generated text no longer use `--` as a dash. This covers finding messages, error messages, `data-cap init` output and help, ESLint rule messages, the Runtime Contract Model statements, the JSON Schema descriptions, and the flow text, DOT, Mermaid, OSCAL and Action-summary renderings. Codes, keys, message ids and the generated-file banner are unchanged. CycloneDX annotation text keeps its wording, because it seeds each annotation's `bom-ref`.
- `GUIDE.md` lists `FlowModelError` with the other `DataCapError` classes and names the input checks that throw a plain `RangeError`, `TypeError` or `Error`. `test/docs-error-codes.test.ts` fails when an exported `DataCapError` subclass is missing from that table.
- The `#### Getters`, `#### Mutators` and `#### Subscriptions` headings of the generated `DATA.md` are now in the surface baseline, so renaming one needs a changeset.

- The agent skill's API reference lists every export again, including the flow functions of `./evidence` (`traceFlow`, `diffFlow`, `observedFlow` and the rest). It was generated from baselines two releases old.
- Sentences that said a CI job "does not block a merge" now say that the `required` check waits for it. The branch ruleset requires `required`.
- A failed benchmark job now fails `contract` as well, so it can no longer pass a merge by skipping the other gate jobs.
- The size-budget sentences say that `./build`, `./eslint-plugin` and the CLI have a 999 KB ceiling that only catches runaway growth.
- Coverage floors: the docs no longer say they are "never lowered"; nothing enforces that, so they say a lowered floor is a visible diff.
- SECURITY's workflow sentence names what the checks enforce (SHA pins) and what they do not (permission scopes).
- The ROPA example calls its output an illustration that can support a privacy review, not a complete record.
- The npm description, README, landing page and agent skill share one pitch: "Declare who owns your app's data and how it may be handled. Lint and build checks enforce those rules, and the data documentation regenerates from your code, so it never falls behind." The README shows a real finding right after the try-it commands and how to turn the lint rules, strict flags and stale-docs check on. The npm keywords add `data-governance`, `documentation-generator` and `eslint-plugin`. `test/docs-pitch.test.ts` fails when the pitch, the output excerpts, the status values or the landing page's identifiers drift from their sources.
- The `INDETERMINATE_CONSUMER` and `FIELD_ACCESS_INDETERMINATE` finding messages are split into shorter sentences. Their codes are unchanged.
- `--help` describes `--strict-docs`, `--strict-ownership` and `--strict-flow` in full sentences, lists `-h`, and words a few other flags more plainly. The flag names, defaults and behaviour are unchanged. `test/docs-cli-flags.test.ts` now also fails when a GUIDE flag meaning stops opening with the `--help` text, or when the GUIDE exit-code table and the codes the CLI and the Action set differ.
- `test/docs-skill-imports.test.ts` fails when `docs/skill.json` names a symbol or lint rule that its entry point does not export.
- Every entry point has a one-paragraph summary at the top of its API reference page. Long TSDoc sentences on exported declarations are split, mostly in `./build`, `./evidence` and the root entry. The root entry's summary names the runtimes its tests cover instead of "runs anywhere".
- `BENCHMARKS.md` is re-rendered from the stored results with the current report template. Nothing was measured again.
- `data-cap init` scaffolds a `scripts/generate-data.mjs` with a `--check` mode: it calls `checkArtifacts()`, writes nothing, lists the stale files and exits 1. Without the flag the script behaves as before. `init`'s next steps name it as the CI line and suggest a `check:data` script. `test/cli/quick-start.test.ts` runs the scaffold against the built package.
- `checkArtifacts()` no longer reports the documentation catalog stale right after the run that wrote it. Its "Changes since last report" section depends on the snapshot that run replaced, so the comparison masks it, as it already masked the Evidence Model's `change`.
