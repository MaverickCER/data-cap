# coordinator-isolation

**Server-side pattern.** A multi-tenant Node process handling several
tenants in one running instance. The default coordinator is a shared,
module-level singleton -- fine for a single-tenant app, but wrong for a
multi-tenant one: two tenants happening to call the exact same function
with the exact same params must never dedupe or share work with each
other. `createCoordinator()` gives each tenant its own explicit, isolated
domain.

## Run it

```sh
npm install
npm start
```

## What it proves

- Two isolated coordinators never share work, even for byte-identical
  params through the identical function reference.
- Sharing still works normally _within_ one coordinator -- isolation is an
  explicit, opt-in boundary, not a general dedup regression.
- The default singleton is itself a third, independent domain from any
  explicitly created coordinator.
