<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Dependency & Ownership Report

## Ownership matrix

### notifications-team

Capabilities: `assignmentsData`
Fields: `assignmentsData.myTasks`

### platform-team

Capabilities: `memberData`
Fields: `memberData.members`

### project-team

Capabilities: `projectData`
Fields: `projectData.project`, `projectData.tasks`

## Capability-to-capability dependencies

_Edges statically proven where one capability's own file imports and uses another._

| From | Relationship | To |
| --- | --- | --- |
| `projectData` | calls-getter | `memberData` |
| `projectData` | reads-field | `memberData` |

## Consumers per capability

### `assignmentsData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/main.ts:90:7` | calls-getter | getMyTasks | resolved |
| `src/main.ts:91:14` | reads-field | myTasks | resolved |

### `memberData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/capabilities/project.capability.ts:30:9` | calls-getter | listMembers | resolved |
| `src/capabilities/project.capability.ts:31:19` | reads-field | members | resolved |
| `src/main.ts:100:7` | calls-getter | listMembers | resolved |

### `projectData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/main.ts:77:7` | calls-getter | getProject | resolved |
| `src/main.ts:78:14` | reads-field | project | resolved |
| `src/main.ts:79:14` | reads-field | tasks | resolved |
| `src/main.ts:81:3` | reads-field | tasks | resolved |
| `src/main.ts:107:15` | calls-mutator | createTask | resolved |
| `src/main.ts:111:14` | reads-field | tasks | resolved |
| `src/main.ts:114:23` | calls-mutator | toggleTask | resolved |
| `src/main.ts:116:3` | reads-field | tasks | resolved |
| `src/main.ts:121:14` | reads-field | tasks | resolved |
| `src/main.ts:126:7` | calls-mutator | assignTask | resolved |
| `src/main.ts:128:3` | reads-field | tasks | resolved |
| `src/main.ts:133:28` | calls-subscription | subscribeToProject | resolved |
| `src/main.ts:142:22` | reads-field | tasks | resolved |

## Findings

_No usage findings._
