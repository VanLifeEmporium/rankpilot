import { load } from "cheerio";
/**
 * Release 22 (R22-103, R22-104): is a product's FAQ visible to shoppers and crawlers?
 * Checked in the live page HTML, without running JavaScript, so "Verified" means what a shopper and
 * an AI crawler actually receive, not only that the product field was saved in Shopify admin.
 */
export const SAVED_NOT_LIVE = "Saved, not live";
const fold = (s: string) => s.normalize("NFKC").replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, " ").trim().toLowerCase();
export type FaqPageCheck = { block: boolean; missing: string[]; live: boolean; faqPages: number; sources: string[] };
const faqPageCount = (html: string) => {
  const $ = load(html);
  let n = 0;
  const sources: string[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    let data: unknown;
    try { data = JSON.parse($(el).text()); } catch { return; }
    const visit = (v: unknown) => {
      if (Array.isArray(v)) return v.forEach(visit);
      if (!v || typeof v !== "object") return;
      const t = (v as Record<string, unknown>)["@type"];
      if ([t].flat().includes("FAQPage")) { n++; sources.push($(el).attr("data-rankpilot-faq-schema") !== undefined ? "RankPilot FAQ block" : $(el).attr("id") || "theme or another app"); }
      for (const x of Object.values(v as object)) if (x && typeof x === "object") visit(x);
    };
    visit(data);
  });
  return { n, sources };
};
export function faqOnPage(html: string, faqs: { question: string; answer: string }[]): FaqPageCheck {
  const $ = load(html || "");
  const block = $("[data-rankpilot-faq]").length > 0;
  const text = fold($("[data-rankpilot-faq]").length ? $("[data-rankpilot-faq]").text() : $("body").text());
  const missing = faqs.filter((f) => f.question && !text.includes(fold(f.question))).map((f) => f.question);
  const { n, sources } = faqPageCount(html || "");
  return { block, missing, live: block && faqs.length > 0 && missing.length === 0, faqPages: n, sources };
}
/** Theme editor link that opens the product template with the RankPilot FAQ block ready to add. */
export function faqBlockLink(shop: string, apiKey = process.env.SHOPIFY_API_KEY || "") {
  const params = new URLSearchParams({ template: "product", ...(apiKey ? { addAppBlockId: `${apiKey}/faq`, target: "mainSection" } : {}) });
  return `https://${shop}/admin/themes/current/editor?${params}`;
}
