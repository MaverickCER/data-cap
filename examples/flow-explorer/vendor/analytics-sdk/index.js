/** Records the event. A real SDK would send it to a vendor; this one keeps it in memory so the example stays offline. */
export const sent = []

export function track(event, properties) {
  sent.push({ event, properties })
}
