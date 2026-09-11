<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Data Capability Catalog

## Changes since last report

_No changes since the last report._

## Table of contents

- [`taskData`](#taskdata)

## Catalog

### `taskData`

*src/main.ts*

Owner: productivity-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `tasks` | The current user's own task list. | productivity-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:getTasks`, `mutator:createTask`, `mutator:toggleTask`, `mutator:deleteTask` | src/main.ts (4 sites) |
| `selectedTask` | One task's own full detail -- null until the first successful getTask(). | productivity-team | internal | Session-authenticated access only; TLS in transit. | not documented | `getter:getTask`, `subscription:subscribeToTask` | src/main.ts (3 sites) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `getTasks` | Fetches the full task list, cached across remounts. | tasks-api | — | input:api:tasks-api https://api.example.com/v1/tasks (plaintext) |
| `getTask` | Fetches one task's own full detail by id. | tasks-api | — | input:api:tasks-api https://api.example.com/v1/tasks/:id (plaintext) |

#### Mutators

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `createTask` | Adds a new task to the list. | tasks-api | — | output:api:tasks-api https://api.example.com/v1/tasks (plaintext) |
| `toggleTask` | Marks a task complete or incomplete. | tasks-api | — | output:api:tasks-api https://api.example.com/v1/tasks/:id/toggle (plaintext) |
| `deleteTask` | Removes a task from the list. | tasks-api | — | output:api:tasks-api https://api.example.com/v1/tasks/:id (plaintext) |

#### Subscriptions

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `subscribeToTask` | Live connection status for the currently-viewed task. | — | — | — |

## Sensitivity & protections review

| Capability | Field | Sensitivity (declared) | Protections documented? |
| --- | --- | --- | --- |
| `taskData` | `tasks` | internal | Yes |
| `taskData` | `selectedTask` | internal | Yes |

## Lifecycle

_Nothing declares an `expiresAt` within the configured window._

_No capability or field is declared deprecated or renamed._
