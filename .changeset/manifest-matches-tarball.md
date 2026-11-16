---
"data-cap": patch
---

The published manifest now matches the package.json inside the tarball. `bundleDependencies` lists
only `@typescript/typescript6`; its TypeScript 6 payload, `@typescript/old`, still ships as that
package's dependency. Listing `@typescript/old` separately made npm add `"@typescript/old": "*"` to
the registry manifest, which Socket reported as manifest confusion.
