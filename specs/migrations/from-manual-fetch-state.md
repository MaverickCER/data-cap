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

This works, but it doesn't scale past one component. A second component
that also needs `user` either duplicates this whole triple or has to be
handed the value through props/context. There's no shared, typed notion of
"is this still loading" that both components agree on.

## Migration goals

- Share `user` (and its loading/error state) across every component that
  needs it. Avoid prop drilling, and avoid a context provider whose only
  job is holding this one value.
- Replace three separately-invented booleans/nullables (`loading`, `error`,
  `user`) with one typed status vocabulary (`idle`/`loading`/`success`/
  `error`/`retrying`) every consumer agrees on.
- Dedupe concurrent fetches. Two components mounting around the same time
  and both triggering a load should share one network request, not fire
  two.
- Give every consumer a reference-stable snapshot. A component that
  doesn't read `user` then doesn't re-render because some other
  component's local `useState` changed.

## Migrating incrementally

1. **Find every read site.** Grep for the state you're replacing
   (`useState<User`, `setUser`, `setLoading`, `setError`) across
   components and hooks. Each hit is a read site (or the fetch site)
   you'll touch below.
2. **Declare the capability once, in a shared module.** `buildData({
fields: { user: { name: "", email: "" } } })` plus `createDataStore(...)`,
   as in the example above. This replaces the _type_ the data lives in,
   not the fetch itself.
3. **Move the existing fetch into a function that commits into the
   store.** Its `fetch("/api/user")` call, response parsing and error
   handling stay unchanged. Only the destination of the
   result changes, from `setUser`/`setLoading`/`setError` to
   `userStore.commitAuthoritative(...)`.
4. **Replace one read site at a time.** Swap `const [user] =
useState<User | null>(null)` for `userStore.getSnapshot().fields.user`.
   Swap the component's own `useEffect` fetch for a call to the shared
   `loadUser()`, or drop the call entirely if another component already
   triggers it. Verify each component still compiles and renders
   correctly before moving to the next.
5. **Delete the original `useState`/`useEffect` triple** once every read
   site has moved. The shared capability module is now the only place
   that calls `fetch("/api/user")`.

## When to keep the `useState` triple as-is

- If only one component ever reads this data, and there's no concrete
  plan for a second consumer, the `useState` triple is simpler. This
  migration adds a capability module, a store, and a subscription for a
  sharing benefit you don't need yet.
- The fetch may only ever happen once per page load, behind a top-level
  loader or suspense boundary that already guarantees no second
  concurrent call. Then `coordinator.dedupe`'s main benefit doesn't
  apply: there's nothing to dedupe.
- The component may already gate its render on `loading` (`if (loading)
return <Spinner />`). Then you're not benefiting much from fields being
  synchronously readable before the first fetch resolves (ADR 0004). That
  guarantee matters most when _other_ code reads the field without first
  checking `loading` itself.
- This state may be genuinely local and short-lived (a one-off settings
  page, a wizard step). Then the ongoing subscription lifecycle a shared
  store implies is more machinery than the page needs.

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

// A stable, MODULE-LEVEL reference -- not an inline arrow written directly
// inside `dedupe(...)` below. `coordinator.dedupe` shares work by the
// IDENTITY of the function passed to it; a fresh closure created on every
// `loadUser()` call has a fresh identity every time, so two components both
// calling `loadUser()` around the same time would never actually share one
// in-flight `fetchUser()` request despite looking deduped at a glance.
function executeFetchUser(_params: undefined, signal: AbortSignal) {
  return fetchUser(signal)
}

export async function loadUser(): Promise<void> {
  const controller = new AbortController()
  userStore.commitAuthoritative(undefined, { user: { status: "loading" } })
  try {
    const raw = await defaultCoordinator.dedupe(executeFetchUser, undefined, controller.signal)
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
`userStore.getSnapshot().info.user?.status`. It subscribes via
`userStore.subscribe(...)`, which is directly compatible with React's
`useSyncExternalStore`; no data-cap-specific hook is required. See
`test/integration/runtime-core/basic-standalone/` for this exact pattern,
fully worked and tested.

## What you gain

- **One shared source of truth.** A second component reading `user` gets
  the same value and the same `status`, automatically. No prop drilling
  or context provider is needed for this.
- **Deduped concurrent loads.** Two components both triggering `loadUser()`
  around the same time share one real fetch, via `coordinator.dedupe`.
- **A typed, consistent status vocabulary** (`idle`/`loading`/`success`/
  `error`/`retrying`) instead of each component inventing its own boolean
  flags.

## What doesn't change

Your fetch call itself, your API, and your error handling logic all stay
exactly as they were. This migration only changes _where_ the resulting
state lives and how it's shared, not how the data is fetched.
