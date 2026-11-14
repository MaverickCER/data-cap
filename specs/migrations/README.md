# Migrating to data-cap

`data-cap` adds a typed, analyzable contract (fields + execution metadata)
on top of the tools your application already uses. It is not a replacement
for your fetching library, your state manager, or your transport. If your
application already uses TanStack Query, Redux, Zustand, or a hand-rolled
`useState`/`useEffect` pattern, those tools keep doing what they do. With
the contract on top, every consumer of a given piece of data agrees on its
shape and its current status. No component has to re-derive that agreement
ad hoc.

## Guides

- [From manual fetch-and-state](from-manual-fetch-state.md): replace
  scattered `useState`/`useEffect` loading/error/data triples with one
  typed `DataState`.
- [From a global store](from-a-global-store.md): keep a Redux/Zustand-style
  store for client-only UI state, and move server-derived data into
  capability-owned contracts.
- [From TanStack Query alone](from-tanstack-query-alone.md): keep TanStack
  Query doing what it's good at (fetching, caching, refetch policy). Let
  its results flow into a `data-cap` `DataStore` for a consistent
  `fields`/`info` shape across every data source.
- [From Apollo Client](from-apollo-client.md): keep Apollo Client doing
  GraphQL transport and normalized caching if you want to. Let capability
  fields become the shape components read, instead of each `useQuery`
  call's own `data`/`loading`/`error` shape.

## Migration strategy

Migrate incrementally, one capability at a time:

1. Pick one piece of data (a user profile, a list of comments) currently
   tracked with ad hoc state.
2. Declare its shape with `buildData({ fields: ... })`. Or use `createData`
   directly to declare fields and operations together (see
   `examples/application/`).
3. Wire whatever already fetches it (a `fetch` call, TanStack Query, a
   Socket.IO event) to commit into a `createDataStore()` instance. See
   `test/integration/runtime-core/basic-standalone/` for the reference
   wiring pattern. Or let `createData` own that wiring for you.
4. Replace the ad hoc `useState`/`useEffect` triple (or store slice) with
   reads from the capability's `fields`/`info`.
5. Repeat for the next piece of data, at your own pace. Nothing about this
   migration requires a single big-bang rewrite.

The goal is not fewer state management tools. The goal is one consistent,
typed shape for "what is this data, and what's its current status". That
shape holds across however many tools your application already uses to
fetch and mutate it.
