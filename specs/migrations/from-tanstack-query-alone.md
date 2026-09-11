# Migrating from TanStack Query alone

This isn't really a migration _away_ from TanStack Query — it's a
migration to using it _underneath_ `data-cap` instead of directly. If your
application already uses TanStack Query for fetching/caching/refetch
policy, keep it. `data-cap` adds a consistent `fields`/`info` contract on
top, so a `useQuery` result and a Socket.IO event and a plain `fetch` call
all end up expressed the same way in your application code, instead of
each having its own ad hoc shape.

## Migration goals

- Give a `useQuery` result the same `fields`/`info` shape every other data
  source in the application already uses.
- Make it straightforward to reconcile a TanStack Query result with a
  second source (a WebSocket event, a plain `fetch` call) in the same
  component, without ad hoc merge logic per component.
- Layer `info`'s richer status vocabulary (`retrying`, `optimistic`,
  per-field `source`) on top of whatever TanStack Query's own result
  object already tracks.
- Let several components share one derived value, even when it's
  assembled from more than one query, without each one calling `useQuery`
  again itself.
- Leave TanStack Query's own competencies — request dedup, `staleTime`,
  refetch-on-window-focus — completely untouched.

## Migrating incrementally

1. **Find `useQuery` calls worth migrating first.** Prioritize ones whose
   result is read in more than one component, or that already need
   reconciling with a non-TanStack-Query source — a `useQuery` call with
   exactly one reader and no second source doesn't need this yet (see
   below).
2. **Declare a capability for the data the `queryFn` produces.**
   `buildData({ fields: { user: { name: "", email: "" } } })` +
   `createDataStore(...)` — the shape mirrors the query's own result type.
3. **Wrap the existing `queryFn` in a function that commits the result**,
   calling `queryClient.fetchQuery({ queryKey, queryFn })` and committing
   via `commitAuthoritative`, exactly as shown in "After" below — the
   `queryFn` itself is untouched.
4. **Replace `const { data, isPending, isError, error } = useQuery(...)`
   at each read site** with `userStore.getSnapshot().fields.user` /
   `.info.user?.status`, triggering the load from wherever the `useQuery`
   call used to live.
5. **Verify TanStack Query's own behavior is unaffected** — concurrent
   calls still dedupe, `staleTime` still governs refetching, exactly as
   before. `test/integration/adoption-patterns/tanstack-query-integration/` asserts on both
   directly; run the same checks against your migrated call.
6. **Repeat per query**, and stop once you reach a `useQuery` call with a
   single reader and no second source to reconcile — see below.

If you'd rather not hand-write the commit calls in step 3, `createData`
(`@maverickcer/data-cap/runtime`, ADR 0048) composes `buildData` +
`createDataStore` + a coordinator for you — see
`examples/application/`.

## When to keep `useQuery` results direct

- If your application only ever has one data source for this value —
  TanStack Query — and never needs to reconcile it with a WebSocket or
  plain-`fetch` value in the same component, `data-cap`'s
  shape-unification benefit doesn't apply yet. Keep reading `useQuery`'s
  result directly until a second source appears.
- If a component relies on TanStack Query's other hook conveniences
  directly — `isFetching`, `refetch()`, pagination/`useInfiniteQuery`
  helpers — wrapping the result in a store means re-deriving or
  separately exposing those, since `info` doesn't model them. Weigh that
  cost against how many consumers actually need the shared shape.
- If only one component reads this query's result, there's no sharing
  problem to solve, and the wrapping is pure overhead.

## Before: reading a TanStack Query result directly

```ts
const { data, isPending, isError, error } = useQuery({
  queryKey: ["user"],
  queryFn: fetchUser,
})
```

This is fine on its own. The friction shows up once a second data source
(a WebSocket event, a plain `fetch` elsewhere in the app) needs to be
reconciled with `data` in the same component, or once several components
need the same derived-from-multiple-sources value — each source has its
own result shape, and reconciling them is ad hoc every time.

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

TanStack Query still owns everything it's good at — request dedup,
time-based caching (`staleTime`), refetch-on-window-focus, and so on.
`data-cap` only owns the resulting shape. See
`test/integration/adoption-patterns/tanstack-query-integration/` for this pattern fully worked and
tested, including a direct demonstration that TanStack Query's own
concurrent-request dedup and `staleTime` caching behave identically
whether or not `data-cap` is involved.

## What you gain

- **One consistent shape across every data source.** A value that came
  from TanStack Query and a value that came from a raw `fetch` or a
  Socket.IO event both end up as the same `fields`/`info` pair, so
  consuming code doesn't need to know or care which one produced it.
- **`info`'s richer status vocabulary** (`retrying`, `optimistic`, per-field
  `source`) alongside whatever TanStack Query's own result object already
  tracks.

## What doesn't change

Your `queryFn`s, your `QueryClient` configuration, your caching/refetch
policy — none of it changes. This migration only adds a thin commit step
after a query settles; TanStack Query's own behavior is untouched.
