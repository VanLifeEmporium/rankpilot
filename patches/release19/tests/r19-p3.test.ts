import React from "react";
import { describe, it, expect, vi } from "vitest";
import { readFileSync } from "node:fs";
vi.mock("react-router", () => ({
  useFetcher: () => ({ state: "idle", data: { ok: true, message: "1 product confirmed as having no manufacturer barcode." }, submit: vi.fn(), load: vi.fn(), Form: "form" }),
  useFormAction: () => "/app",
  Link: ({ to, children }: { to: string; children: React.ReactNode }) => React.createElement("a", { href: to }, children),
}));
import { renderToStaticMarkup } from "react-dom/server";
import { cleanSupplierHtml } from "../app/core/html-cleanup";
import { plural } from "../app/core/plural";
import { previewFactImport } from "../app/core/fact-import";
import { NoBarcodeBulk, SnoozedList } from "../app/components/FindingDecisions";
import { ConfirmButton } from "../app/components/Confirm";
import { IDLE_POLL_MS } from "../app/core/live-workspace";
import { noBarcodeFact } from "../app/core/finding-state";

describe("R19-23 polish", () => {
  it("clean formatting removes BUY NOW and upgrades http:// links", () => {
    const r = cleanSupplierHtml('<p>Warm blanket.</p><button>BUY NOW</button><p><strong>BUY NOW!</strong></p><p>See <a href="http://vanlifeemporium.com/c">our range</a>.</p>');
    expect(r.html).not.toMatch(/buy now/i);
    expect(r.html).toContain('<a href="https://vanlifeemporium.com/c">our range</a>');
    expect(r.sameText).toBe(true);
  });
  it("writes plurals properly", () => {
    expect(plural(1, "product")).toBe("1 product");
    expect(plural(2, "product")).toBe("2 products");
    expect(plural(0, "check")).toBe("0 checks");
  });
  it("no native confirm(), no raw change ids in finding text, no stale screen names", () => {
    for (const f of ["components/FixArena.tsx", "components/ChangeReview.tsx", "components/HistoryActions.tsx", "components/AgentAccess.tsx", "components/Workspace.tsx"])
      expect(readFileSync("app/" + f, "utf8"), f).not.toContain("window.confirm");
    expect(readFileSync("app/core/history-hygiene.server.ts", "utf8")).not.toContain("(change ${c.id})");
    expect(readFileSync("app/core/ui.server.ts", "utf8")).not.toContain("Facts & keyword");
    const html = renderToStaticMarkup(React.createElement(ConfirmButton, { label: "Undo", question: "Restore?", onConfirm: () => {} }));
    expect(html).toContain(">Undo</button>");
  });
  it("has an error boundary and polls less often when idle", () => {
    expect(readFileSync("app/routes/app.tsx", "utf8")).toContain("Something went wrong on this page");
    expect(IDLE_POLL_MS).toBeGreaterThanOrEqual(60000);
  });
  it("CSV import names unknown columns and keeps different existing values", () => {
    const resources = [{ id: "r", title: "Basket", handle: "basket", facts: JSON.stringify({ weight: { value: "400 g", source: "Description", confirmed: false } }) }];
    expect(() => previewFactImport("handle,colour,size\nbasket,red,M", resources)).toThrow(/Unknown columns: “colour”, “size”/);
    const [item] = previewFactImport("handle,weight,materials,source\nbasket,500 g,Seagrass,Supplier sheet", resources);
    expect(item.facts.weight.value).toBe("400 g");
    expect(item.kept).toEqual(["weight"]);
    expect(item.facts.materials.value).toBe("Seagrass");
  });
});

describe("merchant feedback", () => {
  it("keeps the no-barcode message after the last product is confirmed, and offers undo", () => {
    const html = renderToStaticMarkup(React.createElement(NoBarcodeBulk, { issues: [], resources: [{ id: "p", title: "Own-label rug", kind: "product", facts: JSON.stringify({ barcode: noBarcodeFact() }) }] }));
    expect(html).toContain("confirmed as having no manufacturer barcode");
    expect(html).toContain("Confirmed without a barcode (1)");
    expect(html).toContain(">Undo</button>");
  });
  it("keeps the Show again message after the last snooze is removed", () => {
    expect(renderToStaticMarkup(React.createElement(SnoozedList, { snoozed: [] }))).toContain("confirmed");
  });
  it("Confirm all needs each value ticked and warns about replaced proposals", () => {
    const src = readFileSync("app/components/SpecReview.tsx", "utf8");
    expect(src).toContain("Confirm checked (");
    expect(src).toContain("replaces any waiting description, FAQ or Google listing proposals");
  });
});
