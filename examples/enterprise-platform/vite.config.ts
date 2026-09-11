/**
 * `npm run dev`'s own config -- not exercised by `npm start` (headless, no
 * Vite at all). The `enterprise-platform-api` plugin registers the exact
 * same `handleRequest` function `main-headless.ts` hands to a plain
 * `node:http` server, as Vite's own dev-server middleware -- one real
 * implementation of "what the backend does," reused, not a second one
 * written for interactive use (see `src/server/http-handler.ts`'s own
 * header comment).
 */
import { defineConfig } from "vite"
import viteReact from "@vitejs/plugin-react"
import { tanstackStart } from "@tanstack/react-start/plugin/vite"
import type { IncomingMessage, ServerResponse } from "node:http"
import { MongoMemoryServer } from "mongodb-memory-server"
import { connectDb } from "./src/server/db.js"
import { handleRequest } from "./src/server/http-handler.js"

function enterprisePlatformApiPlugin() {
  return {
    name: "enterprise-platform-api",
    async configureServer(server: { middlewares: { use: (fn: (req: IncomingMessage, res: ServerResponse, next: () => void) => void) => void } }) {
      // `npm run dev` gets its own embedded MongoDB too -- no separate
      // "set up a real database first" step for interactive use either.
      const mongod = await MongoMemoryServer.create()
      await connectDb(mongod.getUri())

      server.middlewares.use((req, res, next) => {
        void handleRequest(req, res).then((handled) => {
          if (!handled) next()
        })
      })
    },
  }
}

export default defineConfig({
  plugins: [enterprisePlatformApiPlugin(), tanstackStart(), viteReact()],
})
