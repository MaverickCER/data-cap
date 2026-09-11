# 0053: Developer-declared `dynamicAccess` citations + their re-verification lifecycle

## Status

Accepted, Part 2B implemented (builds on Part 2A / ADR 0052's five-state
model). Implemented in `src/core/document.ts` (`EvidenceFieldDocs`,
`CapabilityDocs.evidence`), `src/build/parse.ts` (`readDynamicAccessCitations`,
`extractEvidenceDocs`), `src/build/usage-report.ts` (the "declared-dynamic"
precedence, `FIELD_DYNAMIC_ACCESS_DECLARED`), `src/build/manifest-snapshot.ts`
(`CitationSnapshotEntry`, `ManifestSnapshotCapability.citationSnapshots`),
`src/build/citation-verification.ts` (new -- `buildCitationSnapshots`,
`verifyDynamicAccessCitations`), and `src/build/scan-dependencies.ts`
(the `packages`-aware scan-surface extension + scan-boundary disclosure).

## Context

ADR 0052's `FIELD_ACCESS_INDETERMINATE` honestly discloses "this field might
be dynamically accessed, we can't statically prove it" -- but it gives a
developer with real, specific knowledge ("yes, this field is read at
`legacy.ts:42:7`, via a runtime-computed key our static analysis can't
follow") no way to record that knowledge. Left unaddressed, the only escape
hatch would be `metadata` (unstructured, uninspected, no lifecycle) --
exactly the kind of ad hoc convention Part 1/ADR 0051's metadata boundary
rule exists to prevent for a concept `data-cap` actually has a name for.

Two more gaps, found while designing this: `ScanDependenciesOptions.packages`
was accepted but only ever used for import-specifier resolution, never to
extend which files get scanned as consumers at all (so a capability re-
exported and consumed entirely inside an allow-listed package's own source
tree was invisible to `scanDependencies`) -- and a citation, once declared,
was going to need to be re-verified over time, or it would just become
another unfalsifiable claim, no better than not having a citation vocabulary
at all.

## Decision

### `evidence.fields[key].dynamicAccess`, structurally separate from `FieldDocs`

```ts
// core/document.ts
export interface EvidenceFieldDocs {
  readonly dynamicAccess?: readonly string[] // "<relative-path>:<line>:<column>"
}
export interface CapabilityDocs<TFields extends FieldsShape> {
  readonly evidence?: { readonly fields?: Readonly<Record<string, EvidenceFieldDocs>> }
  // ...
}
```

Kept out of `FieldDocs` deliberately (ADR 0051's own "declared, never
verified" invariant applies to every other field there) -- `dynamicAccess`
is the one field in this whole vocabulary that IS re-checked against
reality every run, and living in a visibly separate structure keeps that
epistemic difference legible in the shape itself, not just in a doc
comment. Still authored inside the same `documentData()` call; no second
declaration mechanism.

Extraction (`parse.ts`) follows the same literal-only, warn-not-guess,
drop-the-one-bad-entry-not-the-whole-array discipline every other
extraction in this file already established -- a citation not matching
`"<path>:<line>:<column>"` is dropped individually, with its own
`ParseWarning`.

### The "declared-dynamic" precedence, presence-based

`deriveUsageFindings` (`usage-report.ts`) checks a field's declared
`dynamicAccess` citations **before** falling through to the indeterminate/
unconsumed checks. Any non-empty citation list moves the field out of both
`UNCONSUMED_FIELD` and `FIELD_ACCESS_INDETERMINATE` and emits
`FIELD_DYNAMIC_ACCESS_DECLARED` (`info`) instead, one finding per citation,
rendering the exact developer-facing phrasing requested: _"Per developers,
this data point is dynamically accessed at `path:line:column`."_ This check
is **presence-only** -- it never touches the filesystem, keeping
`deriveUsageFindings` exactly as pure as ADR 0052 already documented it to
be. Staleness is a separate concern, checked separately (below).

### Citation re-verification: two independent findings, deliberately not one merged state

`citation-verification.ts` (new) adds two async, filesystem-touching
functions, kept apart from `manifest-snapshot.ts`'s own synchronous/pure
`buildManifestSnapshot`:

- **`buildCitationSnapshots(inventory, root)`** -- for every currently-
  declared citation that resolves to a real, readable file, computes a
  whole-file SHA-256. Wired into `generate-data-artifacts.ts`'s existing
  manifest call site (only when `--location` is requested, since citation
  verification piggybacks on the exact same previous-run/this-run snapshot
  cycle the manifest diff already reads/writes) and merged into
  `ManifestSnapshotCapability.citationSnapshots` before the snapshot is
  persisted -- the baseline the _next_ run compares against.
- **`verifyDynamicAccessCitations(inventory, previousSnapshot, root)`** --
  for every currently-declared citation, checks it against the _previous_
  run's recorded hash. Two independent failure modes, each its own finding,
  `severity: "warning"`: **`DYNAMIC_ACCESS_CITATION_MISSING`** (the cited
  file no longer resolves at all -- checked fresh every run, no baseline
  needed) and **`DYNAMIC_ACCESS_CITATION_STALE`** (the file resolves, but
  its content hash no longer matches what was recorded last run). A
  citation with no prior recorded hash -- first time seen, or a first run
  with no previous snapshot at all -- is **never** flagged either way: there
  is nothing to have gone stale relative to yet.

**`FIELD_DYNAMIC_ACCESS_DECLARED` and `DYNAMIC_ACCESS_CITATION_STALE`/
`MISSING` are deliberately not mutually exclusive.** The plan this ADR
implements originally described a single five-way state machine including a
`"stale-declaration"` state; implementing it surfaced a real architectural
tension the design hadn't resolved: `deriveUsageFindings` needs to stay
synchronous and filesystem-free (ADR 0052's own contract for it), while
citation staleness fundamentally requires reading files and a persisted
baseline -- two different layers of the pipeline, with different available
inputs. Rather than threading filesystem-derived state back into a function
documented as pure, the two facts are reported as two separate, independently
true findings: `FIELD_DYNAMIC_ACCESS_DECLARED` states what a developer
_asserted_; `DYNAMIC_ACCESS_CITATION_STALE`/`MISSING` state that assertion's
own _current integrity check result_. Both can legitimately fire together
for the same field when a citation goes stale -- exactly the
`NONSTANDARD_SENSITIVITY_LEVEL`-alongside-`SENSITIVE_CAPABILITY_MISSING_
PROTECTIONS` precedent (ADR 0049) this codebase already uses for "two
narrow, true facts about the same thing" rather than one lossy merged state.

**What a passing check actually establishes, precisely** (carried through to
every rendering, per the plan's own guardrail): a matching hash means the
citation is currently _supported by its own citation/integrity state_ -- the
cited file exists and hasn't visibly changed since the developer wrote the
citation. It does **not** mean data-cap has confirmed the field is actually
accessed at that location; that claim was never independently checkable and
is never made. `CitationSnapshotEntry.hash`'s own doc comment states this
directly, and no rendering of a `"declared-dynamic"` field anywhere uses
"verified" or "proven" language.

### `packages`-aware scan surface + the scanned/not-scanned boundary

`scanDependencies` now additionally walks each allow-listed package's own
directory (`discoverCapabilityFiles({root: packageDir})`, reusing
`resolve-package-schema.ts`'s existing manifest resolution for `packageDir`
-- never a second resolution mechanism) and scans those files as potential
consumer source too, not just as one resolved schema-declaring file.
`ScanDependenciesResult.scannedPackages: readonly string[]` reports exactly
which allow-listed packages were actually walked (never a package that
failed to resolve). `renderUsageReport` renders a `## Scan surface` section
-- `Scanned: application source, @foo/bar` / `Not scanned: all other
dependencies.` -- **only when `scannedPackages` is non-empty**: the
zero-packages default is already the ambient assumption stated everywhere
else in this package's own docs, so repeating it on every single report
would add noise, not information.

## Consequences

- A developer can now record genuine, specific knowledge about dynamic
  field access without resorting to `metadata`, and that knowledge is
  actively re-checked, not trusted forever -- the report Part 3
  (`examples/enterprise-platform/`) generates can cite `"declared-dynamic,
currently confirmed"` and `"declared-dynamic, citation stale as of this
run"` as genuinely distinct, source-backed states.
- `ManifestSnapshotCapability` gained an optional field; no
  `MANIFEST_SNAPSHOT_SCHEMA_VERSION`/model schema-version bump -- purely
  additive, same discipline as every other model change this session.
- Citation re-verification is coupled to `--location` (the manifest
  snapshot cycle) -- a project running `--ownership`/`--flow` alone without
  `--location` gets `FIELD_DYNAMIC_ACCESS_DECLARED` (presence-only, free)
  but not staleness re-verification, since there is no persisted baseline
  to compare against without a snapshot file. Documented directly in
  `generate-data-artifacts.ts` at the call site, not left implicit.
- `scanDependencies`'s consumer-file universe can now be genuinely larger
  than the caller's own `files` argument when `packages` is set -- callers
  inspecting `edges` by consuming-file path should be aware a package
  directory's files can now appear there too.

## Alternatives considered

- **A single five-state enum, threading a pre-computed citation-validity
  map into `deriveUsageFindings`.** Rejected during implementation, not at
  design time -- see "Decision" above. The two-separate-findings design
  keeps every existing purity/filesystem-access contract intact and is, on
  reflection, more honest: it doesn't collapse "what was claimed" and
  "whether the claim's own citation still checks out" into one state that
  would have to pick a side.
- **Compute citation hashes inside `buildManifestSnapshot` itself.**
  Rejected -- would make a function this codebase already documents and
  relies on as synchronous/pure into an async, filesystem-touching one,
  a real behavioral contract change with no compensating benefit over a
  small, separate, explicitly-async companion function.
- **Resolve package consumer files via a second, independent directory-walk
  implementation.** Rejected -- `discoverCapabilityFiles` already exists,
  already handles `node_modules`/`.git` pruning and glob matching
  correctly; a second implementation would just be a second thing to keep
  in sync.
- **Always render the scan-surface section, even with zero packages.**
  Rejected -- see "Decision" above; would add a boilerplate section to
  every single report for the common case, diluting the signal for the
  case that actually matters (packages genuinely in scope).
