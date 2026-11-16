/**
 * Instrumentation hook.
 *
 * v1 used this to start node-cron, which didn't work reliably in serverless.
 * v2 uses external cron triggers hitting /api/jobs/* routes instead.
 * This file is kept as a no-op placeholder for future instrumentation needs
 * (e.g. OpenTelemetry, logging setup).
 */

export async function register() {
  // No-op: background jobs are now triggered via /api/jobs/* routes
}
