import { createRouter as createTanStackRouter } from "@tanstack/react-router"
import { routeTree } from "./routes.js"

// `@tanstack/react-start`'s own client hydration entry (`hydrateStart.js`)
// imports `getRouter` by that exact name from this file -- not `createRouter`,
// despite most of TanStack Router's own docs using that name for the local
// function. See this package's own bundled skill doc
// (`node_modules/@tanstack/react-start/skills/react-start/SKILL.md`).
export function getRouter(): ReturnType<typeof createTanStackRouter> {
  return createTanStackRouter({ routeTree })
}

declare module "@tanstack/react-router" {
  interface Register {
    router: ReturnType<typeof getRouter>
  }
}
