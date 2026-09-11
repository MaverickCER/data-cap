/**
 * The rule matches a `createData()` call's `execute`/`subscribe` keys
 * purely by call/property name (see the rule's own doc comment) --
 * independent of the actual `createData` runtime API (`@maverickcer/
 * data-cap/runtime`), which does implement this shape. This fixture uses a
 * local stub matching the shape the rule inspects, exactly like the rule's
 * own real test suite does, so this example stays a pure lint-behavior
 * check rather than also depending on runtime execution (network calls,
 * timers) that would be irrelevant to what's being demonstrated here.
 */
function createData(config: unknown): unknown {
  return config
}

function getUser(): Promise<{ name: string }> {
  return Promise.resolve({ name: "Ada Lovelace" })
}

function subscribeToPriceFeed(): () => void {
  return () => undefined
}

export const userCapability = createData({
  fields: { name: "" },
  getters: {
    getUser: { execute: getUser },
  },
  subscriptions: {
    priceFeed: { subscribe: subscribeToPriceFeed },
  },
})
