/**
 * Request validation (Zod) -- the second service data-cap deliberately has
 * no opinion about: `data-cap`'s own `helpers/shape.ts` guards are
 * structural type checks over already-typed values, never a per-field
 * validator vocabulary (ADR 0039). Real request bodies get validated here,
 * before anything reaches a capability's own `execute` function.
 */
import { z } from "zod"

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
})

export const createProjectSchema = z.object({
  name: z.string().min(1).max(200),
  department: z.enum(["engineering", "finance", "sales"]),
})

export const createInvoiceSchema = z.object({
  projectId: z.string().min(1),
  clientName: z.string().min(1).max(200),
  amountCents: z.number().int().positive(),
})

export const invoiceActionSchema = z.object({
  projectId: z.string().min(1),
  invoiceId: z.string().min(1),
})

export type LoginInput = z.infer<typeof loginSchema>
export type CreateProjectInput = z.infer<typeof createProjectSchema>
export type CreateInvoiceInput = z.infer<typeof createInvoiceSchema>
export type InvoiceActionInput = z.infer<typeof invoiceActionSchema>
