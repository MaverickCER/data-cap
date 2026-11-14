# node

`data-cap/node` (Node only): `nodeBuildFileSystem`, the `node:fs` adapter a build script passes
to `data-cap/build` as its `fs` option.

## Variables

### nodeBuildFileSystem

```ts
const nodeBuildFileSystem: BuildFileSystem;
```

The Node-backed `BuildFileSystem`: the filesystem capability the build-time generators require.
