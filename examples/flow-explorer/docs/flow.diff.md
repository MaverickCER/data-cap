# Data-flow changes

Compared with the earlier revision (docs/baseline.evidence.json): 2 edge(s) added, 0 removed; 3 node(s) added, 0 removed, 0 changed; 0 new unknown(s), 0 resolved; 1 policy result(s) changed.

## Changed policy results

- userData/no-password-to-client for userData.user: satisfied, static before, violated reaching http-response, static now [src/app/export.ts:10:3]

## Added edges

- reads (whole): userData.user to exportEverything (static) [src/app/export.ts:10:12]
- side-effect (whole): exportEverything to http-response (static) [src/app/export.ts:10:3]

## Removed edges

- none

## Added nodes

- function exportEverything (static) [src/app/export.ts:9:1]
- parameter exportEverything.res (static)
- return exportEverything#return (static)

## Removed nodes

- none

## Changed nodes

- none

## New unknowns (parts of the program the analysis could not follow)

- none

## Resolved unknowns

- none

