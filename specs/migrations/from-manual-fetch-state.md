# Migrating from manual fetch-and-state

The most common starting point: a component (or a small hook) tracking a
piece of server data with its own `useState` triple.

```ts
const [user, setUser] = useState<User | null>(null)
const [loading, setLoading] = useState(false)
const [error, setError] = useState<unknown>(null)

useEffect(() => {
  setLoading(true)
  fetch("/api/user")
    .then((r) => r.json())
    .then((data) => {
      setUser(data)
      setLoading(false)
    })
    .catch((err) => {
      setError(err)
      setLoading(false)
    })
}, [])
```

This works, but it doesn't scale past one component: a second component
that also needs `user` either duplicates this whole triple or has to be
handed the value through props/context, and there's no shared, typed
notion of "is this still loading" that both components agree on.

## Migration goals

- Share `user` (and its loading/error state) across every component that
  needs it, without prop drilling or reaching for a context provider whose
  only job is holding this one value.
- Replace three separately-invented booleans/nullables (`loading`, `error`,
  `user`) with one typed status vocabulary (`idle`/`loading`/`success`/
  `error`/`retrying`) every consumer agrees on.
- Dedupe concurrent fetches — two components mounting around the same time
  and both triggering a load should share one network request, not fire
  two.
- Give every consumer a reference-stable snapshot, so a component that
  doesn't read `user` doesn't re-render just because some other
  component's local `useState` changed.

## Migrating incrementally

1. **Find every read site.** Grep for the state you're replacing —
   `useState<User`, `setUser`, `setLoading`, `setError` — across
   components and hooks. Each hit is a read site (or the fetch site)
   you'll touch below.
2. **Declare the capability once, in a shared module.** `buildData({
fields: { user: { name: "", email: "" } } })` plus `createDataStore(...)`,
   as in the example above — this replaces the _type_ the data lives in,
   not the fetch itself.
3. **Move the existing fetch into a function that commits into the
   store.** The `fetch("/api/user")` call, its response parsing, and its
   error handling stay exactly as they are — only the destination of the
   result changes, from `setUser`/`setLoading`/`setError` to
   `userStore.commitAuthoritative(...)`.
4. **Replace one read site at a time.** Swap `const [user] =
useState<User | null>(null)` for `userStore.getSnapshot().fields.user`,
   and the component's own `useEffect` fetch for a call to the shared
   `loadUser()` (or drop the call entirely if another component already
   triggers it). Verify each component still compiles and renders
   correctly before moving to the next.
5. **Delete the original `useState`/`useEffect` triple** once every read
   site has moved — the shared capability module is now the only place
   that calls `fetch("/api/user")`.

## When to keep the `useState` triple as-is

- If only one component ever reads this data, and there's no concrete
  plan for a second consumer, the `useState` triple is simpler — this
  migration adds a capability module, a store, and a subscription for a
  sharing benefit you don't need yet.
- If the fetch only ever happens once per page load (behind a top-level
  loader or suspense boundary that already guarantees no second concurrent
  call), `coordinator.dedupe`'s main benefit doesn't apply — there's
  nothing to dedupe.
- If the component already gates its render on `loading` (`if (loading)
return <Spinner />`), you're not benefiting much from fields being
  synchronously readable before the first fetch resolves (ADR 0004) — that
  guarantee matters most when _other_ code reads the field without first
  checking `loading` itself.
- If this state is genuinely local and short-lived (a one-off settings
  page, a wizard step), the ongoing subscription lifecycle a shared store
  implies is more machinery than the page needs.

## The equivalent with data-cap

```ts
// user-capability.ts -- declared once, shared by every consumer
import { buildData } from "data-cap"
import { createDataStore, defaultCoordinator } from "data-cap/runtime"

export const userCapability = buildData({ fields: { user: { name: "", email: "" } } })
export const userStore = createDataStore(userCapability)

async function fetchUser(signal: AbortSignal) {
  const response = await fetch("/api/user", { signal })
  return response.json()
}

export async function loadUser(): Promise<void> {
  const controller = new AbortController()
  userStore.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await defaultCoordinator.dedupe(
      (_params, signal) => fetchUser(signal),
      undefined,
      controller.signal,
    )
    userStore.commitAuthoritative(
      { user: raw },
      { user: { status: "success", source: "loadUser" } },
    )
  } catch (error) {
    userStore.commitAuthoritative(undefined, {
      user: { status: "error", error: { operator: "loadUser", error } },
    })
  }
}
```

Any component reads `userStore.getSnapshot().fields.user` and
`userStore.getSnapshot().info.user?.status` — subscribing via
`userStore.subscribe(...)` (directly compatible with React's
`useSyncExternalStore`, with no data-cap-specific hook required). See
`test/integration/runtime-core/basic-standalone/` for this exact pattern, fully worked and
tested.

## What you gain

- **One shared source of truth.** A second component reading `user` gets
  the same value and the same `status`, automatically, with no prop
  drilling or context provider needed just for this.
- **Deduped concurrent loads.** Two components both triggering `loadUser()`
  around the same time share one real fetch, via `coordinator.dedupe`.
- **A typed, consistent status vocabulary** (`idle`/`loading`/`success`/
  `error`/`retrying`) instead of each component inventing its own boolean
  flags.

## What doesn't change

Your fetch call itself, your API, your error handling logic — all stay
exactly as they were. This migration only changes _where_ the resulting
state lives and how it's shared, not how the data is fetched.
