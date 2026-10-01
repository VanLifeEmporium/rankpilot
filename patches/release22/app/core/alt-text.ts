/**
 * Release 22 (R22-505): every image's alt text is checked, not only empty or repeated ones.
 * Keyword-stuffed supplier alts ("20L Cool Box, Ice Box, Large Cool Box, for Picnics, Beach…") and
 * shouting ("FALCON round Pie Dish White 26CM") are rewritten; a scene ("in a van-life setting") is
 * only kept when the image actually shows one.
 */
const ACRONYMS = new Set(["LED", "USB", "UK", "UV", "BBQ", "RGB", "XL", "XXL", "DAB", "HDMI", "AC", "DC", "PVC", "EVA", "ABS", "TV", "CO", "WIFI", "GPS", "LCD", "SPF", "UPF", "PU", "PE", "PP"]);
export type AltProblem = "empty" | "duplicate" | "stuffed" | "capitals" | "generic";
export function altProblem(alt: string, others: string[] = [], title = ""): AltProblem | null {
  const a = (alt || "").trim();
  if (!a) return "empty";
  if (others.some((o) => o.trim().toLowerCase() === a.toLowerCase())) return "duplicate";
  const segments = a.split(/\s*[,;|]\s*/).filter(Boolean);
  if (segments.length >= 4 || (a.length > 125 && segments.length >= 3)) return "stuffed";
  if (title && a.toLowerCase().split(title.toLowerCase()).length > 2) return "stuffed";
  if (/^(product image|image|photo|picture)\s*\d*$/i.test(a) || /\s[–-]\s*product image \d+$/i.test(a)) return "generic";
  const shouting = a.split(/\s+/).filter((w) => /^[A-Z]{3,}[A-Z0-9]*$/.test(w.replace(/[^A-Za-z0-9]/g, "")) && !ACRONYMS.has(w.replace(/[^A-Za-z0-9]/g, "")));
  if (shouting.length) return "capitals";
  return null;
}
const SCENE = /\s*,?\s*\b(?:in|at|on|for|during)\s+(?:a|an|the)?\s*(?:cosy\s+|cozy\s+|rustic\s+|outdoor\s+)?(?:van[- ]?life|campervan|camper\s?van|motorhome|campsite|camping|outdoor|festival|beach|road[- ]?trip|adventure)\s+(?:setting|scene|environment|background|lifestyle|adventure|trip|backdrop|vibe)s?\b/gi;
/** Sentence case, metric units spaced, and a scene only when the image shows one. */
export function cleanAlt(alt: string, opts: { sceneVisible?: boolean } = {}) {
  let a = (alt || "").replace(/\s+/g, " ").trim();
  if (!opts.sceneVisible) a = a.replace(SCENE, "").replace(/\s+([,.])/g, "$1").trim();
  a = a.split(" ").map((w) => {
    const core = w.replace(/[^A-Za-z0-9]/g, "");
    const unit = w.match(/^(\d+(?:\.\d+)?)(CM|MM|ML|KG|L|G|M)([.,]?)$/);
    if (unit) return `${unit[1]} ${unit[2].toLowerCase()}${unit[3]}`;
    if (/^[A-Z]{3,}$/.test(core) && !ACRONYMS.has(core)) return w.toLowerCase();
    return w;
  }).join(" ");
  a = a.replace(/^\s*[a-z]/, (c) => c.toUpperCase()).replace(/\s+$/, "");
  return a.length && !/[.!?]$/.test(a) ? a : a;
}
