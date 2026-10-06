# Record of Processing Activities (GDPR Art. 30(1))

> This document is a generated illustration of GDPR Article 30(1) record-of-processing-activities (ROPA) content, produced from data-cap's own declared governance metadata. It is not legal advice, not a compliance certification, and not a substitute for your organization's own Art. 30 review -- see this generator's own README (scripts/ropa/README.md) for exactly which of the 7 required items below are direct schema fields, which are partial/approximate mappings, and which require your own input before this document is published externally.

Generated at: 2026-10-03T04:47:09.445Z

## (a) Controller identity

- **Name:** Atlas Platform, Inc. (example placeholder)
- **Contact:** privacy@example.com (example placeholder)

## Processing activities -- summary

| Processing activity (capability) | (b) Purpose(s) | (c) Data subject categories | (c) Personal data categories | (d) Recipient categories | (e) Transfer safeguards | (f) Retention | (g) Security measures |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `billingData` | Billing clients and tracking payment/dispute status for financial reporting. | clients | confidential | payment processor, tax authority | EU Standard Contractual Clauses | 7 years after project closure, per financial recordkeeping policy. | Session-authenticated access only; TLS in transit; amounts encrypted at rest. |
| `identityData` | Authorizing access to every other capability in this platform. | staff members | confidential | Not documented | Not documented | Not documented | Session-authenticated access only; TLS in transit; password never leaves the server. |
| `projectsData` | Cross-department project navigation. | Not documented | internal | Not documented | Not documented | Not documented | Session-authenticated access only; TLS in transit. |

## Processing activities -- detail

### `billingData`

- File: `src/capabilities/billing.capability.ts`
- (b) Purpose(s) of processing: Billing clients and tracking payment/dispute status for financial reporting.

| Field | (c) Data subject category | (c) Personal data category | (d) Recipient categories | (e) Transfer safeguard | (f) Retention | (g) Security measures |
| --- | --- | --- | --- | --- | --- | --- |
| `invoices` | clients | confidential | payment processor, tax authority | EU Standard Contractual Clauses | 7 years after project closure, per financial recordkeeping policy. | Session-authenticated access only; TLS in transit; amounts encrypted at rest. |

### `identityData`

- File: `src/capabilities/identity.capability.ts`
- (b) Purpose(s) of processing: Authorizing access to every other capability in this platform.

| Field | (c) Data subject category | (c) Personal data category | (d) Recipient categories | (e) Transfer safeguard | (f) Retention | (g) Security measures |
| --- | --- | --- | --- | --- | --- | --- |
| `currentUser` | staff members | confidential | Not documented | Not documented | Not documented | Session-authenticated access only; TLS in transit; password never leaves the server. |

### `projectsData`

- File: `src/capabilities/projects.capability.ts`
- (b) Purpose(s) of processing: Cross-department project navigation.

| Field | (c) Data subject category | (c) Personal data category | (d) Recipient categories | (e) Transfer safeguard | (f) Retention | (g) Security measures |
| --- | --- | --- | --- | --- | --- | --- |
| `projects` | Not documented | internal | Not documented | Not documented | Not documented | Session-authenticated access only; TLS in transit. |

