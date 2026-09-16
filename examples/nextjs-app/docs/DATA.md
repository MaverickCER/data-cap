<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Data Capability Catalog

## Changes since last report

_No changes since the last report._

## Table of contents

- [`todoData`](#tododata)

## Catalog

### `todoData`

*src/features/todos/data.schema.ts*

Owner: productivity-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `todos` | The current session's own todos -- a regular user's own list, or, for an admin who explicitly requested it (?all=true), every user's todos. Server-side authorization (src/app/api/todos/route.ts), not this client capability, is what decides which rows a given response actually contains. | productivity-team | internal | Session-authenticated access only; the server enforces per-user ownership and admin-only cross-user access -- this field never receives data the requesting session isn't authorized to see. | Deleted when the owning user deletes the todo, or deletes their account. | `getter:getTodos`, `mutator:createTodo`, `mutator:toggleTodo`, `mutator:deleteTodo` | (none found) |

#### Getters

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `getTodos` | Fetches the current session's todos (own-only for a user; all, only if explicitly requested, for an admin). | todos-api | — | input:api:todos-api /api/todos (plaintext) |

#### Mutators

| Name | Description | Source (declared) | Credentials (declared) | Endpoints (declared) |
| --- | --- | --- | --- | --- |
| `createTodo` | Adds a new todo, owned by the current session's user. | todos-api | — | output:api:todos-api /api/todos (plaintext) |
| `toggleTodo` | Marks a todo complete or incomplete -- the owner, or an admin. | todos-api | — | output:api:todos-api /api/todos (plaintext) |
| `deleteTodo` | Removes a todo -- the owner, or an admin. | todos-api | — | output:api:todos-api /api/todos (plaintext) |

## Sensitivity & protections review

| Capability | Field | Sensitivity (declared) | Protections documented? |
| --- | --- | --- | --- |
| `todoData` | `todos` | internal | Yes |

## Lifecycle

_Nothing declares an `expiresAt` within the configured window._

_No capability or field is declared deprecated or renamed._
