# Migrating from Apollo Client

Apollo Client solves GraphQL transport, in-flight request dedup, and a
normalized, cross-query cache — a mutation that updates a `Post`'s title
updates every query result that already includes that `Post`,
automatically, because Apollo tracks entities by `__typename` + `id`, not
by query. That's a genuinely different mental model from a REST client's
per-request cache, and this guide doesn't ask you to give it up: Apollo
can keep doing GraphQL transport, caching, and normalization exactly as it
does today.

What `useQuery` doesn't give you for free is a shape that's shared across
consumers that aren't Apollo-specific. `const { data, loading, error } =
useQuery(GET_USER)` produces a result scoped to that call site, in
Apollo's own vocabulary. A second component reading the same user re-runs
`useQuery` (Apollo dedupes the underlying network request via its cache,
but the component still owns its own `loading`/`error` locals), and a
value that needs to be reconciled with a non-GraphQL source (a WebSocket
event, a REST fallback) has no shared shape to reconcile against — the
same friction `from-tanstack-query-alone.md` describes for TanStack Query,
just with GraphQL's own result shape instead of REST's.

## Migration goals

- Give components a single `fields`/`info` shape for an entity, instead of
  each `useQuery` call site owning its own `data`/`loading`/`error`
  locals.
- Make it possible to reconcile a GraphQL-sourced value with a
  non-GraphQL one (a REST fallback, a WebSocket push) in the same
  component, without ad hoc merge logic per component.
- Decouple "is this component subscribed to Apollo's cache" from "is this
  component reading fresh data" — a capability's `info.<field>.status`
  reports the actual fetch lifecycle, not just whether Apollo's cache
  happens to have a matching entry.
- Keep Apollo doing what it's actually good at — GraphQL transport,
  in-flight dedup, and normalized cross-query cache updates on mutation —
  none of that is being replaced.

## Migrating incrementally

1. **Find `useQuery` calls worth migrating first.** Prioritize ones whose
   result is read in more than one component, or that already need
   reconciling with a non-GraphQL source — same prioritization as
   `from-tanstack-query-alone.md`.
2. **Declare a capability for the entity the query returns.** `buildData({
fields: { user: { name: "", email: "" } } })` + `createDataStore(...)`
   — the shape mirrors the query's own selection set.
3. **Write a function that calls `client.query(...)` and commits the
   result.** `client.query({ query: GET_USER, fetchPolicy: "network-only"
})` (from `useApolloClient()` inside a component, or an injected
   `ApolloClient` instance elsewhere) followed by
   `userStore.commitAuthoritative(...)` — the GraphQL document, variables,
   and Apollo's own cache/network policy are untouched.
4. **Replace `const { data, loading, error } = useQuery(GET_USER)` at each
   read site** with `userStore.getSnapshot().fields.user` /
   `.info.user?.status`, calling the function from step 3 wherever the
   component used to rely on Apollo's own fetch-on-mount behavior.
5. **For mutations, keep using `useMutation`/`client.mutate()` as the
   transport**, and commit its result into the store the same way —
   `data-cap`'s own optimistic/no-rollback rules (ADR 0021–0023) apply to
   that commit exactly as they would for any other mutation.
6. **Repeat per query/entity**, and stop at any `useQuery` call with a
   single reader and no second source to reconcile — see below.

## When to keep Apollo Client as-is

- If you rely on Apollo's normalized cache to keep multiple queries in
  sync automatically — a mutation on a `Post` updating every list/detail
  query that includes it, with no code written to make that happen —
  moving that data's reads into a `data-cap` capability means you take
  over that synchronization yourself; `data-cap` has no cross-capability
  normalization, only reference-stable updates within one capability's
  own fields.
- If a component depends on Apollo-specific hook behavior (`fetchMore`,
  cache-only reads via `fetchPolicy: "cache-only"`, live updates via
  `useSubscription`), wrapping the result in a store means re-deriving or
  separately exposing that behavior, since `info` doesn't model it.
- If only one component reads a given query's result and there's no
  second source to reconcile it with, `useQuery`'s own `data`/`loading`/
  `error` is simpler — this migration adds a capability module and a
  store for a sharing benefit you don't need yet.
- If your team isn't planning to introduce a second, non-GraphQL data
  source for the same entities, the specific problem this guide solves
  (reconciling shapes across sources) doesn't exist yet in your
  application.

## Before: reading a useQuery result directly

```ts
import { gql, useQuery } from "@apollo/client"

