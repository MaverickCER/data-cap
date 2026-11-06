/**
 * A stand-in for the database. In a real service this is the query that
 * `postgres:users` below names: it returns every column of the row, which is
 * exactly the over-fetching the flow analysis is here to make visible.
 */
export interface UserRow {
  id: string
  name: string
  email: string
  passwordHash: string
  role: string
}

const ROWS: Record<string, UserRow> = {
  "1": { id: "1", name: "Ada Lovelace", email: "ada@example.com", passwordHash: "$argon2id$v=19$m=65536$c2FsdA$aGFzaA", role: "admin" },
}

export async function queryUser(id: string): Promise<UserRow> {
  const row = ROWS[id]
  if (row === undefined) throw new Error(`no user ${id}`)
  return { ...row }
}
