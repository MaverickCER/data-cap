---
"data-cap": minor
---

The usage scan and change-detection/citation-verification no longer silently skip when only `--evidence` is requested.

Previously, the Dependency Model (`evidence.dependency`) was only populated when `--ownership` or `--flow` was also passed, and the Change Model (`evidence.change`) plus dynamic-access citation freshness-verification were only computed when `--location` was also passed. A caller that only ever requests `--evidence` -- the expected pattern once the CLI's flag surface narrows down to just `--evidence` -- got a materially thinner Evidence Model as a result: no proven consumption edges, no blast-radius/change-since-last-run facts, and no citation staleness findings.

Both now run unconditionally alongside `--evidence`:

- The usage scan (proven consumption positions, dependency edges, ownership/abandonment findings) always runs. `--ownership` now only controls whether the rendered Dependency & Ownership report is additionally written to disk.
- Change-detection (a real manifest diff against the persisted `.data-cap-manifest-snapshot.json` sidecar) and dynamic-access citation freshness-verification now run whenever `--location` OR `--evidence` is requested, not only `--location`. The manifest snapshot sidecar's own read/write now follows the same broadened gate; only `manifest.ts`'s own file write stays exclusively gated on `--location`.

`ReportResult.usage` is now always present (no longer `| undefined`). `--check`'s own staleness comparison now also masks `EvidenceModel.change` the same way it already masks `provenance.generatedAt`, since a manifest diff is inherently not reproducible by a second computation.
