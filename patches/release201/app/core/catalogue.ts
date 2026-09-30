import { specFacts } from "./spec-extract";
import { confirmedNoBarcode } from "./finding-state";
import { blockingMarkup } from "./html-cleanup";
import { ruleErrors, ruleSummary, allowedCaps } from "./brand-rules";
import { contentUnits, faqSuggestions, mentionsDelivery, relevantQuestions, articleFacts, nextSeason, duplicateAlts, faqQuestionTexts, normaliseQuestion, barcodeProblems, vendorProblems, vendorKey, answeredQuestions, ANSWER_QUESTIONS, type VendorContext } from "./catalogue-checks";
import {supplierSignals} from './content-policy';
import { load } from "cheerio";
import {
  escapeHtml,
  slug,
  type Payload,
  type Facts,
  type Feature,
  type Issue,
  type Settings,
} from "./types";
export const clusters: Record<string, string[]> = {
  Interiors: [
    "campervan interior accessories UK",
    "campervan curtains",
    "van blackout blinds",
    "campervan storage ideas",
    "van conversion accessories",
    "campervan cushions",
    "van interior decor",
  ],
  "Kitchen/Cooking": [
    "campervan kitchen accessories",
    "compact camping cookware",
    "portable camping stove UK",
    "van life kitchen storage",
    "collapsible kitchenware",
  ],
  "Off Grid": [
    "off-grid camping gear UK",
    "portable power station for campervan",
    "leisure battery charger",
    "campervan solar panel kit",
    "12V accessories",
    "water storage for vans",
  ],
  "Best Sellers": [
    "campervan essentials UK",
    "gifts for van lifers",
    "van life accessories UK",
  ],
  Signature: [
    "van life wall art",
    "campervan wood print",
    "gifts for van lifers",
    "camper van gifts UK",
  ],
};
export const prompts = [
  "best portable power station for a campervan UK",
  "where to buy campervan interior accessories UK",
  "gifts for someone who loves van life",
  "best compact cookware for a campervan",
  "campervan wall art UK",
  "essential kit for a first campervan trip",
];
export const topics = [
  "How to power a campervan off grid",
  "Campervan kitchen essentials for small spaces",
  "Best gifts for van lifers",
  "How to keep a campervan warm in a UK winter",
  "Van conversion interior ideas on a budget",
];
export const text = (html: string) =>
  load(html).text().replace(/\s+/g, " ").trim();
