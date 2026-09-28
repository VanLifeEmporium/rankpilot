import { describe, it, expect } from "vitest";
import { fitTitle, sourceDraft } from "../app/core/source-drafts";
import { seoItem, seoWarnings } from "../app/core/agent.server";
import { trustedSourceReview } from "../app/core/service.server";

const base = { title: "10 Best Scenic Campervan Stays in Southern England | Views Worth the Drive", handle: "x", images: [], collections: [], seo: { title: "", description: "" } };

describe("release 15 source drafts", () => {
  it("shortens long titles at a separator without an ellipsis", () => {
    expect(fitTitle(base.title)).toBe("10 Best Scenic Campervan Stays in Southern England");
    expect(fitTitle("Short title")).toBe("Short title");
    const cut = fitTitle("A very long product name without any separators that keeps going and going on");
    expect(cut.length).toBeLessThanOrEqual(60);
    expect(cut.endsWith(" ")).toBe(false);
  });
  it("does not use a related-links line as the Google summary", () => {
    const p = { ...base, descriptionHtml: "<p>More for this region: Best Free Campervan Parking in Southern England (2026) · 10 Best Autumn &amp; Winter Campervan Campsites in Southern England (2026/27)</p><p>These ten campervan stays across Southern England were chosen for their views, with notes on facilities and access for each site.</p>" };
    const d = sourceDraft(p as never, "article", { autopilot: {} } as never);
    expect((d.after as { description: string }).description).toMatch(/^These ten campervan stays/);
    expect((d.after as { title: string }).title.length).toBeLessThanOrEqual(60);
  });
});

describe("release 15 agent validation", () => {
  it("rejects out-of-range fields and warns outside targets", () => {
    expect(seoItem.safeParse({ resourceId: "r", title: "Too short", description: "x".repeat(150) }).success).toBe(false);
    expect(seoItem.safeParse({ resourceId: "r", title: "A good campervan title for Google here", description: "x".repeat(155) }).success).toBe(true);
    expect(seoWarnings("A good campervan title for Google here", "x".repeat(155))).toEqual([]);
    expect(seoWarnings("Wow!", "short")).toHaveLength(3);
  });
  it("trusts agent-reviewed changes like merchant-reviewed ones", () => {
    expect(trustedSourceReview("agent-reviewed-v1: checked")).toBe(true);
  });
});
