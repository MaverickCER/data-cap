# 0071: Every flow fact carries an epistemic status; incomplete analysis is recorded, never hidden

## Status

Accepted. Extends the declared-versus-proven invariant in `AGENTS.md` and ADR 0053 (developer-declared
dynamic access citations).

## Context

`flow-graph.ts` already keeps two kinds of fact apart: what an author declared (`endpoints`) and what a scan
proved (`reads-field` edges). Interprocedural analysis and runtime observation add two more kinds of
knowledge, and a fifth state, "we could not tell", that a trustworthy report must show rather than omit. A
graph that silently drops a call it could not resolve looks complete and is wrong in the dangerous direction
(a sensitive field appears not to reach a destination).

## Decision

Every flow node, edge, finding, and claim carries exactly one `status`:

| Status     | Meaning                                                                                       |
| ---------- | --------------------------------------------------------------------------------------------- |
| `declared` | Asserted by an author in `documentData()`. Not checked against code.                          |
| `static`   | Established by the analyzed code under the analysis's stated assumptions.                     |
| `observed` | Witnessed in a specific execution or test (the observation's scope is recorded).              |
| `inferred` | Plausible but not established (for example a name-based match with no resolved binding).      |
| `unknown`  | Not analyzable: dynamic behavior, missing source, unsupported construct, incomplete coverage. |

- Statuses are never blended. A fact that is both `static` and `observed` is two records, not one record with
  a merged status; a claim's verification status is derived from them.
- Claim verification status is derived, never stored independently of the evidence it rests on:
  `verified` (a static, declared or inferred fact corroborated by an observation), `inferred` (rests on an
  inferred edge, not observed), `unobserved` (static or declared, and no observation covers it), `contradicted`
  (an observation conflicts with a complete static trace, a static evaluation found a violation, or an
  observation violates a statically satisfied rule), `observed-only` (seen at runtime with no static
  counterpart, where the static trace was incomplete so no contradiction can be asserted), and `indeterminate`
  (a policy could not be decided).
- Incomplete analysis is part of the evidence. Unanalyzed functions, unresolved calls, and unsupported
  constructs are explicit `unknown` records with a reason and a `file:line:column` citation (ADR 0053). A
  coverage summary states what was and was not analyzed. A projection must render `unknown` records
  distinctly and must not describe a graph with unknown records as complete.
- An unknown records the tracked data that entered it (`data`: field and path). A trace is incomplete only through an
  unknown that concerns the data being traced: an opaque call that only ever received `email` leaves questions about
  `passwordHash` complete. An unknown that does not say which data it concerns is treated as concerning everything.
- Observed facts record names and paths only, never values.

## Consequences

- A reviewer can filter to "only what the code establishes" or "only what was seen at runtime".
- A policy check that depends on an `unknown` edge reports `indeterminate`, never `satisfied`.
- The scanner stays syntactic (classic compiler API over single files, import specifiers resolved with the
  existing resolver). Constructs that need a type checker to resolve (a call through a value whose type
  decides the target, for example) become `unknown`, not guesses. This keeps ADR 0002, ADR 0058, and the
  bundled-TypeScript-6 design of ADR 0069 intact and avoids a `Program` over the consumer's whole project.
