## AI-Assisted Integration

data-cap is designed to integrate with existing application architectures rather than replace them blindly.

If you use an AI coding assistant, provide it with the following prompt before asking it to modify your project. This helps the assistant understand both your application's architecture and data-cap's design principles before making changes.

Replace `<YOUR_PROJECT_CONTEXT>` with any additional context about your application before submitting the prompt.

```text
You are integrating @maverickcer/data-cap into an existing production codebase.

Package source:
https://github.com/maverickcer/data-cap

Before making any changes, first study the data-cap repository above, including:

- README.md
- Architecture documentation (specs/architecture.md)
- ADRs (architectural decision records, specs/decisions/)
- Examples
- Migration guides (specs/migrations/)
- Package exports and API design

Understand the package's intended architecture and constraints before proposing an implementation.

Your role is to act as a senior/staff-level engineer performing an infrastructure integration review.

Application context:
<YOUR_PROJECT_CONTEXT>

First, analyze this repository and understand:

1. Application architecture:
   - Framework and runtime(s)
   - Build system and bundler behavior
   - Monorepo/package boundaries (if applicable)
   - Server/client boundaries
   - Deployment environments
   - Existing data-fetching, state-management, and optimistic-update patterns

2. Current data-access system:
   - Where application data is fetched, mutated, and observed
   - Which fields belong to which feature/capability, if that's even decided today
   - Existing loading/error/optimistic-update bookkeeping (hand-rolled, or via a library)
   - Existing documentation of what data a feature depends on, and why
   - Sensitive or access-controlled data, and any existing handling for it

3. Integration approach:
   - Determine capability boundaries: which fields, getters, mutators, and
     subscriptions belong together as one `buildData`/`createData` call
   - Identify whether the low-level primitives (`buildData` + `createDataStore` +
     `coordinator`) or the batteries-included `createData` fit the codebase's needs
   - Determine ownership per field (`writes`) before writing any operation
   - Identify migration risks, especially around existing dedup/cache logic that
     `createData`'s coordinator would take over

Follow data-cap's architectural principles:

- Fields are the actual application data shape — no `.value` wrappers, no proxies, no dot-notation string access.
- Fields are always synchronously readable; there is no throw-until-validated gate.
- `DataInfo` (status/error/staleness metadata) is mandatory and committed atomically with `fields`, never as a separate write.
- Getters acquire, mutators perform side effects, subscriptions observe — these are semantically distinct roles, not naming conventions.
- Sharing (dedup, subscription reuse) is scoped to function identity — pass stable references, not inline arrow functions, as `execute`/`processor`/`subscribe`/`optimistic`.
- There is no automatic rollback or built-in conflict-resolution policy for optimistic mutations — only the operation's own processor interprets a result against the latest authoritative state.
- Do not add framework-specific behavior to data-cap usage — no first-party React/TanStack Query/Socket.IO adapter exists by design; those patterns live in application code.
- Avoid unnecessary wrappers or abstractions unless they solve a real application need.

Before changing code, provide:

1. Current data-access architecture summary.
2. Recommended data-cap integration strategy (capability boundaries, and whether `buildData`+hand-wiring or `createData` fits).
3. Proposed migration steps.
4. Files that should change.
5. Risks and mitigations.
6. Questions requiring developer decisions.

Do not implement changes until the plan has been reviewed and approved.

After approval:

- Implement changes incrementally, one capability at a time.
- Preserve existing behavior where possible.
- Add or update tests.
- Verify type safety.
- Verify build output.
- Verify CI/CD compatibility.

For the best results, provide your AI assistant access to both your repository and the data-cap repository. The assistant should understand your application's architecture before recommending how data-cap fits into it.
```
