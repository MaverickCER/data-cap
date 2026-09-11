<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from.

# Data Capability Catalog

## Changes since last report

_No previous snapshot to compare against (first report)._

## Table of contents

- [`capability`](#capability)

## Catalog

### `capability`

*src/main.ts*

Owner: identity-team · Category: — · Active: yes

#### Fields

| Field | Description | Owner | Sensitivity (declared) | Protections (documented) | Retention (documented) | Written by | Consumed at (proven) |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `user` | The authoritative user row, read from and written back to the database. | identity-team | confidential | Row-level security; database-internal network only. | not documented | (none found) | (not scanned) |

## Sensitivity & protections review

| Capability | Field | Sensitivity (declared) | Protections documented? |
| --- | --- | --- | --- |
| `capability` | `user` | confidential | Yes |

## Lifecycle

_Nothing declares an `expiresAt` within the configured window._

_No capability or field is declared deprecated or renamed._
