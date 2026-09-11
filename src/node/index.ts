// The `@maverickcer/data-cap/node` entry point: the concrete, Node-backed
// `BuildFileSystem` adapter a caller of `@maverickcer/data-cap/build` hands to
// `generateDataArtifacts` / `checkArtifacts` (and the standalone generator
// functions) as the required `fs` capability.
//
// This is an **executable-context** entry, exactly like `bin` and
// `./eslint-plugin` -- it is the sanctioned place `node:fs/promises` is
// acquired. `./build` itself never imports `node:fs` (ADR 0058); a consumer
// running the generators from their own build script imports the adapter from
// here:
//
// ```ts
// import { generateDataArtifacts } from "@maverickcer/data-cap/build"
// import { nodeBuildFileSystem } from "@maverickcer/data-cap/node"
//
// await generateDataArtifacts({ fs: nodeBuildFileSystem, root, ... })
// ```
//
// A consumer in a non-Node runtime supplies their own `BuildFileSystem`
// (`@maverickcer/data-cap/build` exports the type) instead of importing this.
export { nodeBuildFileSystem } from "../cli/filesystem.js"
