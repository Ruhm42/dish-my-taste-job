/**
 * Why an error happened, for the catch sites that print one line rather than the whole error.
 *
 * Since drizzle-orm 0.44 a failed query throws DrizzleQueryError, whose message is the SQL and
 * its parameters: the driver's own error — ECONNREFUSED, the violated constraint — moves to
 * `cause`. Printing `.message` reports what was asked and drops why it failed.
 */
export function errorReason(error: unknown): string {
  if (!(error instanceof Error)) return String(error)
  if (error.cause instanceof Error) return errorReason(error.cause)
  // A refused `localhost` is tried on ::1 then 127.0.0.1, and Node reports both attempts as one
  // AggregateError with an EMPTY message: the local database being down would print nothing.
  if (error instanceof AggregateError && !error.message) {
    return error.errors.map(errorReason).join('; ')
  }
  return error.message
}
