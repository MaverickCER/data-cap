/**
 * Routes composed programmatically (`createRoute`/`addChildren`), not via
 * TanStack Router's file-based-routing convention -- deliberately, so
 * `npm run typecheck` (`tsc --noEmit`, run directly in CI, never through
 * Vite first) never depends on a `routeTree.gen.ts` file that only exists
 * after `vite dev`/`vite build` has actually run once. Programmatic
 * composition is a fully supported, first-class TanStack Router API, not a
 * workaround -- file-based routing is a convenience layer generating this
 * exact same structure.
 */
import { Outlet, createRootRoute, createRoute } from "@tanstack/react-router"
import { useState } from "react"
import { BillingPanel } from "./components/BillingPanel.js"
import { Login } from "./components/Login.js"
import { ProjectsPanel } from "./components/ProjectsPanel.js"
import { identityData } from "./capabilities/identity.capability.js"
import { useCapability } from "./hooks/useCapability.js"

function RootLayout(): React.JSX.Element {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <title>Atlas -- enterprise-platform</title>
      </head>
      <body>
        <Outlet />
      </body>
    </html>
  )
}

function HomePage(): React.JSX.Element {
  const identity = useCapability(identityData)
  const [openProjectId, setOpenProjectId] = useState<string | undefined>(undefined)

  if (identity.fields.currentUser === null) return <Login />

  return (
    <main>
      <p>
        Signed in as {identity.fields.currentUser.email} ({identity.fields.currentUser.role})
      </p>
      <ProjectsPanel onOpenProject={setOpenProjectId} />
      {openProjectId !== undefined && <BillingPanel projectId={openProjectId} />}
    </main>
  )
}

export const rootRoute = createRootRoute({ component: RootLayout })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  component: HomePage,
})

export const routeTree = rootRoute.addChildren([indexRoute])
