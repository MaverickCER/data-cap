<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Data Capability Catalog

## Changes since last report

_No changes since the last report._

## Table of contents

- [`assignmentsData`](#assignmentsdata)
- [`memberData`](#memberdata)
- [`projectData`](#projectdata)

## Catalog

### `assignmentsData`

*src/capabilities/assignments.capability.ts*

Owner: notifications-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `myTasks` | The current member's own assigned tasks, with names resolved for display. | notifications-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:getMyTasks` | src/main.ts:91:14 |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `getMyTasks` | Fetches one member's own assigned tasks. | assignments-api | — | input:api:assignments-api https://api.example.com/v1/my-tasks (plaintext), input:api:members-api https://api.example.com/v1/members (plaintext) |

### `memberData`

*src/capabilities/member.capability.ts*

Owner: platform-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `members` | The full team member directory. | platform-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:listMembers` | src/capabilities/project.capability.ts:31:19 |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `listMembers` | Fetches the full team member directory, cached across remounts. | members-api | — | input:api:members-api https://api.example.com/v1/members (plaintext) |

### `projectData`

*src/capabilities/project.capability.ts*

Owner: project-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `project` | The current project's own metadata -- null until the first getProject(). | project-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:getProject`, `subscription:subscribeToProject` | src/main.ts:78:14 |
| `tasks` | Every task on the current project, with assignee names resolved. | project-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:getProject`, `mutator:createTask`, `mutator:toggleTask`, `mutator:assignTask` | src/main.ts (7 sites) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `getProject` | Fetches a project and its tasks, resolving each task's assignee name. | projects-api | — | input:api:projects-api https://api.example.com/v1/projects/:id (plaintext) |

#### Mutators

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `createTask` | Adds a new task to the project. | projects-api | — | output:api:projects-api https://api.example.com/v1/projects/:id/tasks (plaintext) |
| `toggleTask` | Marks a task complete or incomplete. | projects-api | — | output:api:projects-api https://api.example.com/v1/projects/:id/tasks/:taskId/toggle (plaintext) |
| `assignTask` | Reassigns a task to a different team member. | projects-api | — | output:api:projects-api https://api.example.com/v1/projects/:id/tasks/:taskId/assign (plaintext) |

#### Subscriptions

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `subscribeToProject` | Live connection status for the current project. | — | — | — |

## Sensitivity & protections review

| Capability | Field | Sensitivity (declared) | Protections documented? |
| --- | --- | --- | --- |
| `assignmentsData` | `myTasks` | internal | Yes |
| `memberData` | `members` | internal | Yes |
| `projectData` | `project` | internal | Yes |
| `projectData` | `tasks` | internal | Yes |

## Lifecycle

_Nothing declares an `expiresAt` within the configured window._

_No capability or field is declared deprecated or renamed._
