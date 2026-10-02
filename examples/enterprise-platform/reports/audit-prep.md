# Audit Prep Report

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Presence only, never an adequacy claim: a checked column means the property is declared, never that it is correct, sufficient, or independently verified.

Generated: 2026-10-02T14:03:37.164Z

## Rollup

| Metric | Value |
| --- | --- |
| Capabilities | 3 |
| Owned capabilities | 3 |
| Unowned capabilities | _unavailable_ |
| Findings (info) | 8 |
| Findings (warning) | 3 |

## Capability governance completeness

| Capability | Owner | Sensitivity | Purpose | Legal basis | Data residency | Audit required |
| --- | --- | --- | --- | --- | --- | --- |
| billingData | [x] | [ ] | [x] | [x] | [x] | [x] |
| identityData | [x] | [ ] | [x] | [x] | [x] | [x] |
| projectsData | [x] | [ ] | [x] | [x] | [x] | [ ] |

## Sensitive-field governance completeness

| Field | Owner | Purpose | Legal basis | Data residency | Audit required | Protections | Retention | Handling declared (of endpoints writing this field) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| billingData.invoices | [x] | [x] | [x] | [x] | [x] | [x] | [x] | 5/5 |
| identityData.currentUser | [x] | [x] | [x] | [x] | [x] | [x] | [ ] | 1/1 |
| projectsData.projects | [x] | [x] | [x] | [x] | [ ] | [x] | [ ] | 2/2 |

## Findings

| Severity | Code | Location | Message |
| --- | --- | --- | --- |
| info | INDETERMINATE_CONSUMER | billingData (consumed by src/components/BillingPanel.tsx) | "src/components/BillingPanel.tsx" accesses "billingData" using a dynamic/computed property, or in a way this scanner's local dataflow analysis can't follow (passed elsewhere, assigned to a new binding, spread, returned, or handed to JSX as a prop) -- can't be statically characterized (ADR 0060). |
| info | INDETERMINATE_CONSUMER | billingData (consumed by src/server/legacy-compliance-sync.ts) | "src/server/legacy-compliance-sync.ts" accesses "billingData" using a dynamic/computed property, or in a way this scanner's local dataflow analysis can't follow (passed elsewhere, assigned to a new binding, spread, returned, or handed to JSX as a prop) -- can't be statically characterized (ADR 0060). |
| info | FIELD_DYNAMIC_ACCESS_DECLARED | billingData.invoices | Per developers, this data point is dynamically accessed at src/server/legacy-compliance-sync.ts:26:19. |
| info | INDETERMINATE_CONSUMER | identityData (consumed by src/routes.tsx) | "src/routes.tsx" accesses "identityData" using a dynamic/computed property, or in a way this scanner's local dataflow analysis can't follow (passed elsewhere, assigned to a new binding, spread, returned, or handed to JSX as a prop) -- can't be statically characterized (ADR 0060). |
| info | INDETERMINATE_CONSUMER | identityData (consumed by src/server/legacy-compliance-sync.ts) | "src/server/legacy-compliance-sync.ts" accesses "identityData" using a dynamic/computed property, or in a way this scanner's local dataflow analysis can't follow (passed elsewhere, assigned to a new binding, spread, returned, or handed to JSX as a prop) -- can't be statically characterized (ADR 0060). |
| info | FIELD_ACCESS_INDETERMINATE | identityData.currentUser | Field "currentUser" on "identityData" appears unused, but there are instances of dynamic/computed access, or a reference this scanner's local dataflow analysis can't follow, on this capability that can't be statically attributed to a specific field -- it may be one of them. |
| info | INDETERMINATE_CONSUMER | projectsData (consumed by src/components/ProjectsPanel.tsx) | "src/components/ProjectsPanel.tsx" accesses "projectsData" using a dynamic/computed property, or in a way this scanner's local dataflow analysis can't follow (passed elsewhere, assigned to a new binding, spread, returned, or handed to JSX as a prop) -- can't be statically characterized (ADR 0060). |
| info | FIELD_ACCESS_INDETERMINATE | projectsData.projects | Field "projects" on "projectsData" appears unused, but there are instances of dynamic/computed access, or a reference this scanner's local dataflow analysis can't follow, on this capability that can't be statically attributed to a specific field -- it may be one of them. |
| warning | SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY | billingData.invoices | Field "invoices" on "billingData" is sensitivity "confidential" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected. |
| warning | SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY | identityData.currentUser | Field "currentUser" on "identityData" is sensitivity "confidential" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected. |
| warning | SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY | projectsData.projects | Field "projects" on "projectsData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected. |

