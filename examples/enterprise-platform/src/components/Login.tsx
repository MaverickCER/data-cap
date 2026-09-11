/**
 * Registration/login themselves are a raw `fetch`, not a `createData`
 * capability -- same choice `identity.capability.ts`'s own header comment
 * explains: establishing a session isn't "application data" any more than
 * it is in `examples/application/` or `examples/team-service/`. Once
 * `/api/register`/`/api/login` issues a session cookie, this component's
 * only remaining job is telling `identityData` to fetch the now-real
 * current user -- everything downstream of that is ordinary capability
 * usage.
 */
import { useState } from "react"
import { apiFetch } from "../capabilities/api-client.js"
import { identityData } from "../capabilities/identity.capability.js"

export function Login(): React.JSX.Element {
  const [email, setEmail] = useState("")
  const [name, setName] = useState("")
  const [password, setPassword] = useState("")
  const [mode, setMode] = useState<"register" | "login">("register")
  const [error, setError] = useState<string | undefined>(undefined)
  const [submitting, setSubmitting] = useState(false)

  async function submit(): Promise<void> {
    setSubmitting(true)
    setError(undefined)
    try {
      if (mode === "register") {
        await apiFetch("/api/register", { method: "POST", body: JSON.stringify({ email, name, password }) })
      } else {
        await apiFetch("/api/login", { method: "POST", body: JSON.stringify({ email, password }) })
      }
      await identityData.getCurrentUser()
    } catch {
      setError(mode === "register" ? "Registration failed." : "Invalid credentials.")
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section>
      <h1>Atlas</h1>
      <form
        onSubmit={(event) => {
          event.preventDefault()
          void submit()
        }}
      >
        {mode === "register" && (
          <input value={name} onChange={(event) => setName(event.target.value)} placeholder="Name" required />
        )}
        <input
          type="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          placeholder="Email"
          required
        />
        <input
          type="password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          placeholder="Password"
          required
        />
        <button type="submit" disabled={submitting}>
          {mode === "register" ? "Register" : "Log in"}
        </button>
      </form>
      <button type="button" onClick={() => setMode(mode === "register" ? "login" : "register")}>
        {mode === "register" ? "Already have an account? Log in" : "Need an account? Register"}
      </button>
      {error !== undefined && <p role="alert">{error}</p>}
    </section>
  )
}
