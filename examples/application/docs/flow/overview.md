<!-- GENERATED FILE -- do not edit by hand. Run `npx data-cap` to regenerate. -->

> Machine-generated engineering artifact assembled from statically-provable code facts and author-declared documentation. It can support a security, privacy, or compliance review. It does not itself establish compliance with any standard.

> Projected from data-cap's Evidence Model (ADR 0050/0054), the same source every other generated artifact draws from. This run also wrote it to `docs/data.evidence.json`.

# Data Flow Diagram & Security Data-Flow Review

This report cannot trace data *through* a third-party system once it reaches an external-service/api endpoint -- what that system does with it afterward is unknowable to a static scan of one repository. It does not assign a regulatory classification, since that's jurisdiction-specific; record it in a capability's `metadata` instead (see `specs/decisions/0049-capability-metadata-vocabulary.md`).

## Security Data-Flow Review

### Critical (error)

_None._

### Warnings

- **SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY**: Field "tasks" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.
- **SENSITIVE_DATA_CROSSES_EXTERNAL_BOUNDARY**: Field "selectedTask" on "taskData" is sensitivity "internal" and has a declared endpoint crossing an external-service/api/queue boundary -- verify this is intentional and adequately protected.

### Informational

_None._

## System overview diagram

```mermaid
%% System overview -- declared endpoints and proven consumers per capability
flowchart TB
  subgraph boundary["Trust Boundary (proven, in-repo)"]
    n0(["taskData"])
    n1[/"tasks"/]
    n3(["getter: getTasks"])
    n4(["mutator: createTask"])
    n5(["mutator: toggleTask"])
    n6(["mutator: deleteTask"])
    n8[/"selectedTask"/]
    n9(["getter: getTask"])
  end
  n2[["tasks-api<br/><em>api</em>"]]
  n7["src/main.ts"]
  n2 -.->|"declared: tasks (plaintext)"| n3
  n3 -.->|"writes"| n1
  n1 -.->|"declared"| n4
  n4 -.->|"declared: tasks (plaintext)"| n2
  n1 -.->|"declared"| n5
  n5 -.->|"declared: tasks (plaintext)"| n2
  n1 -.->|"declared"| n6
  n6 -.->|"declared: tasks (plaintext)"| n2
  n1 -->|"proven: src/main.ts:365:14"| n7
  n1 -->|"proven: src/main.ts:371:3"| n7
  n1 -->|"proven: src/main.ts:376:14"| n7
  n1 -->|"proven: src/main.ts:380:14"| n7
  n2 -.->|"declared: selectedTask (plaintext)"| n9
  n9 -.->|"writes"| n8
  n8 -->|"proven: src/main.ts:339:14"| n7
  n8 -->|"proven: src/main.ts:341:14"| n7
  n8 -->|"proven: src/main.ts:351:3"| n7
  linkStyle 0 stroke:#e63946,stroke-width:3px
  linkStyle 3 stroke:#e63946,stroke-width:3px
  linkStyle 5 stroke:#e63946,stroke-width:3px
  linkStyle 7 stroke:#e63946,stroke-width:3px
  linkStyle 12 stroke:#e63946,stroke-width:3px
```
