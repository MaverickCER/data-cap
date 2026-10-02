// data-cap runtime benchmark suite. Documentation conventions: see
// node_modules/internal-package-contract/template/benchmarks/WRITING-BENCHMARKS.md (scaffolded into
// ../WRITING-BENCHMARKS.md and ../READING-BENCHMARKS.md). `defineSuite` refuses undocumented entries.
//
// Imports data-cap by its PACKAGE NAME (resolved through this directory's own node_modules after a
// real `npm install`), never a monorepo-relative path: the published `exports` map is part of what a
// consumer pays for.

import { execFileSync } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { defineSuite, timed } from "internal-package-contract/benchmark"
import { buildData } from "data-cap"
import { createCoordinator, createData, createDataStore } from "data-cap/runtime"
import { createDataCache } from "data-cap/runtime/cache"
import { withRetry } from "data-cap/runtime/retry"
import { canonicalize, identity } from "data-cap/helpers"
import {
  capabilitySchemaFields,
  generateRecords,
  generateRuntimeCapabilityFixtures,
  realisticParams,
} from "../benchmark-fixtures/generator.mjs"

const here = path.dirname(fileURLToPath(import.meta.url))
const coldStartChild = path.join(here, "scripts", "cold-start-child.mjs")
const fixturesRoot = path.join(here, "fixtures", "generated")

/**
 * Stands in for a getter's real `execute` (a fetch, a database query) without touching the network or
 * disk and without skipping data-cap's real dispatch logic. Alternates between two pre-generated
 * payloads so consecutive commits always differ (an identical reference would be a free no-op).
 */
function simulatedSource(n) {
  const payloads = [{ items: generateRecords(n) }, { items: generateRecords(n) }]
  let call = 0
  return () => Promise.resolve(payloads[call++ % 2])
}

/** A capability whose single getter reads from `simulatedSource`. */
function capabilityOver(execute, coordinator = createCoordinator()) {
  return createData(
    {
      fields: capabilitySchemaFields(0),
      getters: { listItems: { params: { page: 0 }, execute, writes: { items: true } } },
    },
    { coordinator },
  )
}

const ITEMS = {
  name: "records per fetch",
  how: "swept",
  description: "The tier axis: how many records one getter call fetches and commits.",
}
const RECORD_SHAPE = {
  name: "record shape",
  how: "fixed",
  value: "7-field task record (strings, dates, a tag array)",
  description:
    "Records come from the deterministic generator in benchmark-fixtures/generator.mjs; wider or deeper records would raise the per-record cost.",
}
const RUNTIME = {
  name: "runtime",
  how: "fixed",
  value: "Node (V8)",
  description: "Measured on Node only. Bun, Deno, browsers and edge runtimes are not covered.",
}

