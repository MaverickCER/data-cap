/**
 * Two real mistakes the rule catches -- see good-usage.ts for why this uses
 * a local stub `createData`, not the real one imported from
 * `data-cap/runtime`.
 */
function createData(config: unknown): unknown {
  return config
}

// Mistake 1: an inline arrow function -- a fresh identity every time this
// module's top-level code runs (which, for a real module, is only once --
// but the mistake generalizes to any factory that runs more than once).
export const orderCapability = createData({
  fields: { total: 0 },
  getters: {
    getOrder: { execute: () => Promise.resolve({ total: 0 }) },
  },
})

// Mistake 2: a reference that LOOKS stable (an identifier, not an inline
// literal) but is declared INSIDE a function -- a fresh identity every time
// that function runs.
export function makeInventoryCapability(): unknown {
  const getInventory = (): Promise<{ count: number }> => Promise.resolve({ count: 0 })
  return createData({
    fields: { count: 0 },
    getters: {
      getInventory: { execute: getInventory },
    },
  })
}
