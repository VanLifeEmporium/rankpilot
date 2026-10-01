import { load } from "cheerio";
import { sentencePattern, faqQuestionTexts, normaliseQuestion } from "./catalogue-checks";
import { factFaqs, faqAnswerProblems, type FactFaq } from "./faq-facts";
import type { Facts, Payload } from "./types";
/**
 * Release 22 (R22-603): rewrite one repeated template ("What should I check before buying the
 * <product name>?") into product-specific text, one page at a time.
 *
 * - A template question and its answer are replaced by a question this product's facts can answer,
 *   with the fact as the answer (R22-502 rules: a size needs a length, a load is asked as a load …).
 * - A template statement is replaced by a fact sentence.
 * - With no usable fact, the template text is removed and the proposal says so.
 * Nothing is written to Shopify: the result becomes a pending change the merchant reviews.
 */
export const templateKey = (sample: string) => normaliseQuestion(sample.replace(/<product name>/g, " productname "), "");
const LABEL: Record<FactFaq["topic"], string> = { size: "Size", capacity: "Capacity", load: "Maximum load", people: "Sleeps or seats", weight: "Weight", material: "Material", care: "Care", included: "In the box", fit: "Fits", power: "Power" };
const HEADING = /^(h[1-6]|dt|summary)$/i;
const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
export type TemplateRewrite = { html: string; removed: string; question?: string; answer?: string; fact?: { key: string; value: string; source: string } };
export function rewriteTemplate(p: Payload, key: string, facts: Facts): TemplateRewrite | null {
  const $ = load(`<div id="rp-root">${p.descriptionHtml || ""}</div>`, null, false);
  const asked = new Set([...faqQuestionTexts(p), ...(p.faqs || []).map((f) => f.question)].map((q) => normaliseQuestion(q, p.title || "")));
  const usable = factFaqs(facts).filter((f) => !asked.has(normaliseQuestion(f.question, p.title || "")) && !faqAnswerProblems(f.question, f.answer).length);
  const pick = usable[0];
  const fact = pick ? { key: pick.key, value: facts[pick.key]?.value || pick.answer, source: facts[pick.key]?.source || "Product description" } : undefined;
  let result: TemplateRewrite | null = null;
  $("p,li,h2,h3,h4,h5,h6,dt,dd,summary,td").each((_, e) => {
    if ($(e).find("p,li,h2,h3,h4,h5,h6,table").length) return;
    const text = $(e).text().replace(/\s+/g, " ").trim();
    const sentence = (text.match(/[^.!?]+[.!?]?/g) || []).map((s) => s.trim()).find((s) => sentencePattern(s, p.title || "").key === key);
    if (!sentence) return;
    const el = $(e);
    const name = (e as unknown as { name: string }).name;
    const isQuestion = /\?$/.test(sentence);
    if (isQuestion) {
      // The answer is the paragraphs (or dd) right after the question, up to the next heading, question, list or table.
      const answer: ReturnType<typeof $>[] = [];
      for (let next = el.next(); next.length; next = next.next()) {
        const n = (next.get(0) as unknown as { name: string }).name;
        const t = next.text().replace(/\s+/g, " ").trim();
        if (!/^(p|dd)$/i.test(n) || HEADING.test(n) || /\?$/.test(t) || (n === "p" && next.children("strong,b").length === 1 && /\?$/.test(next.children("strong,b").text().trim()))) break;
        answer.push(next);
      }
      const removed = [sentence, ...answer.map((a) => a.text().replace(/\s+/g, " ").trim())].filter(Boolean).join(" ");
      answer.forEach((a) => a.remove());
      if (pick) {
        const tag = HEADING.test(name) ? name : "p";
        el.replaceWith(tag === "p" ? `<p><strong>${esc(pick.question)}</strong></p><p>${esc(pick.answer)}</p>` : `<${tag}>${esc(pick.question)}</${tag}><p>${esc(pick.answer)}</p>`);
        result = { html: "", removed, question: pick.question, answer: pick.answer, fact };
      } else {
        el.remove();
        result = { html: "", removed };
      }
    } else {
      const replacement = pick ? `${LABEL[pick.topic]}: ${pick.answer.replace(/\.$/, "")}.` : "";
      if (text === sentence) {
        if (pick) el.text(replacement); else el.remove();
      } else {
        const html = el.html() || "";
        const at = html.indexOf(sentence);
        if (at < 0) return; // the sentence spans inline markup; left for a manual edit
        el.html((html.slice(0, at) + esc(replacement) + html.slice(at + sentence.length)).replace(/\s{2,}/g, " ").trim());
      }
      result = { html: "", removed: sentence, ...(pick ? { answer: replacement, fact } : {}) };
    }
    return false;
  });
  if (!result) return null;
  (result as TemplateRewrite).html = $("#rp-root").html() || "";
  return result;
}
