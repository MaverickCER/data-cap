# array-identity-reconciliation

**Client-side pattern.** `fields.comments` stays an ordinary array;
`info.comments` keys each item by a declared identity instead of array
index (an index shifts under insertion/removal/reorder, silently
reattaching metadata to the wrong item). `helpers.identity` exposes the
same two primitives the standalone runtime would use internally.

## Run it

```sh
npm install
npm start
```

## What it proves

- **Reference-stable reconciliation:** refetching a list where only one
  item changed keeps every untouched item's `FieldInfo` object reference
  exactly -- this is a diff against the previous info map, never a full
  rebuild.
- **Missing-input matrix:** a genuinely absent key warns and degrades to a
  fixed sentinel token; an explicit `null` value is its own real,
  canonicalizable identity (distinct from the missing-key token) and does
  _not_ warn; a duplicate identity across two items warns but keeps both
  items in `fields`, collapsing only their shared `info` slot.
- No identity declared means no per-item info at all -- never a silent
  fallback to numeric array index.
