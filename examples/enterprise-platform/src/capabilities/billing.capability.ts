/**
 * One project's own invoices -- owned by finance-team. The capability this
 * whole tier's litigation-evidence report is scoped to: `disputeInvoice`
 * marks a real invoice disputed, the exact concrete scenario
 * `reports/litigation-evidence.ts` proves "what billing data existed and
 * how it was handled" for.
 *
 * `evidence.fields.invoices.dynamicAccess` (below) cites
 * `server/legacy-compliance-sync.ts:26:19` -- a pre-existing utility that
 * reads `invoices` via a runtime-computed field name, exactly the kind of
 * access `src/build/dependency-graph.ts` can prove happens but can't
 * statically attribute to one field (ADR 0052/0053). The audit-prep report
 * treats this citation as evidence that even a legacy, hard-to-analyze
 * access path is accounted for, not evidence that data-cap independently
 * verified what the utility does with the value.
 */
import { documentData, fields } from "@maverickcer/data-cap"
import { createData } from "@maverickcer/data-cap/runtime"
import { apiFetch, apiUrl, currentSessionCookie } from "./api-client.js"

export interface Invoice {
  readonly id: string
  readonly projectId: string
  readonly clientName: string
  readonly amountCents: number
  readonly status: "draft" | "sent" | "paid" | "disputed"
  readonly createdAt: string
}

type SubscriptionStatus = "connecting" | "connected" | "disconnected"
interface InvoiceSseHandlers {
  onEvent(event: { invoices: readonly Invoice[] }): void
  onStatusChange(status: SubscriptionStatus): void
}

/**
 * Real SSE over `fetch`'s own streaming response body, not the browser's
 * native `EventSource` -- deliberately, so the exact same code subscribes
 * for real from both the browser (`npm run dev`) and this capability's
 * `main-headless.ts` consumer. `EventSource` also can't attach a custom
 * `Cookie` header, which Node's side of this capability needs.
 */
function subscribeToInvoicesSse(
  params: { projectId: string },
  handlers: InvoiceSseHandlers,
): () => void {
  const controller = new AbortController()
  handlers.onStatusChange("connecting")

  void (async () => {
    try {
      const cookie = currentSessionCookie()
      const res = await fetch(apiUrl(`/api/projects/${params.projectId}/invoices/stream`), {
        headers: cookie !== undefined ? { cookie } : {},
        credentials: "include",
        signal: controller.signal,
      })
      if (!res.ok || res.body === null) {
        handlers.onStatusChange("disconnected")
        return
      }
      handlers.onStatusChange("connected")

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buffer = ""
      for (;;) {
        const { done, value } = await reader.read()
        if (done) break
        buffer += decoder.decode(value, { stream: true })
        const frames = buffer.split("\n\n")
        buffer = frames.pop() ?? ""
        for (const frame of frames) {
          const dataLine = frame.split("\n").find((line) => line.startsWith("data: "))
          if (dataLine === undefined) continue
          handlers.onEvent(
            JSON.parse(dataLine.slice("data: ".length)) as { invoices: Invoice[] },
          )
        }
      }
    } catch {
      // Aborted (normal, on unsubscribe) or a genuine network failure --
      // either way, the connection is no longer live.
    } finally {
      handlers.onStatusChange("disconnected")
    }
  })()

  return () => controller.abort()
}