export default defineSuite({
  package: {
    name: "data-cap",
    bundleFiles: ["dist/index.js", "dist/runtime/index.js", "dist/helpers.js"],
  },

  workload: {
    unit: "record",
    description:
      "One record in the collection a getter fetches and commits (a CRM contact, an order, a support ticket). 640 is a typical full page of a mid-sized table or a busy list endpoint.",
    typicalN: 640,
  },

  endToEnd: {
    purpose:
      "Shows what an application pays per data fetch just for putting data-cap between its data source and its UI, compared with handling the same payload by hand. Both sides get the same pre-fetched records from a simulated instant source and both end with the records available to a reader; the only difference is data-cap's dispatch, deduplication, ownership checking, immutability and state bookkeeping. This is the floor: a real getter adds its own network or database time on top, which dwarfs this overhead in production but cannot be avoided by anything the application does.",
    baseline: {
      description:
        "An async function returns n pre-generated records and the caller stores them in a plain object -- no data-cap.",
      setup: (n) => {
        const payloads = [generateRecords(n), generateRecords(n)]
        return { payloads, state: { items: [] }, call: 0 }
      },
      run: async (ctx) => {
        const items = await Promise.resolve(ctx.payloads[ctx.call++ % 2])
        ctx.state = { ...ctx.state, items }
        return ctx.state.items.length
      },
    },
    withPackage: {
      description:
        "The same n records arrive through a data-cap getter (`createData`) and the caller reads the resulting snapshot: coordinator dedup registry, simulated async execute, ownership-checked commit, structural sharing and deep freeze of the new nodes.",
      fresh: true,
      setup: (n) => ({ capability: capabilityOver(simulatedSource(n)), call: 0 }),
      run: async (ctx) => {
        await ctx.capability.listItems({ page: ctx.call++ })
        return ctx.capability.getSnapshot().fields.items.length
      },
    },
    variables: [
      ITEMS,
      RECORD_SHAPE,
      RUNTIME,
      {
        name: "data source latency",
        how: "fixed",
        value: "0 ms (simulated, instant)",
        description:
          "A real network or database call is far slower than anything measured here; it is excluded on purpose so the report shows data-cap's cost, not the network's.",
      },
      {
        name: "concurrent identical calls",
        how: "fixed",
        value: 1,
        description:
          "One caller. Concurrency is measured separately in the dedupe-fan-in functions below.",
      },
    ],
  },

  functions: [
    {
      id: "cold-start",
      name: "createData (cold start)",
      why: "Every process that imports capability modules pays this before serving its first request: a deploy, a serverless cold start, a CLI invocation or a test run. It is the cost of adopting data-cap at the moment it hurts most, and it recurs on every scale-up.",
      poorPerformanceMeans:
        "Slower deploys, longer first-request latency on every new instance, and (on serverless platforms) a cold-start penalty billed on every scale-from-zero event. A quadratic regression would make large applications visibly slow to boot.",
      expectedComplexity: "linear",
      complexityReason:
        "Each capability module evaluates one `createData` call, which builds its schema, registers its operations and allocates its store independently of every other capability, so total boot time is the process start-up floor plus a constant amount of work per capability.",
      variables: [
        { name: "capabilities imported", how: "swept", description: "The tier axis: how many `createData`-declaring modules the process imports." },
        { name: "process start-up floor", how: "fixed", value: "one fresh Node process per sample", description: "Every sample spawns a new process, so Node's own start-up time is included and sets the flat floor of the curve." },
        { name: "processor/validator cost", how: "fixed", value: "identity processors, no validators", description: "Application-supplied processors belong to the application; the fixtures use trivial ones so a regression here is data-cap's." },
        RUNTIME,
      ],
      notCovered: [
        { name: "warm module cache", reason: "A cold process is the point of this benchmark; a warm cache cannot exist in a fresh process." },
        { name: "bundled vs unbundled loading", reason: "Measured unbundled through Node's native ESM loader; bundlers change module-evaluation cost and are application-specific." },
      ],
      fresh: false,
      sampling: { warmupIterations: 0, minIterations: 3, maxIterations: 7, targetDurationMs: 1500 },
      setup: async (n) => {
        const outputDir = path.join(fixturesRoot, "cold-start", `n${String(n)}`)
        const generated = await generateRuntimeCapabilityFixtures({ tierName: `n${String(n)}`, count: n, outputDir })
        return generated.indexPath
      },
      run: (indexPath) => {
        const start = performance.now()
        execFileSync(process.execPath, ["--expose-gc", coldStartChild, indexPath], { encoding: "utf8", cwd: here })
        return timed(performance.now() - start)
      },
    },
    {
      id: "build-data",
      name: "buildData",
      why: "Builds the initial immutable state from a schema; every capability and every store creation calls it, so it sits inside cold start and inside every test that creates a store.",
      poorPerformanceMeans:
        "Slower boot and slower tests; for an application that creates stores per request or per component, the cost lands on the hot path.",
      expectedComplexity: "linear",
      complexityReason:
        "It walks the schema's initial field values once to freeze and index them, so its cost follows the number of initial records.",
      variables: [
        { name: "initial records", how: "swept", description: "How many records the schema's collection field starts with." },
        RECORD_SHAPE,
        { name: "field count", how: "fixed", value: 7, description: "A typical table-view capability declares around seven fields; more fields add proportionally." },
      ],
      notCovered: [{ name: "schemas with validators", reason: "Validators are application code; their cost belongs to the application." }],
      setup: (n) => capabilitySchemaFields(n),
      run: (fields) => buildData({ fields }),
    },
    {
      id: "commit-authoritative-array-replace",
      name: "commitAuthoritative (replace a whole array)",
      why: "Every successful getter ends here: the fetched collection is committed into state. It runs once per fetch for every capability in the application, so it is the dominant steady-state cost of reading data.",
      poorPerformanceMeans:
        "Every fetch gets slower in proportion to its size; at thousands of records a regression turns a page load into a visible stall and raises server CPU per request. A quadratic bug would make large lists unusable.",
      expectedComplexity: "linear",
      complexityReason:
        "Committing a new array replaces the field and deep-freezes every newly arrived record exactly once (`deepFreezeNewNodes`), so the work is proportional to the number of new records.",
      variables: [
        ITEMS,
        RECORD_SHAPE,
        { name: "existing state size", how: "fixed", value: "empty collection", description: "The store starts with an empty collection, so no reconciliation against old records is included; that is measured in reconcile-array-info." },
        { name: "reference reuse", how: "fixed", value: "always new references", description: "Each sample commits freshly built records; committing the same reference again is a free no-op by design and is not what this measures." },
      ],
      notCovered: [{ name: "commits that fail ownership checks", reason: "A rejected commit stops early and is not a steady-state cost." }],
      inEndToEnd: { callsPerOperation: 1, description: "One commit per fetch." },
      fresh: true,
      setup: (n) => ({
        store: createDataStore(buildData({ fields: capabilitySchemaFields(0) })),
        patch: { items: generateRecords(n) },
      }),
      run: ({ store, patch }) => store.commitAuthoritative(patch, { items: { status: "success" } }),
    },
    {
      id: "commit-authoritative-leaf",
      name: "commitAuthoritative (change one small field)",
      why: "Most state changes are tiny (a filter, a selection, a timestamp) but happen while a large collection sits in the same store. This proves the central design promise, structural sharing: a small change must not pay for the large data next to it.",
      poorPerformanceMeans:
        "If the cost grew with the collection, every keystroke or click would re-copy thousands of records, and the application would get slower as its data grew -- the exact failure structural sharing exists to prevent.",
      expectedComplexity: "constant",
      complexityReason:
        "A leaf commit rebuilds only the path from the root to the changed field and reuses every other branch by reference, so the work does not depend on how many records the store holds.",
      variables: [
        { name: "records held in the store", how: "swept", description: "The tier axis: how large the unrelated collection in the same store is." },
        RECORD_SHAPE,
        { name: "size of the change", how: "fixed", value: "one string field", description: "A single small leaf; larger patches cost proportionally more and are covered by the array-replace benchmark." },
      ],
      notCovered: [{ name: "deeply nested change paths", reason: "Path length adds a small constant per level; the store's fields are shallow by design." }],
      setup: (n) => ({ store: createDataStore(buildData({ fields: capabilitySchemaFields(n) })), call: 0 }),
      run: (ctx) => ctx.store.commitAuthoritative({ meta: { lastSyncedBy: `user-${String(ctx.call++)}` } }, undefined),
    },
    {
      id: "reconcile-array-info",
      name: "reconcileArrayInfo",
      why: "Builds the identity-keyed bookkeeping that lets lists update in place instead of being replaced; it runs on every collection commit that carries an identity key.",
      poorPerformanceMeans:
        "Collection commits slow down in proportion to their size, adding directly to every list fetch; a quadratic regression would appear first on large tables.",
      expectedComplexity: "linear",
      complexityReason:
        "It visits each incoming record once to compute its identity key and look it up in a hash map of known records, so the work is proportional to the number of records.",
      variables: [
        ITEMS,
        RECORD_SHAPE,
        { name: "key composition", how: "fixed", value: "single `id` field", description: "Composite keys add a small constant per record." },
        { name: "previous state", how: "fixed", value: "none (first load)", description: "Reconciling against a large previous collection would add map lookups; the first-load case is the worst case for allocation." },
      ],
      inEndToEnd: { callsPerOperation: 1, description: "Once per collection commit." },
      setup: (n) => generateRecords(n),
      run: (records) => identity.reconcileArrayInfo(undefined, records, ["id"], "all", () => ({ fetchedAt: 0 })),
    },
    {
      id: "getter-dispatch-cold",
      name: "getter dispatch (one full round trip)",
      why: "This is what an application actually calls: one getter through `createData` -- dedup registry, async execute, ownership-checked commit and the loading-then-success state transitions. It is the best single number for 'what does one fetch cost through data-cap'.",
      poorPerformanceMeans:
        "Every read in the application is slower and burns more CPU, and the cost scales with traffic and with payload size.",
      expectedComplexity: "linear",
      complexityReason:
        "Dispatch bookkeeping is constant per call, and the commit that follows touches every new record once, so the total is a small constant plus a term proportional to the records returned.",
      variables: [
        ITEMS,
        RECORD_SHAPE,
        { name: "cache state", how: "fixed", value: "cold (fresh capability each sample)", description: "Each sample uses a brand-new capability, so no previous result or in-flight request is reused." },
        { name: "data source latency", how: "fixed", value: "0 ms (simulated)", description: "Excluded on purpose; see the end-to-end section." },
      ],
      inEndToEnd: { callsPerOperation: 1, description: "This is the end-to-end operation itself." },
      fresh: true,
      setup: (n) => ({ capability: capabilityOver(simulatedSource(n)) }),
      run: ({ capability }) => capability.listItems({ page: 0 }),
    },
    {
      id: "canonicalize",
      name: "canonicalize (request key)",
      why: "Turns a request's parameters into the string the coordinator uses to recognise identical in-flight requests. It runs on every getter and mutator call, so it sits on the hot path of everything the application does.",
      poorPerformanceMeans:
        "Every call pays a surcharge proportional to how complex its parameters are; large filter objects would make deduplication more expensive than the requests it saves.",
      expectedComplexity: "linearithmic",
      complexityReason:
        "It walks every key of the parameters object (linear) and sorts the keys of each object so equal objects produce equal strings (n log n), so the sort dominates as objects grow.",
      variables: [
        { name: "keys in the parameters object", how: "swept", description: "The tier axis: how many keys the parameter object has." },
        { name: "value types", how: "fixed", value: "short strings and numbers", description: "Dates, URLs, nested objects and arrays add proportional work per node and are not swept." },
        { name: "typical real parameters", how: "fixed", value: "3-6 keys in real use", description: "Real calls pass 3-6 keys; the ladder deliberately goes far beyond that to expose the growth rate." },
      ],
      notCovered: [{ name: "deeply nested parameters", reason: "Nesting is bounded by a hard depth limit and is not representative of real request parameters." }],
      setup: (n) => Object.fromEntries(Array.from({ length: n }, (_, i) => [`key${String(i).padStart(5, "0")}`, i % 2 === 0 ? `value-${String(i)}` : i])),
      run: (params) => canonicalize(params),
    },
    {
      id: "dedupe-fan-in",
      name: "coordinator dedup (identical concurrent calls)",
      why: "When many components ask for the same data at once, the coordinator should run the request once and share the result. This benchmark proves the saving is real and shows what the sharing itself costs.",
      poorPerformanceMeans:
        "Without effective deduplication every concurrent caller hits the data source, multiplying load and cost on the backend; if the sharing itself were slow, dedup would cost more than it saves.",
      expectedComplexity: "linear",
      complexityReason:
        "Each of the n callers registers on the shared in-flight request and receives the one result, so the work is proportional to the number of callers while the underlying fetch runs only once.",
      variables: [
        { name: "concurrent identical callers", how: "swept", description: "The tier axis: how many callers ask for the same data at the same moment." },
        { name: "payload size", how: "fixed", value: "200 records", description: "Held constant so only the caller count varies; payload scaling is measured in getter-dispatch-cold." },
        { name: "request identity", how: "variant", description: "Identical requests (shared) versus independent requests (not shared), measured as the two variants below." },
      ],
      variants: [
        { name: "identical", description: "Every caller asks for the same page; the coordinator runs one fetch and shares it." },
        { name: "independent", description: "Every caller asks for a different page; nothing can be shared, so this is the no-dedup comparison." },
      ],
      fresh: true,
      setup: (n, options) => {
        const execute = simulatedSource(200)
        let executed = 0
        const counted = () => {
          executed += 1
          return execute()
        }
        return { capability: capabilityOver(counted), n, independent: options?.independent === true, executed: () => executed }
      },
      run: async (ctx) => {
        await Promise.all(Array.from({ length: ctx.n }, (_, i) => ctx.capability.listItems({ page: ctx.independent ? i : 0 })))
        if (!ctx.independent && ctx.executed() !== 1) throw new Error(`dedupe regressed: ${String(ctx.executed())} fetches for ${String(ctx.n)} identical calls`)
        return ctx.executed()
      },
    },
    {
      id: "run-getters-fan-out",
      name: "runGetters (one call, many getters)",
      why: "Screens usually need several datasets at once; `runGetters` starts them together. Its overhead is paid on every screen load.",
      poorPerformanceMeans:
        "Screen-load latency grows with the number of datasets a screen needs, and a super-linear regression would punish exactly the most data-rich screens.",
      expectedComplexity: "quadratic",
      complexityReason:
        "Dispatching and aggregating are linear in the getters, but each getter commits to its own field and every commit rebuilds the root fields object, whose size is the number of fields (confirmed separately: one commit costs roughly 0.1 ms at 500 fields and 1.3 ms at 8,000). Here every getter owns one field, so n getters make n commits of O(n) each. A real capability has a handful of fields, where this is effectively linear; the quadratic term only appears when fields and getters grow together, which is why it is measured this way.",
      variables: [
        { name: "getters per call", how: "swept", description: "The tier axis: how many getters one `runGetters` call starts." },
        { name: "fields per capability", how: "swept", description: "Swept together with getters on purpose (one field per getter): the cost of each commit depends on the field count, so the two cannot be separated in this benchmark." },
        { name: "payload per getter", how: "fixed", value: "20 records", description: "Small and constant so the getter count, not payload size, drives the result." },
        { name: "getter independence", how: "fixed", value: "all independent, all succeed", description: "A failing getter takes the error path, which is cheaper and not representative." },
      ],
      fresh: true,
      setup: (n) => {
        const getters = {}
        const fields = {}
        for (let g = 0; g < n; g += 1) {
          const field = `section${String(g)}`
          fields[field] = []
          const payload = { [field]: generateRecords(20) }
          getters[`get${String(g)}`] = { params: {}, execute: () => Promise.resolve(payload), writes: { [field]: true } }
        }
        return { capability: createData({ fields, getters }, { coordinator: createCoordinator() }), calls: Object.fromEntries(Object.keys(getters).map((name) => [name, {}])) }
      },
      run: ({ capability, calls }) => capability.runGetters(calls),
    },
    {
      id: "data-cache-set-get",
      name: "createDataCache (set then get)",
      why: "The optional snapshot cache lets a screen restore instantly. It must never become a hidden per-item cost: it should hold snapshots by reference.",
      poorPerformanceMeans:
        "If the cache copied snapshots, every cache write would cost as much as re-fetching, and memory would multiply with the number of cached screens.",
      expectedComplexity: "constant",
      complexityReason:
        "Entries are stored by reference in a bounded map with least-recently-used eviction, so set, get and eviction are constant-time regardless of how many records a snapshot contains.",
      variables: [
        { name: "records inside the cached snapshot", how: "swept", description: "The tier axis: the size of the snapshot being cached." },
        { name: "cache fullness", how: "fixed", value: "full (50 entries), every set evicts", description: "The worst case: each set evicts the oldest entry." },
        { name: "hit versus miss", how: "fixed", value: "hit", description: "The get immediately follows the set, so it is always a hit; a miss is cheaper." },
      ],
      fresh: true,
      setup: (n) => {
        const cache = createDataCache({ maxEntries: 50 })
        const snapshot = () => {
          const store = createDataStore(buildData({ fields: capabilitySchemaFields(0) }))
          store.commitAuthoritative({ items: generateRecords(n) }, { items: { status: "success" } })
          return store.getSnapshot()
        }
        for (let p = 0; p < 50; p += 1) cache.set(`prefill-${String(p)}`, snapshot())
        return { cache, next: snapshot() }
      },
      run: ({ cache, next }) => {
        cache.set("entry", next)
        return cache.get("entry")
      },
    },
    {
      id: "with-retry",
      name: "withRetry",
      why: "Opt-in retry wrapper used around flaky data sources. Its loop, timers and abort handling run only on failure, exactly when the system is already struggling, so its overhead must be small and predictable.",
      poorPerformanceMeans:
        "Retry storms amplify an outage: if each retry is expensive, a struggling dependency makes the retrying service slower and more resource-hungry still.",
      expectedComplexity: "linear",
      complexityReason:
        "Each failed attempt goes once around the loop (error handling, backoff computation, a timer and microtask hand-off), so total cost is proportional to the number of attempts.",
      variables: [
        { name: "attempts before success", how: "swept", description: "The tier axis: how many calls fail before one succeeds." },
        { name: "backoff delay", how: "fixed", value: "0 ms", description: "Real backoff waits seconds and would measure the timer, not the loop; the real control flow still runs." },
        { name: "abort signal", how: "fixed", value: "never aborted", description: "The abort path exits early and is cheaper." },
      ],
      notCovered: [{ name: "real backoff delays", reason: "Waiting is not CPU or memory cost; it is latency the caller chose." }],
      tiers: [10, 20, 40, 80],
      tiersReason:
        "withRetry refuses more than 100 attempts (a built-in loop guard that fails fast on a broken exit condition), so the ladder stops at 80; real retry policies use 3-10 attempts, so this still covers well beyond real use.",
      setup: (n) => ({ n, signal: new AbortController().signal }),
      run: async ({ n, signal }) => {
        let call = 0
        return withRetry(
          async () => {
            call += 1
            if (call < n) throw new Error("simulated transient failure")
            return call
          },
          signal,
          { maxAttempts: n, delayMs: () => 0 },
        )
      },
    },
  ],
})
