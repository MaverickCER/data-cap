// Runs inside a fresh child process, spawned once per cold-start sample by
// ../scripts/run-benchmark.mjs. Everything from process start to this
// script's own top-level import is the process-boot floor the parent
// attributes separately (see ../../README.md); everything measured below is
// the fixture barrel's own module-evaluation cost -- which, per
// capability-<n>.mjs's own top-level `createData(...)` call, IS
// `createData`'s cost times however many capabilities this tier declares.
//
// Unlike env-cap's createEnv()/validateEnv() split, data-cap's
// buildData()/createData() have no throw-until-ready gate (a deliberate
// architectural divergence -- see specs/architecture.md): there is no
// separate "validate" phase to time after import, so this script reports
// one phase, not two.

import { pathToFileURL } from "node:url"
import { snapshotMemory } from "../../benchmark-fixtures/measure.mjs"

const [, , indexPath] = process.argv

const memoryBeforeBytes = snapshotMemory()
const t0 = performance.now()
const mod = await import(pathToFileURL(indexPath).href)
const t1 = performance.now()
const memoryAfterBytes = snapshotMemory()

const capabilities = Object.values(mod)
// Touches one capability's snapshot -- cheap, real work (not optimized away
// by an unused import), matching the minimal "is this actually usable"
// check a real app's own module-eval-time cold start would also pay.
capabilities[0]?.getSnapshot()

process.stdout.write(
  JSON.stringify({
    moduleEvalMs: t1 - t0,
    capabilityCount: capabilities.length,
    memoryBeforeBytes,
    memoryAfterBytes,
  }),
)
