# Litigation Evidence Report

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> This report is illustrative only. It is not legal advice and does not itself establish compliance with any law or regulation -- it demonstrates the mechanism data-cap provides for producing source-cited evidence, nothing more.

Generated: 2026-09-11T20:52:29.641Z

Scanned: application source (src/**)
Not scanned: all other dependencies (no --package allow-list configured for this example)

## billingData.invoices

| Declared fact | Value |
| --- | --- |
| Owner | finance-team |
| Classification (sensitivity) | confidential |
| Purpose | Billing clients and tracking payment/dispute status for financial reporting. |
| Legal basis (declared, not a legal determination) | contract |
| Data residency (permitted storage jurisdiction, declared) | us |
| Audit required | yes |
| Protections (documented, not an adequacy claim) | Session-authenticated access only; TLS in transit; amounts encrypted at rest. |
| Retention policy (documented) | 7 years after project closure, per financial recordkeeping policy. |

**Declaration site (proven):** `94:5`

**Consumption status:** `declared-dynamic`

**Field lifecycle -- declared handling at each endpoint this field crosses (declared, never independently verified):**

| Operation | Direction | Endpoint | URL | Handling |
| --- | --- | --- | --- | --- |
| getter:listInvoices | input | billing-api | https://api.example.com/v1/projects/:projectId/invoices | encrypted |
| mutator:createInvoice | output | billing-api | https://api.example.com/v1/projects/:projectId/invoices | encrypted |
| mutator:markInvoicePaid | output | billing-api | https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/pay | encrypted |
| mutator:disputeInvoice | output | billing-api | https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/dispute | encrypted |
| subscription:subscribeToInvoices | input | billing-api | https://api.example.com/v1/projects/:projectId/invoices/stream | encrypted |

**Developer-asserted dynamic access (declared; currently supported by its own citation/integrity check, never proof the described access was independently verified):**
- `src/server/legacy-compliance-sync.ts:26:19`

## identityData.currentUser

| Declared fact | Value |
| --- | --- |
| Owner | platform-security |
| Classification (sensitivity) | confidential |
| Purpose | Authorizing access to every other capability in this platform. |
| Legal basis (declared, not a legal determination) | contract |
| Data residency (permitted storage jurisdiction, declared) | us |
| Audit required | yes |
| Protections (documented, not an adequacy claim) | Session-authenticated access only; TLS in transit; password never leaves the server. |
| Retention policy (documented) | _not documented_ |

**Declaration site (proven):** `22:5`

**Consumption status:** `indeterminate`

**Field lifecycle -- declared handling at each endpoint this field crosses (declared, never independently verified):**

| Operation | Direction | Endpoint | URL | Handling |
| --- | --- | --- | --- | --- |
| getter:getCurrentUser | input | identity-api | https://api.example.com/v1/me | plaintext |

**Candidate dynamic-access sites (proven to exist, but not statically attributable to this specific field):**
- `src/server/legacy-compliance-sync.ts:33:19`

## projectsData.projects

| Declared fact | Value |
| --- | --- |
| Owner | engineering-ops |
| Classification (sensitivity) | internal |
| Purpose | Cross-department project navigation. |
| Legal basis (declared, not a legal determination) | contract |
| Data residency (permitted storage jurisdiction, declared) | us |
| Audit required | no/not declared |
| Protections (documented, not an adequacy claim) | Session-authenticated access only; TLS in transit. |
| Retention policy (documented) | _not documented_ |

**Declaration site (proven):** `24:5`

**Consumption status:** `unconsumed`

**Field lifecycle -- declared handling at each endpoint this field crosses (declared, never independently verified):**

| Operation | Direction | Endpoint | URL | Handling |
| --- | --- | --- | --- | --- |
| getter:listProjects | input | projects-api | https://api.example.com/v1/projects | plaintext |
| mutator:createProject | output | projects-api | https://api.example.com/v1/projects | plaintext |

