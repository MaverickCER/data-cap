/**
 * Structured logging (pino) -- one of the six real services this example
 * integrates specifically to show what role data-cap does *not* play: it
 * has no logging concept of its own, deliberately (see specs/architecture.md's
 * dependency-direction rules -- core/runtime never import a logging library).
 */
import pino from "pino"

export const logger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  base: { service: "enterprise-platform" },
})
