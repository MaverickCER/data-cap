# Migrating from a global store (Redux, Zustand, ...)

Move server-derived data out of your global store; keep client-only UI
state where it is. A global store (Redux, Zustand, or similar) is a
reasonable place for **client-only UI state**. Examples are a modal's
open/closed state, a form's draft values, a theme preference. It's a less natural fit
for **server-derived data** specifically. That data has a shape a store
slice doesn't model well by default: is this value loading, fresh, stale,
or errored? Most teams end up hand-rolling that metadata as extra fields in
the slice (`userLoading`, `userError`, ...). That is exactly the shape
`data-cap`'s `info` already provides.

## Migration goals

- Stop hand-rolling `xLoading`/`xError` fields for every slice that holds
  server-derived data. Replace that pattern once, not per-slice.
- Give server-derived data a typed status vocabulary (`idle`/`loading`/
  `success`/`error`/`retrying`) instead of a boolean plus a nullable error
  string.
- Get reference-stable, structurally-shared updates without hand-writing
  the immutable-update logic your reducers currently need to preserve it.
- Shrink the global store down to genuinely client-only state, so what's
  left in it is easier to reason about on its own.
- Leave client-only state (`isModalOpen`, draft form values, theme) exactly
  where it is. This migration is deliberately narrow.

## Migrating incrementally

1. **Find every slice mixing client state and server-derived data.** Grep
   reducers/selectors for a data field with its own loading/error fields
   in one slice. An example is
   `userLoading`/`userError` sitting next to `user` in `AppState`, as in
   the example below.
2. **For each server-derived field, declare a capability alongside the
   store, not inside it.** `buildData({ fields: { user: { name: "",
email: "" } } })` + `createDataStore(...)`: the store and the
   capability coexist during the migration.
3. **Redirect the dispatch that used to set `user`/`userLoading`/
   `userError` into a `userStore.commitAuthoritative(...)` call.** The
   fetch/mutation logic inside your thunk or action creator doesn't
   change. Only where the result lands changes.
4. **Replace read sites one at a time.** Swap `useSelector((s) => s.user)`
   and its paired `useSelector((s) => s.userLoading)` for
   `userStore.getSnapshot().fields.user` / `.info.user?.status`. Verify
   each component still renders correctly before moving to the next.
5. **Delete `user`, `userLoading`, and `userError` from `AppState`** once
   every read site has moved. The slice keeps only `isModalOpen` and
   whatever else is genuinely client-only.
6. **Repeat per slice, at your own pace.** A slice with five
   server-derived and two client-only fields migrates the same way, five
   capabilities at a time. Nothing requires migrating the whole store
   in one pass.

## When to keep server-derived data in the store

- Keep data that is small and rarely stale when your team already has
  strong, consistent conventions for the loading/error fields in your
  slices. Migrating it out may not be worth the churn. This guide's value
  is highest when you're hand-rolling the same three-field pattern
  repeatedly, across many slices, with drift between them.
- Your reducers may already implement a specific conflict-resolution
  policy for concurrent writes to this field (e.g. a version-based merge).
  Note that `data-cap` deliberately doesn't provide one either (ADR 0023).
  Moving the field relocates where you implement that policy; it doesn't
  remove the need for it.
- The store's own middleware (persistence, undo/redo, devtools
  time-travel) may already treat this field as part of what it manages.
  Pulling it out may then break assumptions that middleware relies on.
  Check before moving a field a middleware depends on.
- If only one component ever reads this particular field, the migration's
  main benefit (a shared, typed shape for many consumers) doesn't apply
  yet. See `from-manual-fetch-state.md`'s equivalent single-consumer
  caveat.

## What to migrate, and what not to

`data-cap` is not a general-purpose state manager, and doesn't try to
replace your store for client-only state. The migration here is narrower
and more specific. Move _server-derived_ data (the kind that has a
loading/success/error lifecycle) out of your store's slices and into
capability-owned contracts. Keep genuinely client-only state (that modal,
that draft form) exactly where it already is.

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
instead becomes a `userStore.commitAuthoritative(...)` call. For
server-derived data, this getter/mutator wiring replaces action
creators/reducers. See `test/integration/runtime-core/basic-standalone/`
and `test/integration/runtime-core/server-database-integration/` for the
pattern.

## What you gain

- **No more hand-rolled loading/error fields per piece of server data.**
  `info.<field>.status`/`error` already model this consistently. No
  developer has to invent the same three-field pattern in every slice.
- **Reference-stable, structurally-shared updates.** A store update that
  only touches one field never forces a change to unrelated branches of
  the previous state. Your existing store's reducers likely already try to
  preserve the same guarantee by hand, via immutable-update patterns.
- **A smaller, more focused global store.** Once server-derived data moves
  out, what's left is client-only state, which is easier to
  reason about on its own.

## What doesn't change

Your store's own middleware, devtools, and any purely client-side logic
stay exactly as they are. This migration only moves server-derived data
out; it doesn't ask you to replace the store itself.
