<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Dependency & Ownership Report

## Ownership matrix

### engineering-ops

Capabilities: `projectsData`
Fields: `projectsData.projects`

### finance-team

Capabilities: `billingData`
Fields: `billingData.invoices`

### platform-security

Capabilities: `identityData`
Fields: `identityData.currentUser`

## Capability-to-capability dependencies

_Edges statically proven where one capability's own file imports and uses another._

_No capability statically depends on another capability._

## Consumers per capability

### `billingData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/components/BillingPanel.tsx:26:10` | calls-getter | listInvoices | resolved |
| `src/components/BillingPanel.tsx:27:21` | calls-subscription | subscribeToInvoices | resolved |
| `src/components/BillingPanel.tsx:41:37` | calls-mutator | markInvoicePaid | resolved |
| `src/components/BillingPanel.tsx:49:37` | calls-mutator | disputeInvoice | resolved |
| `src/components/BillingPanel.tsx:61:16` | calls-mutator | createInvoice | resolved |
| `src/server/legacy-compliance-sync.ts:26:19` | reads-field | — | indeterminate |

### `identityData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/components/Login.tsx:32:13` | calls-getter | getCurrentUser | resolved |
| `src/routes.tsx` | imports | — | resolved |
| `src/server/legacy-compliance-sync.ts:33:19` | reads-field | — | indeterminate |

### `projectsData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/components/ProjectsPanel.tsx:23:10` | calls-getter | listProjects | resolved |
| `src/components/ProjectsPanel.tsx:42:16` | calls-mutator | createProject | resolved |

## Findings

| Severity | Code | Capability | Message |
| --- | --- | --- | --- |
| info | INDETERMINATE_CONSUMER | `billingData` | "src/server/legacy-compliance-sync.ts" accesses "billingData" using a dynamic/computed property -- can't be statically characterized. |
| info | FIELD_DYNAMIC_ACCESS_DECLARED | `billingData` | Per developers, this data point is dynamically accessed at src/server/legacy-compliance-sync.ts:26:19. |
| info | INDETERMINATE_CONSUMER | `identityData` | "src/server/legacy-compliance-sync.ts" accesses "identityData" using a dynamic/computed property -- can't be statically characterized. |
| info | FIELD_ACCESS_INDETERMINATE | `identityData` | Field "currentUser" on "identityData" appears unused, but there are instances of dynamic/computed access on this capability that can't be statically attributed to a specific field -- it may be one of them. |
| warning | UNCONSUMED_FIELD | `projectsData` | Field "projects" on "projectsData" is written but never statically read in the scanned project. |
