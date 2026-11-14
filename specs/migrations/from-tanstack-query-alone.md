# Migrating from TanStack Query alone

This isn't really a migration _away_ from TanStack Query. It's a migration
to using it _underneath_ `data-cap` instead of directly. If your
application already uses TanStack Query for fetching/caching/refetch
policy, keep it. `data-cap` adds a consistent `fields`/`info` contract on
top. A `useQuery` result, a Socket.IO event and a plain `fetch` call then
all end up expressed the same way in your application code. Without it,
each has its own ad hoc shape.

## Migration goals

- Give a `useQuery` result the same `fields`/`info` shape every other data
  source in the application already uses.
- Make it straightforward to reconcile a TanStack Query result with a
  second source (a WebSocket event, a plain `fetch` call) in the same
  component. No component then needs its own ad hoc merge logic.
- Layer `info`'s richer status vocabulary (`retrying`, `optimistic`,
  per-field `source`) on top of whatever TanStack Query's own result
  object already tracks.
- Let several components share one derived value, even when it's
  assembled from more than one query, without each one calling `useQuery`
  again itself.
- Leave TanStack Query's own competencies completely untouched: request
  dedup, `staleTime`, refetch-on-window-focus.

## Migrating incrementally

1. **Find `useQuery` calls worth migrating first.** Prioritize ones read in
   more than one component, or ones that must be reconciled with a
   non-TanStack-Query source. A `useQuery` call with
   exactly one reader and no second source doesn't need this yet (see
   below).
2. **Declare a capability for the data the `queryFn` produces.**
   `buildData({ fields: { user: { name: "", email: "" } } })` +
   `createDataStore(...)`: the shape mirrors the query's own result type.
3. **Wrap the existing `queryFn` in a function that commits the result.**
   It calls `queryClient.fetchQuery({ queryKey, queryFn })` and commits
   via `commitAuthoritative`, exactly as shown in "After" below. The
   `queryFn` itself is untouched.
4. **Replace `const { data, isPending, isError, error } = useQuery(...)`
   at each read site** with `userStore.getSnapshot().fields.user` /
   `.info.user?.status`. Trigger the load from wherever the `useQuery`
   call used to live.
5. **Verify TanStack Query's own behavior is unaffected.** Concurrent
   calls still dedupe, and `staleTime` still governs refetching, exactly as
   before. `test/integration/adoption-patterns/tanstack-query-integration/`
   asserts on both directly; run the same checks against your migrated
   call.
6. **Repeat per query**, and stop once you reach a `useQuery` call with a
   single reader and no second source to reconcile (see below).

You may rather not hand-write the commit calls in step 3. `createData`
(`data-cap/runtime`, ADR 0048) composes `buildData` + `createDataStore` +
a coordinator for you; see `examples/application/`.

## When to keep `useQuery` results direct

- Your application may only ever have one data source for this value
  (TanStack Query). It may never need to reconcile it with a WebSocket or
  plain-`fetch` value in the same component. Then `data-cap`'s
  shape-unification benefit doesn't apply yet. Keep reading `useQuery`'s
  result directly until a second source appears.
- A component may rely on TanStack Query's other hook conveniences
  directly: `isFetching`, `refetch()`, pagination/`useInfiniteQuery`
  helpers. Wrapping the result in a store means re-deriving or separately
  exposing those, since `info` doesn't model them. Weigh that cost against
  how many consumers actually need the shared shape.
- If only one component reads this query's result, there's no sharing
  problem to solve, and the wrapping is pure overhead.

## Before: reading a TanStack Query result directly

```ts
const { data, isPending, isError, error } = useQuery({
  queryKey: ["user"],
  queryFn: fetchUser,
})
```

This is fine on its own. The friction shows up in two cases. One is a
second data source (a WebSocket event, a plain `fetch` elsewhere in the
app) to reconcile with `data` in the same component. The
other is several components that need the same
derived-from-multiple-sources value. Each source has its own result shape,
and reconciling them is ad hoc every time.

## After: TanStack Query drives the fetch, data-cap owns the shape

```ts
const userCapability = buildData({ fields: { user: { name: "", email: "" } } })
const userStore = createDataStore(userCapability)

async function loadUser(queryClient: QueryClient): Promise<void> {
  userStore.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await queryClient.fetchQuery({ queryKey: ["user"], queryFn: fetchUser })
    userStore.commitAuthoritative(
      { user: raw },
      { user: { status: "success", source: "tanstack-query" } },
    )
  } catch (error) {
    userStore.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "loadUser", error } },
    })
  }
}
```

TanStack Query still owns everything it's good at: request dedup,
time-based caching (`staleTime`), refetch-on-window-focus, and so on.
`data-cap` only owns the resulting shape. See
`test/integration/adoption-patterns/tanstack-query-integration/` for this
pattern fully worked and tested. It includes a direct demonstration that
TanStack Query's own concurrent-request dedup and `staleTime` caching
behave identically whether or not `data-cap` is involved.

## What you gain

- **One consistent shape across every data source.** Values from
  TanStack Query, a raw `fetch` or a Socket.IO event end up as the same
  `fields`/`info` pair. Consuming
  code doesn't need to know or care which one produced it.
- **`info`'s richer status vocabulary** (`retrying`, `optimistic`, per-field
  `source`) alongside whatever TanStack Query's own result object already
  tracks.

## What doesn't change

Your `queryFn`s, your `QueryClient` configuration, and your caching/refetch
policy do not change. This migration only adds a thin commit step after a
query settles; TanStack Query's own behavior is untouched.
