# Next.js example

A minimal todo app with a user and admin ownership model. It uses only `data-cap`'s published API, never a private `src/` import.

The [three tiers](../README.md) grow one work-management system from one developer to an organization. This example is different: it is a framework integration. It runs `createData()` on the client inside a real Next.js app, with a server-side authorization boundary. It also records what that took, including a bug found while building it.

```text
src/
  features/todos/
    data.schema.ts       <- createData + documentData, one schema for both
  lib/
    session.ts           <- "server-only"; signed demo-login cookie
    store.ts             <- in-memory todos + three seeded demo users
  app/
    page.tsx              <- server component; reads the session cookie
    todo-app.tsx           <- "use client"; useSyncExternalStore(todoData...)
    api/
      session/route.ts     <- POST (sign in), DELETE (sign out)
      todos/route.ts        <- GET/POST/PATCH/DELETE; the real authorization logic
  generated/
    data.manifest.ts      <- generated, do not edit
docs/
  DATA.md                 <- generated
  OWNERSHIP.md            <- generated
  data.evidence.json      <- generated, the full EvidenceModel
```

## Run it

Build the package first: `npm run build` at the repository root. Then, in this directory, run `npm install` and:

| Command         | Exit code | Look for                                                                           |
| --------------- | --------- | ---------------------------------------------------------------------------------- |
| `npm run build` | 0         | `Compiled successfully` (it runs `npm run docs` first)                             |
| `npm run check` | 0         | `[generate-docs check] manifest/docs/ownership/evidence artifacts are up to date.` |
| `npm start`     | stays up  | the server listening on `http://localhost:3000`                                    |

CI's `examples` job runs `npm ci` and `npm run build` here; `npm run build` runs `npm run docs` first. CI does not run `npm run check`, `npm start` or the authorization steps below. That job does not block a merge.

Then visit `/`, sign in as any of the three seeded users, and try the authorization boundaries below. Or drive them with `curl`:

```bash
curl -c alice.txt -X POST -H 'content-type: application/json' \
  -d '{"userId":"alice"}' http://localhost:3000/api/session
curl -b alice.txt 'http://localhost:3000/api/todos?all=true'   # 403
```

## The authorization model

There are three seeded demo users: `alice` and `bob` (`role: "user"`) and `carol-admin` (`role: "admin"`). `POST /api/session` is a demo login switcher with no password. Authentication is out of scope; server-enforced authorization once a session exists is the point.

`GET /api/todos` holds the model:

- A regular user always gets `listOwnTodos(user.id)`: their own todos only, with no way to ask for more.
- An admin gets the same own-only view by default. Seeing everyone's todos needs an explicit `?all=true` query parameter. Asking for it without the admin role returns 403.
- `PATCH` and `DELETE` enforce ownership the same way, in `store.ts`'s `toggleTodo` and `deleteTodo`. Only the owner or an admin may act. A non-owner gets the same 404 as for a missing todo, so trying an id reveals nothing.

These were checked by hand against a running server, not in CI. Alice can read and change her own todo. Her `?all=true` request gets 403. Her attempt to delete Bob's todo gets 404, not 403. Carol's default view is empty, since she owns no todos. Carol's `?all=true` view shows every user's todos and lets her delete any of them.

## `data-cap`'s field documentation

`data.schema.ts`'s `documentData()` call declares the `todos` field's `sensitivity`, `protections`, `retention` and `purpose`. The route handlers above enforce per-record ownership; `data-cap` does not. `docs/OWNERSHIP.md` says so: `data-cap`'s ownership model is per capability (which team owns the field), not per record (which user owns the row).

**A known limitation, left visible:** `npm run check` reports one warning, `UNCONSUMED_FIELD` on `todos`. The dependency scan recognizes a literal `x.fields.Y` or `x.getSnapshot().fields.Y` read. It does not follow `todo-app.tsx`'s `useSyncExternalStore(todoData.subscribe, todoData.getSnapshot, todoData.getSnapshot)`, which passes `getSnapshot` by reference. The field is read and displayed; the scan cannot see it. No unused direct read was added just to satisfy the check.

## What it took to get `next start` working

Two issues came up, with the same cause as the one [env-cap's Next.js example](https://github.com/MaverickCER/env-cap/tree/main/examples/nextjs-app) documents. Turbopack splits this app into separate chunks: the `/api/session` route, the `/api/todos` route and the `/` page. Each chunk gets its own bundled copy of any module with module-level state.

1. **`useSyncExternalStore` needs a third argument for server rendering.** Without `getServerSnapshot`, React throws `Missing getServerSnapshot, which is required for server-rendered content`. It then falls back to client-only rendering, as the server log showed. `todoData.getSnapshot` is safe for both arguments, because it reads the capability's in-memory state, never `window` or `document`.
2. **A per-process random secret is not per-process under a bundler.** `session.ts` first created `SESSION_SECRET` as a module-level `randomBytes(32)`. Logged from `/api/session` and from `/` in one server, it printed two different values. Each chunk's copy of `session.ts` had made its own call. A cookie signed by one chunk then failed verification in another, with no error, so every request looked signed out. The fix keys the secret on `globalThis` through `Symbol.for(...)`, which every chunk in the process shares.

## What's out of scope

Real authentication (passwords, OAuth), a real database and CSRF protection are out of scope. This example shows the user and admin ownership boundary; it is not a production todo app. The in-memory store (`store.ts`) resets on every server restart.
