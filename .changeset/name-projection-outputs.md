---
"data-cap": minor
---

`data-cap/build` exports the return types of the five reference projections (`ProjectAuditEvidenceOutput`, `ProjectClassificationEvidenceOutput`, `ProjectComplianceEvidenceOutput`, `ProjectPrivacyEvidenceOutput`, `ProjectRetentionEvidenceOutput`), so a caller can name what `projectAuditEvidence()` and the others return, and `UNOWNED` is typed as its literal `"(unowned)"`, so an owner can be narrowed against it.
