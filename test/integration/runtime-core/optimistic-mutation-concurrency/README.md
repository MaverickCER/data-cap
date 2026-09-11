# optimistic-mutation-concurrency

**Client-side pattern.** `addPendingTransition` makes a mutation's
not-yet-confirmed value visible immediately; `removePendingTransition`
removes it once the operation settles, success or failure. There is no
automatic rollback and no invented conflict-resolution policy -- both fall
out of a simple rule: `project()` always folds every still-pending
transition onto whatever is _currently_ authoritative.

## Run it

```sh
npm install
npm start
```

## What it proves

- **A starts, B starts, B completes, A completes** (two independent
  fields): B's commit never clobbers A's still-pending, unrelated optimistic
  contribution. Completion order determines commit order, not start order.
- Patches are absolute value replacements, never deltas -- an "increment"
  is the caller reading the current value and computing the new one, not
  something the framework does for you.
- `FieldInfo.optimistic` is `true` exactly while a transition contributing
  to that field is still pending, and `false` once it settles.
- A failed mutation reverts to authoritative state purely because its
  pending transition was removed -- there is no separate "rollback" API to
  call.
