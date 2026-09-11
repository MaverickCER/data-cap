/**
 * MongoDB connection (Mongoose) -- deliberately partitioned away from
 * `capabilities/matters.capability.ts` so it's obvious the database is an
 * implementation detail `execute` happens to call into, not the thing this
 * example is actually about. Swap this module for a Postgres pool or a
 * REST client and the capability above it doesn't change at all.
 */
import mongoose from "mongoose"
import { logger } from "./logger.js"

let connected = false

export async function connectDb(uri: string): Promise<void> {
  if (connected) return
  await mongoose.connect(uri)
  connected = true
  logger.info({ event: "db.connected" }, "Connected to MongoDB")
}

export async function disconnectDb(): Promise<void> {
  if (!connected) return
  await mongoose.disconnect()
  connected = false
  logger.info({ event: "db.disconnected" }, "Disconnected from MongoDB")
}
