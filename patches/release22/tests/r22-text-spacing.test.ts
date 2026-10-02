import { describe, it, expect } from "vitest";
import { answeredQuestions, shopperText } from "../app/core/catalogue-checks";
import { ruleErrors } from "../app/core/brand-rules";
import type { Payload } from "../app/core/types";

const page = (descriptionHtml: string): Payload => ({ title: "Geometric Rug", handle: "geometric-rug", descriptionHtml, seo: { title: "", description: "" }, images: [], collections: [], productType: "Rugs" });

describe("Release 22 fix: block elements keep their word boundaries", () => {
  it("counts a spec-list answer that follows another list item", () => {
    const p = page("<ul><li>Pile: low and flat</li><li>What's included: one rug</li><li>Care: wipe clean with a damp cloth</li></ul>");
    expect(shopperText(p)).toContain("flat What's included");
    const a = answeredQuestions(p, {});
    expect(a.included).toBe(true);
    expect(a.care).toBe(true);
  });
  it("counts an FAQ answer straight after its question heading", () => {
    const p = page("<h3>How heavy is the rug?</h3><p>It weighs about 1.2 kg.</p><h3>Can I wash it?</h3><p>Spot clean only.</p>");
    expect(answeredQuestions(p, {}).weight).toBe(true);
  });
});

describe("Release 22 fix: model codes are not imperial units", () => {
  it("ignores a model number followed by 'in'", () => {
    expect(ruleErrors("The Betron KBS08 in blue has a carry strap.", {}).filter((h) => h.rule === "Imperial units")).toEqual([]);
  });
  it("still flags real inches, feet and ounces", () => {
    const units = ruleErrors("It is 17 inches wide, 25ft long and holds 16oz.", { volume: true }).filter((h) => h.rule === "Imperial units").map((h) => h.match);
    expect(units).toEqual(["17 inches → 43 cm", "25ft → 7.6 m", "16oz → 470 ml"]);
  });
});
