import { specFacts } from "./spec-extract";
import { confirmedNoBarcode } from "./finding-state";
import { blockingMarkup } from "./html-cleanup";
import { faqQuestionTexts, normaliseQuestion, barcodeProblems, vendorProblems, vendorKey, answeredQuestions, ANSWER_QUESTIONS, type VendorContext } from "./catalogue-checks";
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
export type AuditContext = { templateQuestions: Set<string>; vendors: VendorContext["vendors"]; storeName: string; deliveryPolicy: boolean };
/** Release 19: first pass over the catalogue — shared FAQ questions and vendor spellings. */
export function createPrescan(opts: { storeName?: string; deliveryPolicy?: boolean } = {}) {
  const questions = new Map<string, number>();
  const vendors = new Map<string, Map<string, number>>();
  let products = 0;
  return {
    add(resources: AuditResource[]) {
      for (const r of resources) {
        if (r.kind !== "product") continue;
        products++;
        const p: Payload = JSON.parse(r.payload);
        for (const q of new Set(faqQuestionTexts(p).map((q) => normaliseQuestion(q, p.title)))) questions.set(q, (questions.get(q) || 0) + 1);
        const v = (p.vendor || "").trim();
        if (v) { const k = vendorKey(v); const m = vendors.get(k) || new Map<string, number>(); m.set(v, (m.get(v) || 0) + 1); vendors.set(k, m); }
      }
    },
    context(): AuditContext {
      // A question on more than 10% of products is a template, not a product-specific FAQ.
      const templateQuestions = new Set([...questions].filter(([, n]) => products >= 10 && n > products * 0.1).map(([q]) => q));
      return { templateQuestions, vendors, storeName: opts.storeName || "", deliveryPolicy: !!opts.deliveryPolicy };
    },
  };
}
export function auditCatalogue(resources: AuditResource[], opts: { storeName?: string; deliveryPolicy?: boolean } = {}) {
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
  let products_ = 0, answeredTotal = 0;
  const missingAnswers = new Map<string, { id: string; title: string }[]>();
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
      });
      // Release 19: advisory notices are shown but are not failed checks.
      if (severity !== "notice") failed++;
    };
    checks += 7;
    const title = p.seo.title || "";
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
      if (!ownQuestions.length)
        add(
          "missing-product-faq",
          "notice",
          "No product-specific FAQs. Shared template questions do not count. Add answers grounded in confirmed product facts.",
          "faq",
        );
      for (const b of [...barcodeProblems(p), ...vendorProblems(p, ctx)]) add(b.code, b.severity, b.detail);
      products_++;
      const answered = answeredQuestions(p, f, { deliveryPolicy: ctx.deliveryPolicy });
      for (const q of ANSWER_QUESTIONS) {
        if (answered[q.key]) { answeredTotal++; continue; }
        const list = missingAnswers.get(q.key) || []; list.push({ id: r.id, title: r.title }); missingAnswers.set(q.key, list);
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
  const answerIssues: Issue[] = ANSWER_QUESTIONS.filter((q) => missingAnswers.get(q.key)?.length).map((q) => {
    const list = missingAnswers.get(q.key)!;
    return { resourceId: `answers:${q.key}`, title: q.label, code: `answer-missing-${q.key}`, severity: "notice" as const, count: list.length, resourceIds: list.slice(0, 1000).map((x) => x.id),
      detail: `${list.length} ${list.length === 1 ? "product does" : "products do"} not answer this in the description, confirmed facts or product fields. For example: ${list.slice(0, 5).map((x) => x.title).join(", ")}.` };
  });
  const answerReadiness = products_ ? Math.round((100 * answeredTotal) / (products_ * ANSWER_QUESTIONS.length)) : 0;
  issues.sort(
    (a, b) =>
      ({ critical: 0, warning: 1, notice: 2 })[a.severity] -
      { critical: 0, warning: 1, notice: 2 }[b.severity],
  );
  return {
    issues: [...issues, ...answerIssues], checks, failed: Math.min(failed, checks),
    score: count
      ? Math.max(0, Math.round(100 * (1 - Math.min(failed, checks) / checks)))
      : 0,
    // Release 19: "Answer readiness" replaces the separate aeoScore (stored in the same column).
    aeoScore: answerReadiness,
    answerReadiness,
    answerIssues,
    factsConfirmed: factsTotal ? Math.round((factsPresent / factsTotal) * 100) : 0,
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