export function cleanTitle(title: string) {
  return title
    .replace(
      /\b(HOT SALE|BEST SELLER|FREE SHIPPING|NEW ARRIVAL|Wholesale|Dropshipping)\b/gi,
      "",
    )
    .replace(/\bRV\b/g, "campervan")
    .replace(/\bcolor\b/gi, "colour")
    .replace(/[!|]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}
/**
 * Counts customer questions answered in the body under an FAQ-style heading.
 * Products that already answer questions in their description are not flagged as missing FAQs.
 */
export function bodyFaqQuestions(html: string) {
  const $ = load(html || "");
  const candidates = $("h2,h3,h4,h5,h6,strong,b,dt,summary").toArray();
  const start = candidates.findIndex((e) => /\bFAQs?\b|frequently asked|common questions|questions and answers/i.test($(e).text()) && !/\?\s*$/.test($(e).text().trim()) && $(e).text().trim().length < 90);
  if (start < 0) return 0;
  return candidates.slice(start + 1).filter((e) => /\?\s*$/.test($(e).text().trim())).length;
}
export type AuditResource = {
  id: string;
  title: string;
  kind: string;
  payload: string;
  keyword: string;
  facts: string;
};
export type AuditContext = { templateQuestions: Set<string>; vendors: VendorContext["vendors"]; storeName: string; deliveryPolicy: boolean; sharedDelivery?: boolean; capsAllowlist?: string[]; templateSentences?: Map<string, string>; productCount?: number };
/** Release 19: first pass over the catalogue — shared FAQ questions and vendor spellings. */
export function createPrescan(opts: { storeName?: string; deliveryPolicy?: boolean; capsAllowlist?: string[] } = {}) {
  const questions = new Map<string, number>();
  const sentences = new Map<string, { n: number; sample: string }>();
  let withDelivery = 0;
  const vendors = new Map<string, Map<string, number>>();
  let products = 0;
  return {
    add(resources: AuditResource[]) {
      for (const r of resources) {
        if (r.kind !== "product") continue;
        products++;
        const p: Payload = JSON.parse(r.payload);
        for (const q of new Set(faqQuestionTexts(p).map((q) => normaliseQuestion(q, p.title)))) questions.set(q, (questions.get(q) || 0) + 1);
        if (mentionsDelivery(p)) withDelivery++;
        for (const [k, sample] of contentUnits(p)) { const e = sentences.get(k); if (e) e.n++; else sentences.set(k, { n: 1, sample }); }
        // Keep memory bounded on large catalogues: sentences seen once are dropped first.
        if (sentences.size > 60000) for (const [k, e] of sentences) if (e.n === 1) sentences.delete(k);
        const v = (p.vendor || "").trim();
        if (v) { const k = vendorKey(v); const m = vendors.get(k) || new Map<string, number>(); m.set(v, (m.get(v) || 0) + 1); vendors.set(k, m); }
      }
    },
    context(): AuditContext {
      // A question on more than 10% of products is a template, not a product-specific FAQ.
      const templateQuestions = new Set([...questions].filter(([, n]) => products >= 10 && n > products * 0.1).map(([q]) => q));
      // Release 20 (RP-401): a sentence on at least 20% of products (and 5 or more) is repeated template text.
      const templateSentences = new Map([...sentences].filter(([, e]) => products >= 10 && e.n >= Math.max(5, products * 0.2)).sort((a, b) => b[1].n - a[1].n).slice(0, 10).map(([k, e]) => [k, e.sample]));
      // A delivery line on most products is a shared, store-level answer.
      return { templateQuestions, templateSentences, productCount: products, vendors, capsAllowlist: opts.capsAllowlist || [], storeName: opts.storeName || "", deliveryPolicy: !!opts.deliveryPolicy, sharedDelivery: products > 0 && withDelivery / products >= 0.5 };
    },
  };
}
/** Release 20.1: the catalogue score for one page type (same formula as the whole audit). */
export const kindScore = (t: { count: number; checks: number; failed: number }) => ({
  score: t.count ? (t.checks ? Math.max(0, Math.round(100 * (1 - Math.min(t.failed, t.checks) / t.checks))) : 100) : 0,
  checks: t.checks,
  failed: Math.min(t.failed, t.checks),
});
/** Release 20.1: stored product ids per repeated-template finding (the count stays exact). */
export const TEMPLATE_ID_LIMIT = 200;
export function auditCatalogue(resources: AuditResource[], opts: { storeName?: string; deliveryPolicy?: boolean; capsAllowlist?: string[] } = {}) {
  const prescan = createPrescan(opts);
  prescan.add(resources);
  const auditor = createCatalogueAuditor(prescan.context());
  auditor.add(resources);
  return auditor.result();
}
/**
 * Release 19: incremental auditor. Resources can be added a page at a time; only short
 * strings (titles, summaries, description signatures) are kept between pages.
 */
/** Short key for a description signature, so long descriptions are not all kept in memory. */
const sigKey = (s: string) => { if (s.length <= 200) return s; let h = 5381; for (let i = 0; i < s.length; i++) h = ((h * 33) ^ s.charCodeAt(i)) >>> 0; return `${s.length}:${h}:${s.slice(0, 80)}`; };
export function createCatalogueAuditor(ctx: AuditContext = { templateQuestions: new Set(), vendors: new Map(), storeName: "", deliveryPolicy: false }) {
  const issues: Issue[] = [];
  let count = 0;
  const titles = new Map<string, string>();
  const metas = new Map<string, string>();
  const keywords = new Map<string, string>();
  const products = new Map<string, string>();
  let checks = 0,
    failed = 0;
  let factsTotal = 0,
    factsPresent = 0;
  let products_ = 0, answeredTotal = 0, askedTotal = 0, deliveryMissing = 0;
  const missingAnswers = new Map<string, { id: string; title: string }[]>();
  // Release 20.1: per page-type tallies, so the page loader need not re-run the audit for each type.
  const kinds = new Map<string, { count: number; checks: number; failed: number }>();
  const tally = (kind: string) => { let t = kinds.get(kind); if (!t) { t = { count: 0, checks: 0, failed: 0 }; kinds.set(kind, t); } return t; };
  const templateHits = new Map<string, string[]>();
  const add_ = (resources: AuditResource[]) => {
  for (const r of resources) {
    count++;
    const p: Payload = JSON.parse(r.payload);
    const add = (
      code: string,
      severity: Issue["severity"],
      detail: string,
      feature?: Feature,
    ) => {
      issues.push({
        resourceId: r.id,
        title: r.title,
        code,
        severity,
        detail,
        feature,
        ...(unpublished ? { unpublished: true } : {}),
      });
      // Release 19: advisory notices are shown but are not failed checks.
      // Release 20 (RP-301): pages nobody can see are listed separately and never counted.
      if (severity !== "notice" && !unpublished) { failed++; tally(r.kind).failed++; }
    };
    // Release 20 (RP-301): unpublished pages keep their findings (labelled) but are left out of scores.
    const unpublished = p.published === false;
    tally(r.kind).count++;
    if (!unpublished) { checks += 7; tally(r.kind).checks += 7; }
    const title = p.seo?.title || "";
    if (!title)
      add(
        "missing-meta-title",
        "warning",
        "No explicit SEO title; the theme may fall back to the page title.",
        "seo",
      );
    else if (title.length > 65)
      add(
        "long-title",
        "warning",
        `${title.length} characters. Aim for about 50–60; display width varies.`,
        "seo",
      );
    if (title && titles.has(title.toLowerCase()))
      add(
        "duplicate-title",
        "warning",
        `Same SEO title as ${titles.get(title.toLowerCase())}.`,
        "seo",
      );
    if (title) titles.set(title.toLowerCase(), r.title);
    if (!p.seo.description)
      add(
        "missing-meta-description",
        "warning",
        "Write a useful page summary.",
        "seo",
      );
    else if (p.seo.description.length > 160)
      add(
        "long-meta-description",
        "warning",
        `${p.seo.description.length} characters; search snippets can be rewritten.`,
        "seo",
      );
    if (p.seo.description && metas.has(p.seo.description))
      add(
        "duplicate-meta-description",
        "warning",
        `Same summary as ${metas.get(p.seo.description)}.`,
        "seo",
      );
    if (p.seo.description) metas.set(p.seo.description, r.title);
    const utilityPage=r.kind==='page' && /^(contact(?: us)?|privacy(?: policy)?|returns?(?: policy)?|shipping(?: policy)?|terms(?: and conditions)?)$/i.test(p.title.trim());
    if (!utilityPage && text(p.descriptionHtml).split(/\s+/).filter(Boolean).length < 80)
      add(
        "thin-content",
        "warning",
        "Fewer than 80 words. Add useful facts, not filler.",
        "description",
      );
    const supplierPhrases=supplierSignals(r.kind,p);
    // Release 18: supplier markup that blocks edits (H1, buttons, forms, unsafe links).
    {const blocking=blockingMarkup(p.descriptionHtml||'');if(blocking.length)add('supplier-markup','notice',`The description contains ${blocking.join(', ')}. RankPilot will not edit around this markup. Use "Clean supplier formatting" to remove it and keep the text.`);}
    // Release 19 (R19-22, R19-18): house style from the shared brand rules. Units are their own finding.
    {const hits=ruleErrors(`${p.title}\n${p.seo?.title||''}\n${p.seo?.description||''}\n${p.descriptionHtml||''}`,{allow:allowedCaps(p.vendor,p.title,ctx.capsAllowlist)});
     const style=hits.filter(h=>h.rule!=='Imperial units'),units=hits.filter(h=>h.rule==='Imperial units');
     if(style.length&&['product','collection'].includes(r.kind))add('supplier-formatting','warning',`Breaks the house style: ${ruleSummary(style)}. Rewrite the wording in Shopify or with a reviewed description change.`,'description');
     if(units.length)add('imperial-units','warning',`Imperial units: ${units.map(u=>u.match).slice(0,5).join(', ')}. Give metric measurements (cm, kg, litres).`,'description');}
    // R19-18: long page addresses.
    {const path=r.kind==='article'?`/blogs/${p.blogHandle||'x'}/${p.handle}`:`/${r.kind}s/${p.handle}`;if(path.length>60)add('long-url','notice',`The address ${path} is ${path.length} characters. Shorter addresses read better in search results; changing it adds a redirect from the old address.`,'handle');}
    // R19-18: the same alt text on several images of one product.
    if(r.kind==='product'){const dup=duplicateAlts(p.images);if(dup.length)add('duplicate-alt','notice',`${dup.map(d=>`“${d.alt}” is used on ${d.n} images`).join('; ')}. Describe what each image shows.`,'alt');}
    // R19-15: facts in guides that go out of date.
    if(r.kind==='article'){const facts=articleFacts(text(p.descriptionHtml));if(facts.length){const next=nextSeason();add('article-dated-facts','notice',`Check before ${next.season} (${next.date}): ${facts.length} checkable ${facts.length===1?'fact':'facts'} such as ${facts.slice(0,4).map(f=>`${f.label} “${f.text}”`).join('; ')}. Opening dates, prices and postcodes change; confirm them with the site.`);(issues[issues.length-1] as Issue).count=facts.length;}}
    if(supplierPhrases.length>=2) add('supplier-language','notice',`Low-confidence wording check: ${supplierPhrases.join(', ')}. These phrases do not prove copied content. Keep original writing unless a rewrite improves it.`, 'description');
    if (p.images.some((i) => !i.alt.trim()))
      add(
        "missing-alt",
        "warning",
        "One or more images have no description.",
        "alt",
      );
    // Release 17: source dimensions are not flagged. Shopify's image CDN serves resized
    // versions to the theme, so a large original does not slow the page.
    if (r.keyword) {
      if (keywords.has(r.keyword.toLowerCase()))
        add(
          "keyword-cannibalisation",
          "warning",
          `Primary keyword also assigned to ${keywords.get(r.keyword.toLowerCase())}.`,
        );
      keywords.set(r.keyword.toLowerCase(), r.title);
    }
    if (r.kind === "product") {
      const sig = text(p.descriptionHtml).toLowerCase();
      if (sig.length > 40 && products.has(sigKey(sig)))
        add(
          "possible-duplicate-product",
          "warning",
          `Identical description to ${products.get(sigKey(sig))}. Review supplier listings; do not merge automatically.`,
        );
      products.set(sigKey(sig), r.title);
      const f: Facts = JSON.parse(r.facts);
      for (const k of ["dimensions", "weight", "materials", "included"]) {
        factsTotal++;
        if (f[k]?.confirmed && f[k]?.value?.trim() && f[k]?.source?.trim()) factsPresent++;
      }
      // Release 19: questions shared by more than 10% of products are a template and do not count.
      const ownQuestions = faqQuestionTexts(p).filter((q) => !ctx.templateQuestions.has(normaliseQuestion(q, p.title)));
      // Release 20 (RP-402): questions that are only the store-wide template get suggestions drawn from the page's facts.
      const anyQuestions = faqQuestionTexts(p).length > 0;
      if (!ownQuestions.length && anyQuestions) {
        const { suggestions, needed } = faqSuggestions(p, f, specFacts(p.descriptionHtml || ""));
        add(
          "generic-faq",
          "notice",
          `The only FAQ questions are the store-wide template. ${suggestions.length ? `Ask what shoppers need instead: ${suggestions.map((x) => `“${x.question}” ${x.answer} (source: ${x.source.slice(0, 100)})`).join("; ")}.` : "No facts on the page answer shopper questions yet."}${needed.length ? ` Confirm ${needed.join(", ")} to answer more.` : ""}`,
          "faq",
        );
      } else if (!ownQuestions.length)
        add(
          "missing-product-faq",
          "notice",
          "No product-specific FAQs. Shared template questions do not count. Add answers grounded in confirmed product facts.",
          "faq",
        );
      if (ctx.templateSentences?.size) for (const k of contentUnits(p).keys()) if (ctx.templateSentences.has(k)) { const list = templateHits.get(k) || []; list.push(r.id); templateHits.set(k, list); }
      for (const b of [...barcodeProblems(p), ...vendorProblems(p, ctx, f)]) { add(b.code, b.severity, b.detail, b.brand ? "vendor" : undefined); if (b.brand) issues[issues.length - 1].brand = b.brand; }
      if (!unpublished) {
      products_++;
      const answered = answeredQuestions(p, f, { deliveryPolicy: ctx.deliveryPolicy });
      // Release 20 (RP-104): only the questions that apply to this product type; delivery is store-level.
      const relevant = relevantQuestions(p);
      askedTotal += relevant.length;
      if (!answered.delivery) deliveryMissing++;
      for (const q of relevant) {
        if (answered[q.key]) { answeredTotal++; continue; }
        const list = missingAnswers.get(q.key) || []; list.push({ id: r.id, title: r.title }); missingAnswers.set(q.key, list);
      }
      }
      // Release 18: own-label products the merchant confirmed have no manufacturer barcode are not flagged.
      if (p.variants?.some((v) => !v.barcode) && !confirmedNoBarcode(f))
        add(
          "missing-gtin",
          "notice",
          "A variant has no GTIN. Confirm whether the manufacturer assigns one; never invent one.",
        );
    }
  }
  };
  const result = () => {
  // Release 19: one grouped finding per missing shopper answer, with the product count.
  const answerIssues: Issue[] = ANSWER_QUESTIONS.filter((q) => q.key !== "delivery").filter((q) => missingAnswers.get(q.key)?.length).map((q) => {
    const list = missingAnswers.get(q.key)!;
    return { resourceId: `answers:${q.key}`, title: q.label, code: `answer-missing-${q.key}`, severity: "notice" as const, count: list.length, resourceIds: list.slice(0, 1000).map((x) => x.id),
      detail: `${list.length} ${list.length === 1 ? "product does" : "products do"} not answer this in the description, confirmed facts or product fields. For example: ${list.slice(0, 5).map((x) => x.title).join(", ")}.` };
  });
  // Release 20 (RP-401): one store-level finding per repeated sentence, with its page count.
  let t = 0;
  for (const [k, sample] of ctx.templateSentences || []) {
    const ids = templateHits.get(k) || [];
    if (!ids.length) continue;
    answerIssues.push({ resourceId: `template:${++t}`, title: "Same text on many products", code: "repeated-template", severity: "notice", count: ids.length, resourceIds: ids.slice(0, TEMPLATE_ID_LIMIT),
      detail: `“${sample}” appears on ${ids.length} of ${ctx.productCount || ids.length} products. Replace it with detail specific to each product, or remove it: shoppers and AI answers skip text that is the same everywhere.` });
  }
  // Delivery: answered for the store when the delivery policy is set, or a delivery line is shared by most products.
  const storeDelivery = ctx.deliveryPolicy || ctx.sharedDelivery || (products_ > 0 && deliveryMissing === 0);
  if (products_ && !storeDelivery) answerIssues.push({ resourceId: "answers:delivery", title: "No delivery information", code: "answer-missing-delivery", severity: "notice", count: 1, detail: "The store has no delivery information that shoppers or AI answers can find. Add delivery times and costs once (Settings › store policies, or a shared delivery line on product pages); it then counts for every product." });
  const asked = askedTotal + (products_ ? 1 : 0), answered_ = answeredTotal + (products_ && storeDelivery ? 1 : 0);
  const answerReadiness = products_ && asked ? Math.round((100 * answered_) / asked) : 0;
  issues.sort(
    (a, b) =>
      ({ critical: 0, warning: 1, notice: 2 })[a.severity] -
      { critical: 0, warning: 1, notice: 2 }[b.severity],
  );
  return {
    issues: [...issues, ...answerIssues], checks, failed: Math.min(failed, checks),
    // Release 20: when every page is unpublished nothing is counted, so there is nothing to fail.
    score: count
      ? checks ? Math.max(0, Math.round(100 * (1 - Math.min(failed, checks) / checks))) : 100
      : 0,
    // Release 19: "Answer readiness" replaces the separate aeoScore (stored in the same column).
    aeoScore: answerReadiness,
    answerReadiness,
    answerIssues,
    factsConfirmed: factsTotal ? Math.round((factsPresent / factsTotal) * 100) : 0,
    healthScores: Object.fromEntries([...kinds].map(([kind, t]) => [kind, kindScore(t)])),
  };
  };
  return { add: add_, result };
}
const shorten = (s: string, max: number) =>
  s.length <= max
    ? s
    : s
        .slice(0, max + 1)
        .replace(/\s+\S*$/, "")
        .replace(/[.,;:]$/, "");
export function keywordFor(p: Payload, kind: string) {
  if(kind==='article'||kind==='page')return cleanTitle(p.title).replace(/\([^)]*\d{4}[^)]*\)/g,'').replace(/^\d+\s+/,'').replace(/\s+/g,' ').trim();
  if (kind === "collection")
    return clusters[p.title]?.[0] || `${cleanTitle(p.title).toLowerCase()} UK`;
  return `${cleanTitle(p.title).toLowerCase()}${/\bUK\b/.test(p.title) ? "" : " UK"}`;
}
/** Release 18: wider rule reader (labels, sections, multi-label lines). Suggestions stay unconfirmed. */
export function extractFacts(p: Payload): Facts {
  return specFacts(p.descriptionHtml || "");
}
export const factLabels: Record<string, string> = {
  dimensions: "Dimensions",
  weight: "Weight",
  capacity: "Capacity",
  materials: "Materials",
  power: "Power requirements",
  compatibility: "Compatibility",
  included: "What is included",
  care: "Care notes",
};
export function optimise(
  p: Payload,
  kind: string,
  feature: Feature,
  facts: Facts,
  keyword: string,
  config: Settings,
  related: { title: string; url: string }[] = [],
) {
  const title = cleanTitle(p.title);
  const blockers: string[] = [];
  const reasons: string[] = [];
  let before: unknown, after: unknown;
  const verified = Object.entries(facts).filter(
    // Release 18: the "no manufacturer barcode" confirmation is a catalogue decision, not a product fact for copy.
    ([k, v]) => k !== "barcode" && v.confirmed && v.value && v.source,
  );
  switch (feature) {
    case "title":
      before = p.title;
      after = title;
      reasons.push(
        "Remove promotional supplier language; use British terminology. Model identifiers are retained unless you edit them.",
      );
      break;
    case "seo": {
      before = p.seo;
      // Existing copy is editorial content, not a disposable template input.
      // Fill missing fields only; length warnings require a reviewed edit.
      const summary = load(p.descriptionHtml).text().replace(/\s+/g, " ").trim();
      after = {
        title: p.seo.title.trim() ? p.seo.title : shorten(`${title} | Van Life Emporium`, 60),
        description: p.seo.description.trim() ? p.seo.description : shorten(summary, 160),
      };
      if (!p.seo.description.trim() && summary.length < 40)
        blockers.push("Needs manual review: insufficient page content for a useful summary.");
      reasons.push("Preserve existing metadata. Fill missing fields from this page's title and content only; review any extracted summary before publishing.");
      break;
    }
    case "description":
      before = p.descriptionHtml;
      if (kind === "collection") {
        after = `<p>${escapeHtml(title)} for the space you call home on the road. Explore the collection and compare the details that matter to your campervan, motorhome or next weekend away.</p><p>Start with how you use your space. Check dimensions, materials and any power requirements on each product page before choosing.</p>`;
      } else {
        const context =
          (
            {
              Interiors:
                "A van is a small space with room for considered choices. Start with the details that make it feel like your own.",
              "Kitchen/Cooking":
                "Cooking on the road starts with knowing what fits your space. Choose around the meals you make and the storage you have.",
              "Off Grid":
                "Getting away from a hook-up starts with understanding your own setup. Check the requirements before adding new equipment.",
              Signature:
                "A reminder of the places you have been and the journeys still to come. Home is the road.",
            } as Record<string, string>
          )[p.collections[0]] ||
          "Choose the details that suit the way you travel.";
        const section = (heading: string, keys: string[]) => {
          const rows = keys
            .filter((k) => facts[k]?.confirmed && facts[k].source)
            .map(
              (k) =>
                `<li><strong>${escapeHtml(factLabels[k] || k)}:</strong> ${escapeHtml(facts[k].value)}</li>`,
            )
            .join("");
          return rows ? `<h2>${heading}</h2><ul>${rows}</ul>` : "";
        };
        after = `<p>${escapeHtml(title)}. ${context}</p><h2>Why it belongs on your shortlist</h2><p>Compare the confirmed details with your available space and the way you use your campervan or motorhome. Check suitability for your own setup before ordering.</p>${section("Key specifications", ["materials", "compatibility"])}${section("Dimensions and weight", ["dimensions", "weight"])}${section("Power requirements", ["power"])}${section("What is included", ["included"])}${section("Care notes", ["care"])}`;
        for (const k of ["dimensions", "weight", "included"])
          if (!facts[k]?.confirmed)
            blockers.push(
              `Confirm ${k} before replacing the supplier description.`,
            );
        if (
          /power|solar|charger|battery|electric|12v|usb/i.test(title) &&
          !facts.power?.confirmed
        )
          blockers.push(
            "Confirm power requirements before describing electrical use.",
          );
      }
      reasons.push(
        "Fact-led copy, using only confirmed attributes. No inferred compatibility or performance claims.",
      );
      break;
    case "alt":
      before = p.images.map(({ id, alt }) => ({ id, alt }));
      after = p.images.map(({ id, alt }, i) => ({
        id,
        alt:
          alt ||
          `${title}${p.images.length > 1 ? ` – product image ${i + 1}` : ""}`,
      }));
      reasons.push(
        "Conservative product label; no unverified colours, scenery or image details.",
      );
      break;
    case "filename":
      before = p.images.map(({ id, filename }) => ({ id, filename }));
      after = p.images.map(({ id, filename }, i) => ({
        id,
        filename: `${slug(title)}-${i + 1}.${filename.split(".").pop() || "jpg"}`,
      }));
      reasons.push("Keep the existing file extension and file association.");
      break;
    case "handle":
      before = p.handle;
      after = slug(title);
      reasons.push(
        "Create a permanent redirect from the old handle when applying. Rollback also redirects the newer URL.",
      );
      break;
    case "faq":
      before = p.faqs || [];
      after = verified.map(([k, v]) => ({
        question:
          (
            {
              dimensions: "What are the dimensions?",
              weight: "How much does it weigh?",
              capacity: "What is its capacity?",
              power: "What power supply does it need?",
              compatibility: "What is it compatible with?",
              materials: "What is it made from?",
              included: "What is included?",
              care: "How should I care for it?",
            } as Record<string, string>
          )[k] || `What is the ${k}?`,
        answer: v.value,
      }));
      if (config.policies.source && config.policies.delivery)
        (after as {question:string;answer:string}[]).push({
          question: "How long does UK delivery take?",
          answer: config.policies.delivery,
        });
      if (config.policies.source && config.policies.returns)
        (after as {question:string;answer:string}[]).push({
          question: "Can I return it?",
          answer: config.policies.returns,
        });
      if (!(after as {question:string;answer:string}[]).length)
        blockers.push(
          "Confirm at least one specification or delivery/returns policy.",
        );
      reasons.push(
        "FAQs are rendered visibly by the app embed. Existing FAQ schema is detected before adding markup.",
      );
      break;
    case "links":
      before = p.descriptionHtml;
      {const $=load(p.descriptionHtml,{},false);
      $('[data-rankpilot="related"]').remove();
      // Unmarked legacy or editorial links count as existing links and are retained.
      const links=new Set($('a[href]').map((_,el)=>$(el).attr('href')).get());
      const missing=related.filter(r=>!links.has(r.url));
      after=$.html()+(missing.length?`<section data-rankpilot="related"><h2>Explore related kit</h2><ul>${missing.map(r=>`<li><a href="${escapeHtml(r.url)}">${escapeHtml(r.title)}</a></li>`).join('')}</ul></section>`:'');}
      reasons.push(
        "Relevant links from the imported catalogue; electrical compatibility is not implied.",
      );
      break;
  }
  if (feature === "description") {
    after = before;
    blockers.push("Needs manual review: automatic description replacement is paused to protect existing content.");
  }
  return { before, after, blockers, reasons };
}
