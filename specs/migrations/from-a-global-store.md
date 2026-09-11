# Migrating from a global store (Redux, Zustand, ...)

A global store (Redux, Zustand, or similar) is a reasonable place to keep
**client-only UI state** — a modal's open/closed state, a form's draft
values, a theme preference. It's a less natural fit for **server-derived
data** specifically, because that data has a shape a store slice doesn't
model well by default: is this value loading, fresh, stale, or errored?
Most teams end up hand-rolling that metadata as extra fields in the slice
(`userLoading`, `userError`, ...) — exactly the shape `data-cap`'s `info`
already provides.

## Migration goals

- Stop hand-rolling `xLoading`/`xError` fields for every slice that holds
  server-derived data — replace that pattern once, not per-slice.
- Give server-derived data a typed status vocabulary (`idle`/`loading`/
  `success`/`error`/`retrying`) instead of a boolean plus a nullable error
  string.
- Get reference-stable, structurally-shared updates without hand-writing
  the immutable-update logic your reducers currently need to preserve it.
- Shrink the global store down to genuinely client-only state, so what's
  left in it is easier to reason about on its own.
- Leave client-only state (`isModalOpen`, draft form values, theme) exactly
  where it is — this migration is deliberately narrow.

## Migrating incrementally

1. **Find every slice mixing client state and server-derived data.** Grep
   your reducers/selectors for a data field paired with its own
   loading/error fields in the same slice — `userLoading`/`userError`
   sitting next to `user` in `AppState`, as in the example below.
2. **For each server-derived field, declare a capability alongside the
   store, not inside it.** `buildData({ fields: { user: { name: "",
email: "" } } })` + `createDataStore(...)` — the store and the
   capability coexist during the migration.
3. **Redirect the dispatch that used to set `user`/`userLoading`/
   `userError` into a `userStore.commitAuthoritative(...)` call.** The
   fetch/mutation logic inside your thunk or action creator doesn't
   change — only where the result lands.
4. **Replace read sites one at a time.** Swap `useSelector((s) => s.user)`
   and its paired `useSelector((s) => s.userLoading)` for
   `userStore.getSnapshot().fields.user` / `.info.user?.status`, verifying
   each component still renders correctly before moving to the next.
5. **Delete `user`, `userLoading`, and `userError` from `AppState`** once
   every read site has moved — the slice keeps only `isModalOpen` and
   whatever else is genuinely client-only.
6. **Repeat per slice, at your own pace.** A slice with five
   server-derived fields and two client-only ones migrates the same way,
   five capabilities at a time — nothing requires migrating the whole
   store in one pass.

## When to keep server-derived data in the store

- If the data is small, rarely stale, and your team already has strong,
  consistent conventions for the loading/error fields in your slices,
  migrating it out may not be worth the churn — this guide's value is
  highest when you're hand-rolling the same three-field pattern
  repeatedly, across many slices, with drift between them.
- If your reducers already implement a specific conflict-resolution
  policy for concurrent writes to this field (e.g. a version-based
  merge), note that `data-cap` deliberately doesn't provide one either
  (ADR 0023) — moving the field relocates where you implement that
  policy, it doesn't remove the need for it.
- If the store's own middleware (persistence, undo/redo, devtools
  time-travel) already treats this field as part of what it manages,
  pulling it out may break assumptions that middleware relies on — check
  before moving a field a middleware depends on.
- If only one component ever reads this particular field, the migration's
  main benefit (a shared, typed shape for many consumers) doesn't apply
  yet — see `from-manual-fetch-state.md`'s equivalent single-consumer
  caveat.

## What to migrate, and what not to

`data-cap` is not a general-purpose state manager, and doesn't try to
replace your store for client-only state. The migration here is narrower
and more specific: move _server-derived_ data (the kind that has a
loading/success/error lifecycle) out of your store's slices and into
capability-owned contracts, and keep genuinely client-only state (that
modal, that draft form) exactly where it already is.

```ts
// Before: a Redux/Zustand slice mixing client state and server data
interface AppState {
  isModalOpen: boolean // client-only -- stays in your store
  user: User | null // server-derived -- migrate this
  userLoading: boolean // hand-rolled metadata -- info replaces this
  userError: string | null // hand-rolled metadata -- info replaces this
}
```

```ts
// After: user-capability.ts, alongside your existing store
export const userCapability = buildData({ fields: { user: { name: "", email: "" } } })
export const userStore = createDataStore(userCapability)
// ... wired the same way as from-manual-fetch-state.md's example

// Your Redux/Zustand store keeps only genuinely client-only state:
interface AppState {
  isModalOpen: boolean
}
```

A dispatched action that used to also update `userLoading`/`userError`
instead becomes a `userStore.commitAuthoritative(...)` call — see
`test/integration/runtime-core/basic-standalone/` and `test/integration/runtime-core/server-database-integration/`
for the getter/mutator wiring pattern this replaces action creators/
reducers with, for server-derived data specifically.

## What you gain

- **No more hand-rolled loading/error fields per piece of server data** —
  `info.<field>.status`/`error` already model this consistently, without a
  developer inventing the same three-field pattern in every slice.
- **Reference-stable, structurally-shared updates** — a store update that
  only touches one field never forces a change to unrelated branches of
  the previous state, the same guarantee your existing store's reducers
  likely already try to preserve by hand via immutable-update patterns.
- **A smaller, more focused global store** — once server-derived data
  moves out, what's left is genuinely client-only state, which is easier
  to reason about on its own.

## What doesn't change

Your store's own middleware, devtools, and any purely client-side logic
stay exactly as they are — this migration only moves server-derived data
out, it doesn't ask you to replace the store itself.
