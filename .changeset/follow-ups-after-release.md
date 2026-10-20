---
"data-cap": patch
---

- Built with tsup 9, with this month's other development-tool updates; the API-contract check confirms the published API is unchanged.
- `prepare` honours `npm pack --ignore-scripts` itself. npm 10 (Node 22) still runs `prepare` there, which rebuilt `dist/` from scratch and emptied it under anything reading it at the time, such as this repository's tree-shaking tests.
- The release's `version` step regenerates the agent skill and landing page, so a release no longer needs a follow-up commit for them.
- The API pages write `AGENTS.md` as a file name instead of linking it to the unrelated website at `agents.md`.
- SARIF logs point `$schema` at OASIS's published SARIF 2.1.0 schema; the previous address had stopped resolving (404).
