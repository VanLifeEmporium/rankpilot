/**
 * Release 22 (R22-301): the rendered-page checks fetch a limited sample. Order it so at least one
 * product per product template in use (Shopify's template suffix, "" = default) is fetched before
 * the rest, so a template that outputs no Product data is always found.
 */
export function templateOf(payload: string) {
  try { return String((JSON.parse(payload) as { templateSuffix?: string | null }).templateSuffix || ""); } catch { return ""; }
}
export function sampleByTemplate<T extends { kind: string; payload: string }>(resources: T[]): T[] {
  const first: T[] = [];
  const seen = new Set<string>();
  for (const r of resources) {
    const key = `${r.kind}:${r.kind === "product" ? templateOf(r.payload) : ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    first.push(r);
  }
  return [...first, ...resources.filter((r) => !first.includes(r))];
}
