<!-- GENERATED FILE -- do not edit by hand. Regenerate it by re-running the script that calls `generateDocumentation()` / `generateUsage()` / `generateFlow()` from `data-cap/build`. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (https://github.com/MaverickCER/data-cap/blob/main/GUIDE.md), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Dependency & Ownership Report

## Ownership matrix

### productivity-team

Capabilities: `taskData`
Fields: `taskData.tasks`

### security-team

Capabilities: _none_
Fields: `taskData.selectedTask`

## Capability-to-capability dependencies

_Edges statically proven where one capability's own file imports and uses another._

_No capability statically depends on another capability._

## Consumers per capability

### `taskData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/main.ts:336:52` | calls-getter | getTasks | resolved |
| `src/main.ts:336:75` | calls-getter | getTasks | resolved |
| `src/main.ts:343:7` | calls-getter | getTasks | resolved |
| `src/main.ts:348:14` | reads-field | selectedTask | resolved |
| `src/main.ts:349:7` | calls-getter | getTask | resolved |
| `src/main.ts:350:14` | reads-field | selectedTask | resolved |
| `src/main.ts:356:21` | calls-getter | getTask | resolved |
| `src/main.ts:360:3` | reads-field | selectedTask | resolved |
| `src/main.ts:369:15` | calls-mutator | createTask | resolved |
| `src/main.ts:374:14` | reads-field | tasks | resolved |
| `src/main.ts:378:23` | calls-mutator | toggleTask | resolved |
| `src/main.ts:380:3` | reads-field | tasks | resolved |
| `src/main.ts:385:14` | reads-field | tasks | resolved |
| `src/main.ts:388:7` | calls-mutator | deleteTask | resolved |
| `src/main.ts:389:14` | reads-field | tasks | resolved |
| `src/main.ts:392:25` | calls-subscription | subscribeToTask | resolved |

## Findings

_No usage findings._
