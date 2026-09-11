/**
 * Transactional email (Resend), with a console-log fallback when
 * `RESEND_API_KEY` isn't set -- keeps this example runnable (including its
 * headless golden-tested `npm start`) without a real API key, the same
 * convention every other example uses for "external" services (a simulated
 * fetch standing in for a real network call). A real deployment sets the
 * env var; nothing above this module changes either way.
 */
import { Resend } from "resend"
import { logger } from "./logger.js"

export interface InvoiceDisputedEmail {
  readonly to: string
  readonly invoiceId: string
  readonly projectName: string
}

export async function sendInvoiceDisputedEmail(email: InvoiceDisputedEmail): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY
  if (apiKey === undefined || apiKey.length === 0) {
    logger.info(
      { event: "email.console_fallback", to: email.to, invoiceId: email.invoiceId },
      `[email fallback] Invoice "${email.invoiceId}" on project "${email.projectName}" was disputed -- notifying ${email.to}`,
    )
    return
  }

  const resend = new Resend(apiKey)
  await resend.emails.send({
    from: "enterprise-platform@example.com",
    to: email.to,
    subject: `Invoice disputed: ${email.invoiceId}`,
    text: `Invoice "${email.invoiceId}" on project "${email.projectName}" was marked disputed and needs finance review.`,
  })
}
