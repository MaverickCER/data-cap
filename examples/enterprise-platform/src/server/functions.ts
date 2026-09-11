/**
 * The actual business logic -- framework-agnostic, no HTTP/SSE/React
 * concern of any kind. `http-handler.ts` exposes these over real HTTP;
 * nothing here knows that's how it's reached. This is the layer a
 * `capabilities/*.capability.ts` getter/mutator ultimately causes to run,
 * by way of a real network round trip -- never called directly by a
 * capability itself.
 */
import { randomUUID } from "node:crypto"
import { InvoiceModel, ProjectModel, UserModel } from "./models.js"
import { hashPassword, verifyPassword, type Session } from "./auth.js"
import { sendInvoiceDisputedEmail } from "./email.js"
import { logger } from "./logger.js"
import { publishInvoiceEvent } from "./sse.js"
import type { CreateInvoiceInput, CreateProjectInput, LoginInput } from "./validation.js"

export interface ProjectDto {
  readonly id: string
  readonly name: string
  readonly ownerId: string
  readonly department: "engineering" | "finance" | "sales"
  readonly createdAt: string
}

export interface InvoiceDto {
  readonly id: string
  readonly projectId: string
  readonly clientName: string
  readonly amountCents: number
  readonly status: "draft" | "sent" | "paid" | "disputed"
  readonly createdAt: string
}

export async function seedUser(input: {
  email: string
  name: string
  password: string
  role: "admin" | "member"
}): Promise<Session> {
  const existing = await UserModel.findOne({ email: input.email })
  if (existing) {
    return { userId: existing._id, email: existing.email, role: existing.role }
  }
  const doc = await UserModel.create({
    _id: randomUUID(),
    email: input.email,
    name: input.name,
    passwordHash: hashPassword(input.password),
    role: input.role,
  })
  return { userId: doc._id, email: doc.email, role: doc.role }
}

export async function login(input: LoginInput): Promise<Session | undefined> {
  const user = await UserModel.findOne({ email: input.email })
  if (!user || !verifyPassword(input.password, user.passwordHash)) return undefined
  return { userId: user._id, email: user.email, role: user.role }
}

function toProjectDto(doc: {
  _id: string
  name: string
  ownerId: string
  department: "engineering" | "finance" | "sales"
  createdAt: string
}): ProjectDto {
  return {
    id: doc._id,
    name: doc.name,
    ownerId: doc.ownerId,
    department: doc.department,
    createdAt: doc.createdAt,
  }
}

function toInvoiceDto(doc: {
  _id: string
  projectId: string
  clientName: string
  amountCents: number
  status: "draft" | "sent" | "paid" | "disputed"
  createdAt: string
}): InvoiceDto {
  return {
    id: doc._id,
    projectId: doc.projectId,
    clientName: doc.clientName,
    amountCents: doc.amountCents,
    status: doc.status,
    createdAt: doc.createdAt,
  }
}

export async function createProject(
  session: Session,
  input: CreateProjectInput,
): Promise<ProjectDto> {
  const doc = await ProjectModel.create({
    _id: randomUUID(),
    name: input.name,
    ownerId: session.userId,
    department: input.department,
    createdAt: new Date().toISOString(),
  })
  logger.info(
    { event: "project.created", projectId: doc._id, owner: session.userId },
    `Project "${doc.name}" created`,
  )
  return toProjectDto(doc)
}

export async function listProjects(): Promise<ProjectDto[]> {
  const docs = await ProjectModel.find().sort({ createdAt: -1 })
  return docs.map(toProjectDto)
}

async function currentInvoices(projectId: string): Promise<InvoiceDto[]> {
  const docs = await InvoiceModel.find({ projectId }).sort({ createdAt: 1 })
  return docs.map(toInvoiceDto)
}

export async function listInvoicesForProject(projectId: string): Promise<InvoiceDto[]> {
  return currentInvoices(projectId)
}

export async function createInvoice(input: CreateInvoiceInput): Promise<InvoiceDto[]> {
  await InvoiceModel.create({
    _id: randomUUID(),
    projectId: input.projectId,
    clientName: input.clientName,
    amountCents: input.amountCents,
    status: "draft",
    createdAt: new Date().toISOString(),
  })
  const invoices = await currentInvoices(input.projectId)
  publishInvoiceEvent(input.projectId, { invoices })
  return invoices
}

export async function markInvoicePaid(
  projectId: string,
  invoiceId: string,
): Promise<InvoiceDto[] | undefined> {
  const existing = await InvoiceModel.findById(invoiceId)
  if (!existing || existing.projectId !== projectId) return undefined
  await InvoiceModel.updateOne({ _id: invoiceId }, { status: "paid" })
  const invoices = await currentInvoices(projectId)
  publishInvoiceEvent(projectId, { invoices })
  return invoices
}

/**
 * Marks an invoice disputed -- the concrete scenario this example's own
 * litigation-evidence report (`reports/litigation-evidence.ts`) is scoped
 * to: "a client disputes a charge; prove what billing data existed and how
 * it was handled."
 */
export async function disputeInvoice(
  session: Session,
  projectId: string,
  invoiceId: string,
): Promise<InvoiceDto[] | undefined> {
  const existing = await InvoiceModel.findById(invoiceId)
  if (!existing || existing.projectId !== projectId) return undefined
  await InvoiceModel.updateOne({ _id: invoiceId }, { status: "disputed" })
  const project = await ProjectModel.findById(projectId)
  await sendInvoiceDisputedEmail({
    to: session.email,
    invoiceId,
    projectName: project?.name ?? projectId,
  })
  const invoices = await currentInvoices(projectId)
  publishInvoiceEvent(projectId, { invoices })
  return invoices
}