const GET_USER = gql`
  query GetUser {
    user {
      name
      email
    }
  }
`

function UserProfile() {
  const { data, loading, error } = useQuery(GET_USER)

  if (loading) return <Spinner />
  if (error) return <ErrorMessage error={error} />

  return <Profile name={data.user.name} email={data.user.email} />
}
```

Every component that needs `user` calls `useQuery(GET_USER)` again. Apollo
dedupes the underlying network request through its cache, but each call
site still owns its own `loading`/`error` locals — there's no shared,
typed notion of "is this still loading" the way `info.user?.status`
provides across components.

## After: Apollo drives the fetch, data-cap owns the shape

```ts
import { gql, ApolloClient, NormalizedCacheObject } from "@apollo/client"
import { buildData } from "data-cap"
import { createDataStore } from "data-cap/runtime"

const GET_USER = gql`
  query GetUser {
    user {
      name
      email
    }
  }
`

const userCapability = buildData({ fields: { user: { name: "", email: "" } } })
const userStore = createDataStore(userCapability)

async function loadUser(client: ApolloClient<NormalizedCacheObject>): Promise<void> {
  userStore.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const { data } = await client.query({ query: GET_USER, fetchPolicy: "network-only" })
    userStore.commitAuthoritative(
      { user: data.user },
      { user: { status: "success", source: "apollo-client" } },
    )
  } catch (error) {
    userStore.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "loadUser", error } },
    })
  }
}
```

Inside a component, `client` comes from `useApolloClient()` rather than a
parameter — the commit logic is identical either way. Apollo still owns
the GraphQL document, request dedup, and its own normalized cache;
`data-cap` only owns the resulting shape.

`data-cap` has no dedicated Apollo example yet — unlike
`test/integration/adoption-patterns/tanstack-query-integration/`, which is this exact pattern fully
worked and tested against TanStack Query, there's no equivalent
`examples/apollo-client-integration/` directory today. Adapt
`tanstack-query-integration`'s `src/main.ts` directly: replace
`queryClient.fetchQuery(...)` with `client.query(...)`, and `QueryClient`
with `ApolloClient`. The commit shape (`commitAuthoritative`,
`info.<field>.status`, `source`) is identical either way.

## What you gain

- **One consistent shape across every data source**, GraphQL or not — a
  value that came from Apollo and a value that came from a plain `fetch`
  or a WebSocket event both end up as the same `fields`/`info` pair,
  exactly as `from-tanstack-query-alone.md` describes for TanStack Query.
- **Fields are synchronously readable before the first query resolves**
  (ADR 0004) — a component reading `userStore.getSnapshot().fields.user`
  before `loadUser()` has ever run gets the declared default, not
  `data: undefined` paired with a `loading: true` check every read site
  has to repeat.
- **A typed status vocabulary** (`idle`/`loading`/`success`/`error`/
  `retrying`) that doesn't depend on which query, or which library,
  produced the value.

## What doesn't change

Your GraphQL documents, your `ApolloClient` configuration (link chain,
cache policies, auth), and Apollo's own normalized cache all stay exactly
as they are — this migration only adds a commit step after a query
settles. If you still want a query's result to participate in Apollo's
cross-query cache normalization, keep reading it through Apollo directly
for that purpose; nothing requires an all-or-nothing switch away from
`useQuery`. Per ADR 0037, there's no first-party Apollo adapter to adopt
instead — the wiring above is copy-and-adapt, the same way
`test/integration/adoption-patterns/tanstack-query-integration/` and
`test/integration/subscriptions/socket-io-subscription/` already are for their own libraries.
