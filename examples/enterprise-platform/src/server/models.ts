/**
 * Mongoose schemas -- the persistence shape. Deliberately narrower than
 * some capabilities' own field shapes in places (e.g. `InvoiceDoc` has no
 * `projectName`) precisely to make the point every one of this session's
 * examples makes: the database schema and a capability's declared field
 * shape are two independent concerns that happen to agree where they do,
 * not the same thing by construction.
 */
import mongoose, { Schema } from "mongoose"

export interface UserDoc {
  readonly _id: string
  readonly email: string
  readonly name: string
  readonly passwordHash: string
  readonly role: "admin" | "member"
}

export interface ProjectDoc {
  readonly _id: string
  readonly name: string
  readonly ownerId: string
  readonly department: "engineering" | "finance" | "sales"
  readonly createdAt: string
}

export interface InvoiceDoc {
  readonly _id: string
  readonly projectId: string
  readonly clientName: string
  readonly amountCents: number
  readonly status: "draft" | "sent" | "paid" | "disputed"
  readonly createdAt: string
}

const userSchema = new Schema<UserDoc>({
  _id: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  name: { type: String, required: true },
  passwordHash: { type: String, required: true },
  role: { type: String, enum: ["admin", "member"], required: true },
})

const projectSchema = new Schema<ProjectDoc>({
  _id: { type: String, required: true },
  name: { type: String, required: true },
  ownerId: { type: String, required: true },
  department: { type: String, enum: ["engineering", "finance", "sales"], required: true },
  createdAt: { type: String, required: true },
})

const invoiceSchema = new Schema<InvoiceDoc>({
  _id: { type: String, required: true },
  projectId: { type: String, required: true, index: true },
  clientName: { type: String, required: true },
  amountCents: { type: Number, required: true },
  status: {
    type: String,
    enum: ["draft", "sent", "paid", "disputed"],
    required: true,
    default: "draft",
  },
  createdAt: { type: String, required: true },
})

// `mongoose.models.X` reuse guards against "OverwriteModelError" -- this
// module can be imported more than once across the headless script, the
// reports scripts, and (in `npm run dev`) TanStack Start's own server-
// function bundling, all inside the same process.
export const UserModel =
  (mongoose.models.User as mongoose.Model<UserDoc> | undefined) ??
  mongoose.model<UserDoc>("User", userSchema)
export const ProjectModel =
  (mongoose.models.Project as mongoose.Model<ProjectDoc> | undefined) ??
  mongoose.model<ProjectDoc>("Project", projectSchema)
export const InvoiceModel =
  (mongoose.models.Invoice as mongoose.Model<InvoiceDoc> | undefined) ??
  mongoose.model<InvoiceDoc>("Invoice", invoiceSchema)
