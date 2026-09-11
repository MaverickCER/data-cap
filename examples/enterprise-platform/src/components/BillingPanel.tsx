/**
 * One project's own invoices -- fetches on mount, subscribes for the
 * lifetime of the component (a second open tab/component viewing the same
 * project's invoices never opens a second SSE connection -- see
 * `main-headless.ts`'s own proof against the server's real subscriber
 * count), and renders `markInvoicePaid`'s optimistic lifecycle directly:
 * paying an invoice flips its status instantly, no separate "pending" state
 * to manage. Deliberately never reads `snapshot.info.invoices` -- see
 * `billing.capability.ts`'s own comment on why that's meaningless for an
 * array-typed field's subscription status.
 */
import { useEffect, useState } from "react"
import { billingData } from "../capabilities/billing.capability.js"
import { useCapability } from "../hooks/useCapability.js"

export interface BillingPanelProps {
  readonly projectId: string
}

export function BillingPanel({ projectId }: BillingPanelProps): React.JSX.Element {
  const snapshot = useCapability(billingData)
  const [clientName, setClientName] = useState("")
  const [amount, setAmount] = useState("")

  useEffect(() => {
    void billingData.listInvoices({ projectId })
    const release = billingData.subscribeToInvoices({ projectId })
    return release
  }, [projectId])

  return (
    <section>
      <h2>Invoices</h2>
      <ul>
        {snapshot.fields.invoices.map((invoice) => (
          <li key={invoice.id}>
            {invoice.clientName} -- ${(invoice.amountCents / 100).toFixed(2)} ({invoice.status})
            {invoice.status !== "paid" && invoice.status !== "disputed" && (
              <button
                type="button"
                onClick={() => void billingData.markInvoicePaid({ projectId, invoiceId: invoice.id })}
              >
                Mark paid
              </button>
            )}
            {invoice.status !== "disputed" && (
              <button
                type="button"
                onClick={() => void billingData.disputeInvoice({ projectId, invoiceId: invoice.id })}
              >
                Dispute
              </button>
            )}
          </li>
        ))}
      </ul>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          const amountCents = Math.round(Number.parseFloat(amount) * 100)
          void billingData.createInvoice({ projectId, clientName, amountCents })
          setClientName("")
          setAmount("")
        }}
      >
        <input
          value={clientName}
          onChange={(event) => setClientName(event.target.value)}
          placeholder="Client name"
          required
        />
        <input
          value={amount}
          onChange={(event) => setAmount(event.target.value)}
          placeholder="Amount (USD)"
          inputMode="decimal"
          required
        />
        <button type="submit">Issue invoice</button>
      </form>
    </section>
  )
}
