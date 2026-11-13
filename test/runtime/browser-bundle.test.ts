import { existsSync, readFileSync } from "node:fs"
import path from "node:path"
import { fileURLToPath } from "node:url"
import vm from "node:vm"
import { buildSync } from "esbuild"
import { describe, expect, it } from "vitest"

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")
const manifest = JSON.parse(readFileSync(path.join(root, "package.json")).toString()) as {
  exports: Record<string, { import: { default: string } }>
}

// The entry points "data-cap" says run in a browser or an edge runtime: each must bundle for the browser
// platform with nothing from Node, or the claim is false for the first person who tries it.
const ISOMORPHIC = [
  ".",
  "./runtime",
  "./runtime/cache",
  "./runtime/retry",
  "./helpers",
  "./evidence",
  "./observe",
]
const built = existsSync(path.join(root, "dist"))

describe.skipIf(!built)(
  "the isomorphic entry points, bundled for a browser (requires `npm run build`)",
  () => {
    it.each(ISOMORPHIC)(
      "%s bundles for the browser without Node's modules or globals",
      (subpath) => {
        const entry = manifest.exports[subpath]?.import.default
        if (entry === undefined) throw new Error(`package.json has no import entry for ${subpath}`)
        const result = buildSync({
          entryPoints: [path.join(root, entry)],
          bundle: true,
          platform: "browser",
          format: "esm",
          write: false,
          logLevel: "silent",
        })
        const code = result.outputFiles[0]?.text ?? ""
        expect(code.length).toBeGreaterThan(0)
        expect(code).not.toMatch(/node:|require\("(?:fs|path|os|child_process)"\)/)
        expect(code).not.toMatch(/\bprocess\.|\bBuffer\./)
      },
    )

    /**
     * Bundling proves what the code imports; running it proves what it reaches at run time. Each
     * client bundle is executed inside a V8 context that has only the Web globals an edge runtime
     * guarantees (no `process`, `Buffer`, `require`, timers), as an IIFE whose exports are read back,
     * and one real entry point of each is called.
     */
    const WEB_GLOBALS = () => ({
      console,
      TextEncoder,
      TextDecoder,
      URL,
      URLSearchParams,
      atob,
      btoa,
      structuredClone,
      Date,
      Math,
      JSON,
      Promise,
      Error,
      TypeError,
      RangeError,
      Object,
      Array,
      Map,
      Set,
      Symbol,
      Reflect,
      Proxy,
      WeakMap,
      WeakSet,
      WeakRef,
      Number,
      String,
      Boolean,
      RegExp,
      BigInt,
      queueMicrotask,
      AbortController,
      AbortSignal,
    })

    function runInWebContext(subpath: string): Record<string, unknown> {
      const entry = manifest.exports[subpath]?.import.default
      if (entry === undefined) throw new Error(`package.json has no import entry for ${subpath}`)
      const result = buildSync({
        entryPoints: [path.join(root, entry)],
        bundle: true,
        platform: "browser",
        format: "iife",
        globalName: "__entry",
        write: false,
        logLevel: "silent",
      })
      const code = result.outputFiles[0]?.text ?? ""
      const context = vm.createContext(WEB_GLOBALS())
      vm.runInContext(code, context, { filename: `${subpath}.iife.js` })
      return vm.runInContext("__entry", context) as Record<string, unknown>
    }

    type Fn = (...args: never[]) => unknown

    it(". and ./runtime run under Web globals only: a capability is created and a store commits", () => {
      const core = runInWebContext(".") as { fields: Fn }
      expect(typeof core.fields).toBe("function")
      const runtime = runInWebContext("./runtime") as {
        createData: (definition: unknown) => {
          getSnapshot: () => { fields: Record<string, unknown> }
        }
        createDataStore: (initialState: unknown) => {
          getSnapshot: () => { fields: Record<string, unknown>; info: unknown }
          commitAuthoritative: (fields: Record<string, unknown>, meta: unknown) => void
        }
      }
      const capability = runtime.createData({ fields: { name: "anon" } })
      expect(capability.getSnapshot().fields["name"]).toBe("anon")
      // The store takes a DataState (fields plus info), which the capability's snapshot is.
      const store = runtime.createDataStore(capability.getSnapshot())
      store.commitAuthoritative({ name: "changed" }, undefined)
      expect(store.getSnapshot().fields["name"]).toBe("changed")
      expect(store.getSnapshot().info).toBeDefined()
    })

    it("./runtime/cache and ./runtime/retry run under Web globals only", () => {
      const cache = runInWebContext("./runtime/cache") as {
        createDataCache: (options: { maxEntries: number }) => {
          set: (key: string, state: unknown) => void
          get: (key: string) => unknown
          size: number
        }
      }
      const lru = cache.createDataCache({ maxEntries: 1 })
      lru.set("a", { fields: { n: 1 }, info: {} })
      lru.set("b", { fields: { n: 2 }, info: { n: { status: "ready" } } })
      expect(lru.size).toBe(1)
      expect(lru.get("b")).toEqual({ fields: { n: 2 }, info: { n: { status: "ready" } } })
      const retry = runInWebContext("./runtime/retry") as {
        defaultBackoff: (attempt: number) => number
      }
      expect(retry.defaultBackoff(1)).toBeGreaterThan(0)
    })

    it("./helpers, ./evidence and ./observe run under Web globals only", () => {
      const helpers = runInWebContext("./helpers") as {
        processors: Record<string, Fn>
        canonicalize: (value: unknown) => string
      }
      expect((helpers.processors["toInteger"] as (v: unknown) => unknown)("42")).toBe(42)
      expect(helpers.canonicalize({ b: 1, a: 2 })).toBe(helpers.canonicalize({ a: 2, b: 1 }))
      const evidence = runInWebContext("./evidence") as {
        flowNodeId: (kind: string, scope: string, name: string) => string
      }
      expect(evidence.flowNodeId("field", "users", "email")).toBe(
        evidence.flowNodeId("field", "users", "email"),
      )
      const observe = runInWebContext("./observe") as {
        createMemorySink: () => { sink: unknown; events: () => { field: string }[] }
        observeBoundary: (sink: unknown, input: unknown) => number
      }
      const memory = observe.createMemorySink()
      const recorded = observe.observeBoundary(memory.sink, {
        scope: "svc",
        capability: "user",
        boundary: { kind: "http", name: "GET /me" },
        fields: [["email"]],
        clock: () => 1,
      })
      expect(recorded).toBe(1)
      expect(memory.events().map((e) => e.field)).toEqual(["user.email"])
    })
  },
)