const billingSchema = {
  fields: {
    invoices: [] as Invoice[],
  },
  getters: {
    listInvoices: {
      params: { projectId: "" },
      execute: (
        params: { projectId: string },
        signal: AbortSignal,
      ): Promise<{ invoices: Invoice[] }> =>
        apiFetch(`/api/projects/${params.projectId}/invoices`, { signal }),
      processor: (result: { invoices: Invoice[] }): { invoices: Invoice[] } => result,
      writes: { invoices: true },
    },
  },
  mutators: {
    createInvoice: {
      params: { projectId: "", clientName: "", amountCents: 0 },
      execute: async (
        params: { projectId: string; clientName: string; amountCents: number },
        signal: AbortSignal,
      ): Promise<readonly Invoice[]> => {
        const result = await apiFetch<{ invoices: readonly Invoice[] }>(
          `/api/projects/${params.projectId}/invoices`,
          { method: "POST", body: JSON.stringify(params), signal },
        )
        return result.invoices
      },
      processor: (result: readonly Invoice[]): { invoices: readonly Invoice[] } => ({
        invoices: result,
      }),
      writes: { invoices: true },
    },
    markInvoicePaid: {
      params: { projectId: "", invoiceId: "" },
      execute: async (
        params: { projectId: string; invoiceId: string },
        signal: AbortSignal,
      ): Promise<readonly Invoice[]> => {
        const result = await apiFetch<{ invoices: readonly Invoice[] }>(
          `/api/projects/${params.projectId}/invoices/${params.invoiceId}/pay`,
          { method: "POST", signal },
        )
        return result.invoices
      },
      processor: (result: readonly Invoice[]): { invoices: readonly Invoice[] } => ({
        invoices: result,
      }),
      writes: { invoices: true },
      // Cast inline, not annotated directly -- createData's own generic
      // inference widens an individual operation definition while checking
      // it against DataSchema's own bound, which would otherwise conflict
      // with a narrower parameter annotation here (a contravariant
      // position).
      optimistic: (
        authoritativeState: unknown,
        params: { projectId: string; invoiceId: string },
      ): { invoices: readonly Invoice[] } | undefined => {
        const current = (authoritativeState as { fields: { invoices: readonly Invoice[] } })
          .fields.invoices
        if (current.every((invoice) => invoice.id !== params.invoiceId)) return undefined
        return {
          invoices: current.map((invoice) =>
            invoice.id === params.invoiceId ? { ...invoice, status: "paid" } : invoice,
          ),
        }
      },
    },
    disputeInvoice: {
      params: { projectId: "", invoiceId: "" },
      execute: async (
        params: { projectId: string; invoiceId: string },
        signal: AbortSignal,
      ): Promise<readonly Invoice[]> => {
        const result = await apiFetch<{ invoices: readonly Invoice[] }>(
          `/api/projects/${params.projectId}/invoices/${params.invoiceId}/dispute`,
          { method: "POST", signal },
        )
        return result.invoices
      },
      processor: (result: readonly Invoice[]): { invoices: readonly Invoice[] } => ({
        invoices: result,
      }),
      writes: { invoices: true },
    },
  },
  subscriptions: {
    // Writes `invoices` (array-typed), not a nullable scalar -- unlike
    // `examples/team-service/`'s own `subscribeToProject` (which writes the
    // nullable `project` field specifically so `.info.project?.subscription`
    // is meaningful). `DataInfo<T>` for an array field is keyed per item
    // identity, not one flat `FieldInfo` (see this repo's own runtime
    // types), so `.info.invoices?.subscription` would type-check but read
    // back `undefined` at runtime -- consumers below (`BillingPanel.tsx`,
    // `main-headless.ts`) deliberately never read it; `main-headless.ts`
    // instead proves the subscription's real dedup against the server's own
    // `subscriberCountFor()`.
    subscribeToInvoices: {
      params: { projectId: "" },
      subscribe: subscribeToInvoicesSse,
      processor: (event: { invoices: readonly Invoice[] }): { invoices: readonly Invoice[] } =>
        event,
      writes: { invoices: true },
    },
  },
}

export const billingData = createData(billingSchema)

documentData(billingSchema, {
  name: "billing",
  owner: "finance-team",
  purpose: "Tracking invoices issued to clients and their payment/dispute status.",
  legalBasis: "contract",
  dataResidency: "us",
  auditRequired: true,
  fields: {
    invoices: {
      description: "Every invoice on the current project.",
      sensitivity: "confidential",
      protections: "Session-authenticated access only; TLS in transit; amounts encrypted at rest.",
      retention: "7 years after project closure, per financial recordkeeping policy.",
      purpose: "Billing clients and tracking payment/dispute status for financial reporting.",
      auditRequired: true,
    },
  },
  getters: {
    listInvoices: {
      description: "Fetches every invoice on a project.",
      source: "billing-api",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "billing-api",
          url: "https://api.example.com/v1/projects/:projectId/invoices",
          handling: "encrypted",
        },
      ],
    },
  },
  mutators: {
    createInvoice: {
      description: "Issues a new invoice to a client.",
      source: "billing-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "billing-api",
          url: "https://api.example.com/v1/projects/:projectId/invoices",
          handling: "encrypted",
        },
      ],
    },
    markInvoicePaid: {
      description: "Marks an invoice paid.",
      source: "billing-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "billing-api",
          url: "https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/pay",
          handling: "encrypted",
        },
      ],
    },
    disputeInvoice: {
      description: "Marks an invoice disputed and notifies finance for review.",
      source: "billing-api",
      endpoints: [
        {
          direction: "output",
          kind: "api",
          name: "billing-api",
          url: "https://api.example.com/v1/projects/:projectId/invoices/:invoiceId/dispute",
          handling: "encrypted",
        },
      ],
    },
  },
  subscriptions: {
    subscribeToInvoices: {
      description: "Live invoice status updates from other finance staff viewing the same project.",
      endpoints: [
        {
          direction: "input",
          kind: "api",
          name: "billing-api",
          url: "https://api.example.com/v1/projects/:projectId/invoices/stream",
          handling: "encrypted",
        },
      ],
    },
  },
  // A pre-existing utility (server/legacy-compliance-sync.ts) predates this
  // capability's own documentation and reads `invoices` via a runtime-
  // computed field name -- data-cap can't statically resolve which field
  // that is (ADR 0052's field-level indeterminate-access disclosure). This
  // citation records a developer's own confirmation of exactly where, so
  // the generated evidence report can say "declared-dynamic," not just
  // "unconsumed" or "indeterminate" (ADR 0053). Re-verified every run
  // against the cited file's own content hash.
  evidence: {
    fields: {
      invoices: { dynamicAccess: ["src/server/legacy-compliance-sync.ts:26:19"] },
    },
  },
})
