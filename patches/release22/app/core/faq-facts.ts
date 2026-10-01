/**
 * Release 22 (R22-502, R22-106): which fact may answer which FAQ question.
 *
 * The 1 Oct review found "How big is it? 204 kg": a load capacity used as a size, because every
 * "capacity" fact was treated as a size. These rules decide the question from what the value
 * measures, so a size answer needs a length or volume, a weight needs a weight unit, a cleaning
 * answer needs a cleaning instruction, and a component material says which part it is.
 */
const N = String.raw`\d+(?:[.,]\d+)?`;
export const LENGTH = new RegExp(String.raw`${N}\s?(?:(?:x|×|by)\s?${N}\s?)*(?:mm|cm|m|metres?|meters?|in|inch(?:es)?|"|”|″|ft|feet|foot)\b|${N}\s?(?:mm|cm|m)\b`, "i");
export const VOLUME = new RegExp(String.raw`${N}\s?(?:ml|cl|l|litres?|liters?|fl\.?\s?oz|gallons?|pints?)\b`, "i");
export const WEIGHT_UNIT = new RegExp(String.raw`${N}\s?(?:kg|g|grams?|kilos?|kilograms?|lbs?|pounds?|oz|ounces?)\b`, "i");
const LOAD_WORDS = /\b(?:max(?:imum)?|load|capacity|holds?|supports?|up to|user weight|weight limit|bears?)\b/i;
export const CLEANING = /\b(?:wash(?:able|ing|ed)?|wipe|wiped|clean(?:ing|ed|s)?|rinse|dishwasher|machine[- ]wash|hand[- ]wash|dry[- ]clean|vacuum|hoover|brush(?:ed)?|sponge|tumble|soap|detergent|stain)\b/i;
const PEOPLE = /\b(?:sleeps|seats|persons?|people|berths?|man)\b/i;
const COMPONENT = /^(frame|cover|outer|outer material|outer fabric|lining|filling|fill|upholstery|pile|shell|base|legs?|handle|lid|seat|straps?|mattress|insole|sole|cushion)\s*(?:material)?\s*[:：]\s*(.+)$/i;

export type FaqItem = { question: string; answer: string };
export type FactFaq = FaqItem & { key: string; topic: "size" | "capacity" | "load" | "people" | "weight" | "material" | "care" | "included" | "fit" | "power" };
const sentence = (s: string) => s.trim().replace(/\s+/g, " ").slice(0, 300);

/** The FAQ a single fact can answer, or null when the value does not fit any question it could answer. */
export function factFaq(key: string, value: string): FactFaq | null {
  const v = sentence(value || "");
  if (!v) return null;
  switch (key) {
    case "dimensions":
      return LENGTH.test(v) || VOLUME.test(v) ? { key, topic: "size", question: "How big is it?", answer: v } : null;
    case "capacity":
      if (VOLUME.test(v)) return { key, topic: "capacity", question: "How much does it hold?", answer: v };
      if (WEIGHT_UNIT.test(v)) return { key, topic: "load", question: "How much weight does it hold?", answer: v };
      if (PEOPLE.test(v)) return { key, topic: "people", question: "How many people is it for?", answer: v };
      if (LENGTH.test(v)) return { key, topic: "size", question: "How big is it?", answer: v };
      return null;
    case "weight":
      if (!WEIGHT_UNIT.test(v)) return null;
      return LOAD_WORDS.test(v) ? { key, topic: "load", question: "How much weight does it hold?", answer: v } : { key, topic: "weight", question: "How much does it weigh?", answer: v };
    case "care":
      // "Store in a dry place" is storage advice, not cleaning.
      return CLEANING.test(v) ? { key, topic: "care", question: "How do I clean it?", answer: v } : null;
    case "materials": {
      const part = v.match(COMPONENT);
      if (part) return { key, topic: "material", question: "What is it made from?", answer: `The ${part[1].toLowerCase()} is ${part[2].trim().replace(/\.$/, "")}.` };
      return { key, topic: "material", question: "What is it made from?", answer: v };
    }
    case "included":
      return { key, topic: "included", question: "What comes in the box?", answer: v };
    case "compatibility":
      return { key, topic: "fit", question: "What does it fit?", answer: v };
    case "power":
      return { key, topic: "power", question: "What power does it need?", answer: v };
    default:
      return null;
  }
}
const ORDER = ["dimensions", "capacity", "weight", "materials", "included", "care", "compatibility", "power"];
/** Every valid FAQ from a set of facts, one per question. */
export function factFaqs(facts: Record<string, { value: string } | undefined>): FactFaq[] {
  const out: FactFaq[] = [];
  for (const key of ORDER) {
    const f = facts[key];
    const faq = f ? factFaq(key, f.value) : null;
    if (faq && !out.some((o) => o.question === faq.question)) out.push(faq);
  }
  return out;
}

