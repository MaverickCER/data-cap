<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Dependency & Ownership Report

## Ownership matrix

### productivity-team

Capabilities: `taskData`
Fields: `taskData.selectedTask`, `taskData.tasks`

## Capability-to-capability dependencies

_Edges statically proven where one capability's own file imports and uses another._

_No capability statically depends on another capability._

## Consumers per capability

### `taskData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/main.ts:327:52` | calls-getter | getTasks | resolved |
| `src/main.ts:327:75` | calls-getter | getTasks | resolved |
| `src/main.ts:334:7` | calls-getter | getTasks | resolved |
| `src/main.ts:339:14` | reads-field | selectedTask | resolved |
| `src/main.ts:340:7` | calls-getter | getTask | resolved |
| `src/main.ts:341:14` | reads-field | selectedTask | resolved |
| `src/main.ts:347:21` | calls-getter | getTask | resolved |
| `src/main.ts:351:3` | reads-field | selectedTask | resolved |
| `src/main.ts:360:15` | calls-mutator | createTask | resolved |
| `src/main.ts:365:14` | reads-field | tasks | resolved |
| `src/main.ts:369:23` | calls-mutator | toggleTask | resolved |
| `src/main.ts:371:3` | reads-field | tasks | resolved |
| `src/main.ts:376:14` | reads-field | tasks | resolved |
| `src/main.ts:379:7` | calls-mutator | deleteTask | resolved |
| `src/main.ts:380:14` | reads-field | tasks | resolved |
| `src/main.ts:383:25` | calls-subscription | subscribeToTask | resolved |

## Findings

_No usage findings._
