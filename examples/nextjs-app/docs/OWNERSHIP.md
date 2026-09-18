<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Dependency & Ownership Report

## Ownership matrix

### productivity-team

Capabilities: `todoData`
Fields: `todoData.todos`

## Capability-to-capability dependencies

_Edges statically proven where one capability's own file imports and uses another._

_No capability statically depends on another capability._

## Consumers per capability

### `todoData`

| Consumer | Relationship | Detail | Resolution |
| --- | --- | --- | --- |
| `src/app/todo-app.tsx:40:20` | calls-getter | getTodos | resolved |
| `src/app/todo-app.tsx:63:11` | calls-mutator | createTodo | resolved |
| `src/app/todo-app.tsx:119:38` | calls-mutator | toggleTodo | resolved |
| `src/app/todo-app.tsx:126:35` | calls-mutator | deleteTodo | resolved |

## Findings

| Severity | Code | Capability | Message |
| --- | --- | --- | --- |
| warning | UNCONSUMED_FIELD | `todoData` | Field "todos" on "todoData" is written but never statically read in the scanned project. |