/** Why a saved question and answer do not match, or [] when they do. */
export function faqAnswerProblems(question: string, answer: string): string[] {
  const q = question.toLowerCase(), a = answer || "";
  const problems: string[] = [];
  if (/\b(how big|what size|how large|dimensions?|measure(?:ments?)?|how long|how wide|how tall)\b/.test(q) && !/\bweight\b/.test(q)) {
    if (!LENGTH.test(a) && !VOLUME.test(a)) problems.push(WEIGHT_UNIT.test(a) ? "A size question is answered with a weight or load" : "A size question is answered without a length or volume");
  }
  if (/\bhow much does it weigh\b|\bwhat does it weigh\b|\bhow heavy\b/.test(q)) {
    if (!WEIGHT_UNIT.test(a)) problems.push("A weight question is answered without a weight");
    else if (LOAD_WORDS.test(a)) problems.push("A weight question is answered with a load capacity");
  }
  if (/\b(clean|wash|care for|look after)\b/.test(q) && !CLEANING.test(a)) problems.push("A cleaning question is answered without cleaning instructions");
  return problems;
}

/**
 * The corrected FAQ list for a product: answers that pass are kept, failing ones are replaced by the
 * right fact for that question (when the page has one) or removed. A load wrongly given as a size is
 * moved to "How much weight does it hold?" only when the page itself calls it a load.
 */
export function correctedFaqs(saved: FaqItem[], facts: Record<string, { value: string } | undefined>, pageText = ""): { faqs: FaqItem[]; fixed: { question: string; answer: string; problems: string[]; replacement?: FaqItem }[] } {
  const valid = factFaqs(facts);
  const out: FaqItem[] = [];
  const fixed: { question: string; answer: string; problems: string[]; replacement?: FaqItem }[] = [];
  for (const item of saved) {
    const problems = faqAnswerProblems(item.question, item.answer);
    if (!problems.length) { out.push(item); continue; }
    const q = item.question.toLowerCase();
    const topic = /weigh|heavy/.test(q) ? "weight" : /clean|wash|care/.test(q) ? "care" : "size";
    let replacement: FaqItem | undefined = valid.find((v) => v.topic === topic);
    if (!replacement && WEIGHT_UNIT.test(item.answer)) {
      const value = item.answer.match(WEIGHT_UNIT)?.[0] || "";
      const at = pageText.indexOf(value);
      if (value && at >= 0 && LOAD_WORDS.test(pageText.slice(Math.max(0, at - 40), at))) replacement = { question: "How much weight does it hold?", answer: item.answer };
    }
    if (replacement && !out.some((o) => o.question === replacement!.question) && !saved.some((s) => s !== item && s.question === replacement!.question)) out.push({ question: replacement.question, answer: replacement.answer });
    else replacement = undefined;
    fixed.push({ question: item.question, answer: item.answer, problems, ...(replacement ? { replacement } : {}) });
  }
  return { faqs: out, fixed };
}
