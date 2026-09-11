/**
 * The real HTTP surface -- one small router, no framework. Used two ways,
 * from the exact same code: `main-headless.ts` hands it to a plain
 * `node:http` server, and `vite.config.ts`'s own dev-server plugin hands it
 * to Vite's Connect middleware stack (`configureServer`) for `npm run dev`
 * -- both are the same Node `(req, res)` shape, so there is exactly one
 * implementation of "what the backend does," not two that could drift.
 *
 * This is deliberately the layer TanStack Start's own `createServerFn`
 * doesn't cover: server functions are request/response RPC, not long-lived
 * streams, so the SSE endpoint here is a real gap in what the framework
 * provides on its own -- exactly the kind of boundary this example exists
 * to make visible (see README's "Services this example integrates").
 */
import { randomUUID } from "node:crypto"
import type { IncomingMessage, ServerResponse } from "node:http"
import { z } from "zod"
import { createSession, destroySession, getSession, hashPassword } from "./auth.js"
import { UserModel } from "./models.js"
import {
  createInvoice,
  createProject,
  disputeInvoice,
  listInvoicesForProject,
  listProjects,
  login,
  markInvoicePaid,
} from "./functions.js"
import { subscribeToInvoiceEvents } from "./sse.js"
import { createInvoiceSchema, createProjectSchema, loginSchema } from "./validation.js"
import { logger } from "./logger.js"

const SESSION_COOKIE = "ep_session"
const registerSchema = loginSchema.extend({ name: z.string().min(1) })

function readCookie(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=")
    if (key === name) return rest.join("=")
  }
  return undefined
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  for await (const chunk of req as AsyncIterable<Buffer>) chunks.push(chunk)
  const raw = Buffer.concat(chunks).toString("utf8")
  return raw.length === 0 ? {} : (JSON.parse(raw) as unknown)
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body)
  res.writeHead(status, {
    "content-type": "application/json",
    "content-length": Buffer.byteLength(payload),
  })
  res.end(payload)
}

function requireSession(req: IncomingMessage, res: ServerResponse) {
  const session = getSession(readCookie(req, SESSION_COOKIE))
  if (session === undefined) sendJson(res, 401, { error: "unauthenticated" })
  return session
}

function setSessionCookie(res: ServerResponse, token: string): void {
  res.setHeader("set-cookie", `${SESSION_COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict`)
}

/** Handles one request. Returns `true` when it recognized and fully handled the route (including SSE, which never resolves until the client disconnects); `false` for anything it doesn't own, so a caller (Vite's middleware chain) can pass the request on. */
export async function handleRequest(req: IncomingMessage, res: ServerResponse): Promise<boolean> {
  const url = new URL(req.url ?? "/", "http://localhost")
  const { pathname } = url
  const method = req.method ?? "GET"

  try {
    if (method === "POST" && pathname === "/api/register") {
      const parsed = registerSchema.safeParse(await readJsonBody(req))
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid input" })
        return true
      }
      const doc = await UserModel.create({
        _id: randomUUID(),
        email: parsed.data.email,
        name: parsed.data.name,
        passwordHash: hashPassword(parsed.data.password),
        role: "member",
      })
      setSessionCookie(res, createSession({ userId: doc._id, email: doc.email, role: doc.role }))
      sendJson(res, 200, { userId: doc._id, email: doc.email })
      return true
    }

    if (method === "POST" && pathname === "/api/login") {
      const parsed = loginSchema.safeParse(await readJsonBody(req))
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid input" })
        return true
      }
      const session = await login(parsed.data)
      if (session === undefined) {
        sendJson(res, 401, { error: "invalid credentials" })
        return true
      }
      setSessionCookie(res, createSession(session))
      sendJson(res, 200, { email: session.email, role: session.role })
      return true
    }

    if (method === "POST" && pathname === "/api/logout") {
      const token = readCookie(req, SESSION_COOKIE)
      if (token !== undefined) destroySession(token)
      sendJson(res, 200, { ok: true })
      return true
    }

    if (method === "GET" && pathname === "/api/me") {
      const session = requireSession(req, res)
      if (session === undefined) return true
      sendJson(res, 200, { id: session.userId, email: session.email, role: session.role })
      return true
    }

    if (method === "GET" && pathname === "/api/projects") {
      const session = requireSession(req, res)
      if (session === undefined) return true
      sendJson(res, 200, { projects: await listProjects() })
      return true
    }

    if (method === "POST" && pathname === "/api/projects") {
      const session = requireSession(req, res)
      if (session === undefined) return true
      const parsed = createProjectSchema.safeParse(await readJsonBody(req))
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid input" })
        return true
      }
      sendJson(res, 201, await createProject(session, parsed.data))
      return true
    }

    const invoicesMatch = /^\/api\/projects\/([^/]+)\/invoices$/.exec(pathname)
    if (method === "GET" && invoicesMatch) {
      const session = requireSession(req, res)
      if (session === undefined) return true
      const invoices = await listInvoicesForProject(invoicesMatch[1]!)
      sendJson(res, 200, { invoices })
      return true
    }

    if (method === "POST" && invoicesMatch) {
      const session = requireSession(req, res)
      if (session === undefined) return true
      const projectId = invoicesMatch[1]!
      const body = (await readJsonBody(req)) as Record<string, unknown>
      const parsed = createInvoiceSchema.safeParse({ ...body, projectId })
      if (!parsed.success) {
        sendJson(res, 400, { error: "invalid input" })
        return true
      }
      sendJson(res, 201, { invoices: await createInvoice(parsed.data) })
      return true
    }

    const payMatch = /^\/api\/projects\/([^/]+)\/invoices\/([^/]+)\/pay$/.exec(pathname)
    if (method === "POST" && payMatch) {
      const session = requireSession(req, res)
      if (session === undefined) return true
      const invoices = await markInvoicePaid(payMatch[1]!, payMatch[2]!)
      if (invoices === undefined) {
        sendJson(res, 404, { error: "not found" })
        return true
      }
      sendJson(res, 200, { invoices })
      return true
    }

    const disputeMatch = /^\/api\/projects\/([^/]+)\/invoices\/([^/]+)\/dispute$/.exec(pathname)
    if (method === "POST" && disputeMatch) {
      const session = requireSession(req, res)
      if (session === undefined) return true
      const invoices = await disputeInvoice(session, disputeMatch[1]!, disputeMatch[2]!)
      if (invoices === undefined) {
        sendJson(res, 404, { error: "not found" })
        return true
      }
      sendJson(res, 200, { invoices })
      return true
    }

    const streamMatch = /^\/api\/projects\/([^/]+)\/invoices\/stream$/.exec(pathname)
    if (method === "GET" && streamMatch) {
      // Secure by construction: no session, no stream -- see this module's
      // own header comment and sse.ts's.
      const session = requireSession(req, res)
      if (session === undefined) return true
      const projectId = streamMatch[1]!
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      })
      res.write(": connected\n\n")
      const unsubscribe = subscribeToInvoiceEvents(projectId, res)
      req.on("close", unsubscribe)
      return true
    }

    return false
  } catch (error) {
    logger.error({ event: "http.error", pathname, err: error }, "Request handler threw")
    if (!res.headersSent) sendJson(res, 500, { error: "internal error" })
    return true
  }
}
