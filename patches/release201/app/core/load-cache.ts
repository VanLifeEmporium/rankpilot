/**
 * Release 20.1: small in-memory cache for work the page loader would otherwise repeat on every request.
 *
 * Release 20 made the loader re-run the whole catalogue audit (health scores) and rebuild the page
 * liveness index on every page load and every live-state poll. Both are synchronous CPU work over
 * every product, so the web process stopped answering (even /health) and Render returned 502s.
 * The results only change when the synced resources or the latest audit change, so they are cached
 * against a cheap fingerprint of those inputs.
 */
type Entry = { key: string; value: unknown; at: number };
const entries = new Map<string, Entry>();
const MAX_ENTRIES = 50;
const MAX_AGE_MS = 30 * 60 * 1000;

/** A fingerprint of the synced resources: count plus the newest update time and the largest id. */
export function resourceFingerprint(resources: { id: string; updatedAt?: Date | string | null }[]) {
  let newest = 0;
  let lastId = "";
  for (const r of resources) {
    const t = r.updatedAt ? new Date(r.updatedAt).getTime() : 0;
    if (t > newest) newest = t;
    if (r.id > lastId) lastId = r.id;
  }
  return `${resources.length}:${newest}:${lastId}`;
}

/** Return the cached value for `name` when `key` matches, otherwise compute, store and return it. */
export function cached<T>(name: string, key: string, compute: () => T): T {
  const hit = entries.get(name);
  const now = Date.now();
  if (hit && hit.key === key && now - hit.at < MAX_AGE_MS) return hit.value as T;
  const value = compute();
  entries.delete(name);
  entries.set(name, { key, value, at: now });
  while (entries.size > MAX_ENTRIES) entries.delete(entries.keys().next().value as string);
  return value;
}

/** For tests. */
export function clearLoadCache() {
  entries.clear();
}
