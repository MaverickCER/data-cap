/**
 * `core` and `runtime` are separate tsup entries, each independently
 * bundled -- a plain `Symbol()` for `FIELD_MARKER` (core/fields.ts) would
 * create a genuinely different symbol identity in each bundle's own
 * inlined copy of that module, silently breaking `isFieldMarker` the
 * moment the runtime's `createData` (runtime/capability.ts) resolves
 * ownership against a schema built with core's own `fields.nullable`/
 * `fields.optional` -- every marked field would be misclassified as an
 * ordinary nested object, and `resolveOperationPatch` would reject every
 * one of its own real keys as "not declared in the capability schema".
 * `FIELD_MARKER` uses `Symbol.for(...)` (the global symbol registry)
 * specifically to survive this. Source-level tests (test/core/fields.test.ts,
 * test/runtime/capability.test.ts) can't catch a regression here -- they
 * share one module graph, so a bare `Symbol()` would still work by
 * accident. Only loading the actual built, separately-bundled dist output
 * (like dual-package-hazard.test.ts already does for a different hazard)
 * exercises the real cross-bundle boundary.
 *
 * Requires `npm run build` to have already produced dist/index.js and
 * dist/runtime/index.js -- skips gracefully otherwise, matching the
 * tree-shaking/dual-package-hazard tests' own convention.
 */
import { existsSync } from "node:fs"
import path from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { describe, expect, it } from "vitest"
import type { fields as FieldsNamespace } from "../../src/core/fields.js"
import type { createData as CreateDataFn } from "../../src/runtime/capability.js"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const coreEntry = path.join(root, "dist/index.js")
const runtimeEntry = path.join(root, "dist/runtime/index.js")
const distMissing = !existsSync(coreEntry) || !existsSync(runtimeEntry)

interface CoreModule {
  readonly fields: typeof FieldsNamespace
}

interface RuntimeModule {
  readonly createData: typeof CreateDataFn
}

describe.skipIf(distMissing)("cross-bundle FIELD_MARKER identity", () => {
  it("a nullable/optional marker built via core's own bundle is still recognized by the runtime bundle's ownership resolution", async () => {
    const core = (await import(pathToFileURL(coreEntry).href)) as CoreModule
    const runtime = (await import(pathToFileURL(runtimeEntry).href)) as RuntimeModule

    interface User {
      readonly id: string
      readonly name: string
    }

    const capability = runtime.createData({
      fields: {
        user: core.fields.nullable<User>({ id: "", name: "" }),
      },
      getters: {
        getUser: {
          execute: async (): Promise<User> => ({ id: "1", name: "Ada" }),
          processor: (user: User) => ({ user }),
          writes: { user: true },
        },
      },
    })

    await (capability as { getUser: () => Promise<unknown> }).getUser()

    const snapshot = (
      capability as { getSnapshot: () => { fields: { user: User | null } } }
    ).getSnapshot()

    // If FIELD_MARKER were duplicated across bundles, this getter's own
    // "user" field would have been rejected entirely (see module doc
    // comment) and `user` would still be null.
    expect(snapshot.fields.user).toEqual({ id: "1", name: "Ada" })
  })
})
