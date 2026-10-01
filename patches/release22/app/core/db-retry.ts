/**
 * Release 22 (R22-201): retry a database write when SQLite is still busy after its 10 s lock wait.
 * Only wrap database work: a Shopify write must never be repeated, so callers wrap the database
 * step that follows it, not the whole apply.
 */
export const BUSY = /SQLITE_BUSY|database is locked|database is busy|P2034|P1008|Socket timeout|Transaction already closed|Unable to start a transaction in the given time|P2028/i;
export const isBusyError = (e: unknown) => BUSY.test(e instanceof Error ? `${e.message} ${(e as { code?: string }).code || ""}` : String(e));
export async function withDbRetry<T>(work: () => Promise<T>, opts: { tries?: number; baseMs?: number; onRetry?: (attempt: number, e: unknown) => void } = {}): Promise<T> {
  const tries = opts.tries ?? 3;
  for (let attempt = 0; ; attempt++) {
    try {
      return await work();
    } catch (e) {
      if (attempt >= tries || !isBusyError(e)) throw e;
      opts.onRetry?.(attempt + 1, e);
      await new Promise((r) => setTimeout(r, (opts.baseMs ?? 250) * 2 ** attempt + Math.floor(Math.random() * 100)));
    }
  }
}
