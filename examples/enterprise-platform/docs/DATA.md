<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Data Capability Catalog

## Changes since last report

_No changes since the last report._

## Table of contents

- [`billingData`](#billingdata)
- [`identityData`](#identitydata)
- [`projectsData`](#projectsdata)

## Catalog

### `billingData`

*src/capabilities/billing.capability.ts*

Owner: finance-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `invoices` | Every invoice on the current project. | finance-team | confidential | Session-authenticated access only; TLS in transit; amounts encrypted at rest. | 7 years after project closure, per financial recordkeeping policy. | `getter:listInvoices`, `mutator:createInvoice`, `mutator:markInvoicePaid`, `mutator:disputeInvoice`, `subscription:subscribeToInvoices` | (none found) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `listInvoices` | Fetches every invoice on a project. | billing-api | — | input:api:billing-api https://api.example.com/v1/projects/:projectId/invoices (encrypted) |

#### Mutators

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `createInvoice` | Issues a new invoice to a client. | billing-api | — | output:api:billing-api https://api.example.com/v1/projects/:projectId/invoices (encrypted) |
| `markInvoicePaid` | Marks an invoice paid. | billing-api | — | output:api:billing-api https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/pay (encrypted) |
| `disputeInvoice` | Marks an invoice disputed and notifies finance for review. | billing-api | — | output:api:billing-api https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/dispute (encrypted) |

#### Subscriptions

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `subscribeToInvoices` | Live invoice status updates from other finance staff viewing the same project. | — | — | input:api:billing-api https://api.example.com/v1/projects/:projectId/invoices/stream (encrypted) |

### `identityData`

*src/capabilities/identity.capability.ts*

Owner: platform-security · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `currentUser` | The signed-in staff member's own profile -- null until the first getCurrentUser(). | platform-security | confidential | Session-authenticated access only; TLS in transit; password never leaves the server. | not documented | `getter:getCurrentUser` | (none found) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `getCurrentUser` | Fetches the currently signed-in staff member's own profile. | identity-api | — | input:api:identity-api https://api.example.com/v1/me (plaintext) |

### `projectsData`

*src/capabilities/projects.capability.ts*

Owner: engineering-ops · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `projects` | Every project across every department. | engineering-ops | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:listProjects`, `mutator:createProject` | (none found) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `listProjects` | Fetches every project across every department. | projects-api | — | input:api:projects-api https://api.example.com/v1/projects (plaintext) |

#### Mutators

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `createProject` | Opens a new project for a department. | projects-api | — | output:api:projects-api https://api.example.com/v1/projects (plaintext) |

## Sensitivity & protections review

| Capability | Field | Sensitivity (declared) | Protections documented? |
| --- | --- | --- | --- |
| `billingData` | `invoices` | confidential | Yes |
| `identityData` | `currentUser` | confidential | Yes |
| `projectsData` | `projects` | internal | Yes |

## Lifecycle

_Nothing declares an `expiresAt` within the configured window._

_No capability or field is declared deprecated or renamed._
