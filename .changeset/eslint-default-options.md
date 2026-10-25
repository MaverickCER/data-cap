---
"data-cap": patch
---

The `no-fields-escape`, `no-raw-external-io` and `stable-operation-reference` ESLint rules pass their default options through `meta.defaultOptions`, so linting the plugin no longer reports a deprecation with `@typescript-eslint/utils` 8.72 and later. They still pass the legacy top-level property for releases before 8.55, so the `^8.0.0` peer range is unchanged.
