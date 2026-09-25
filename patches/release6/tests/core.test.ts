import { describe, it, expect, beforeAll, afterAll, vi } from "vitest";
vi.mock('../app/core/generation.server', async(importOriginal) => ({...await importOriginal<typeof import('../app/core/generation.server')>(), generateArticle:vi.fn(async()=>'<p>Quick answer: compare the catalogue details.</p>')}));
import { auditCatalogue, optimise } from "../app/core/catalogue";
import { defaults, type Payload } from "../app/core/types";
import {
  encrypt,
  decrypt,
  requireSameOrigin,
} from "../app/core/security.server";
import {
  safeInput,
  fetchResource,
  graphql,
  operations,
  updateResource,
} from "../app/core/shopify-api.server";
import {
  schemaNodes,
  validateSchema,
  publicFetch,
} from "../app/core/crawl.server";
import { classifyAnswer } from "../app/core/integrations.server";
import {
  applyChange,
  approve,
  propose,
  enqueue,
  tick,
  fieldValue,
  withField,
  compatibleState,
} from "../app/core/service.server";
import { seedDemo } from "../app/core/demo.server";
import prisma from "../app/db.server";
import { parse } from "graphql";
const p: Payload = {
  title: "HOT SALE Portable Power Station 500Wh!",
  handle: "supplier-001",
  descriptionHtml: "<p>Best quality dropship product</p>",
  seo: { title: "", description: "" },
  images: [
    {
      id: "image1",
      alt: "",
      url: "https://cdn.shopify.com/x.jpg",
      filename: "x.jpg",
    },
  ],
  collections: ["Off Grid"],
  variants: [{ price: "100", sku: "x", barcode: "" }],
};
beforeAll(async () => {
  for (const model of [
    "resource",
    "audit",
    "change",
    "job",
    "event",
    "observation",
    "metric",
    "report",
    "webhookReceipt",
  ] as const)
    await (prisma[model] as unknown as {deleteMany(args:{where:{storeId:string|{in:string[]}}}):Promise<unknown>}).deleteMany({
      where: { storeId: { in: ["demo-test", "demo-other"] } },
    });
  await prisma.store.deleteMany({
    where: { id: { in: ["demo-test", "demo-other"] } },
  });
  await seedDemo("demo-test");
  await seedDemo("demo-other");
});
afterAll(async () => {
  await prisma.job.deleteMany({where:{storeId:{in:["demo-test","demo-other"]}}});
  await prisma.$disconnect();
});
describe("Factual and write guardrails", () => {
  it("blocks a description without required confirmed facts", () => {
    const r = optimise(
      p,
      "product",
      "description",
      {},
      "power station UK",
      defaults,
    );
    expect(r.blockers.join(" ")).toContain("paused");
    expect(String(r.after)).not.toContain("12V");
    expect(String(r.after)).not.toContain("VW Transporter");
  });
  it("omits unconfirmed facts and escapes confirmed supplier strings", () => {
    const r = optimise(
      p,
      "product",
      "faq",
      {
        power: { value: "12V", source: "supplier", confirmed: false },
        materials: {
          value: "<script>alert(1)</script>",
          source: "source",
          confirmed: true,
        },
      },
      "",
      defaults,
    );
    expect(r.after).toEqual([
      {
        question: "What is it made from?",
        answer: "<script>alert(1)</script>",
      },
    ]);
    const desc = optimise(
      p,
      "product",
      "description",
      { materials: { value: "<script>", source: "supplier", confirmed: true } },
      "",
      defaults,
    );
    expect(desc.after).toBe(p.descriptionHtml); // The legacy template path must remain disabled.
  });
  it.each([
    "price",
    "inventoryQuantity",
    "vendor",
    "variants",
    "collectionsToJoin",
    "status",
    "tags",
    "productType",
  ])("rejects protected field %s", (field) => {
    expect(() => safeInput({ [field]: "anything" })).toThrow("Protected");
  });
  it("creates bounded British snippets without invented specifications", () => {
    const r = optimise(p, "product", "seo", {}, "", defaults).after as Payload["seo"];
    expect(r.title.length).toBeLessThanOrEqual(60);
    expect(r.description.length).toBeLessThanOrEqual(160);
    expect(r.title).not.toContain("HOT SALE");
  });
  it("resumes partially completed image batches but rejects unrelated edits", () => {
    expect(
      compatibleState(
        [
          { id: "a", alt: "new" },
          { id: "b", alt: "" },
        ],
        [
          { id: "a", alt: "" },
          { id: "b", alt: "" },
        ],
        [
          { id: "a", alt: "new" },
          { id: "b", alt: "new" },
        ],
        "alt",
      ),
    ).toBe(true);
    expect(
      compatibleState(
        [{ id: "a", alt: "other" }],
        [{ id: "a", alt: "" }],
        [{ id: "a", alt: "new" }],
        "alt",
      ),
    ).toBe(false);
  });
  it("only changes the chosen field", () => {
    const next = withField(p, "title", "New title");
    expect(next.variants).toEqual(p.variants);
    expect(next.images).toEqual(p.images);
  });
  it("encrypts authenticated credentials and detects tampering", () => {
    const cipher = encrypt("shpat_secret");
    expect(cipher).not.toContain("shpat_secret");
    expect(decrypt(cipher)).toBe("shpat_secret");
    expect(() => decrypt(cipher.slice(0, -5) + "abcde")).toThrow();
  });
  it("rejects cross-origin form submissions", () => {
    expect(() =>
      requireSameOrigin(
        new Request("http://localhost:3000/app", {
          method: "POST",
          headers: { origin: "https://evil.example" },
        }),
      ),
    ).toThrow();
  });
  it("does not mistake lookalike domains for citations", () => {
    expect(
      classifyAnswer(
        "A shop",
        ["https://vanlifeemporium.com.evil.example"],
        "https://vanlifeemporium.com",
      ).cited,
    ).toBe(false);
    expect(
      classifyAnswer(
        "A shop",
        ["https://www.vanlifeemporium.com/products/test"],
        "https://vanlifeemporium.com",
      ).cited,
    ).toBe(true);
  });
  it("rejects localhost and private literal crawl URLs", async () => {
    await expect(publicFetch("https://127.0.0.1/")).rejects.toThrow();
    await expect(publicFetch("http://vanlifeemporium.com")).rejects.toThrow();
  });
});
describe("Audit and schema", () => {
  it("flags thin supplier text, missing SEO, GTIN and image text", () => {
    const result = auditCatalogue([
      {
        id: "1",
        title: p.title,
        kind: "product",
        payload: JSON.stringify({...p,descriptionHtml:"<p>Hot sale. Best quality.</p>"}),
        keyword: "test",
        facts: "{}",
      },
    ]);
    for (const code of [
      "thin-content",
      "supplier-language",
      "missing-alt",
      "missing-meta-description",
      "missing-gtin",
    ])
      expect(result.issues.some((i) => i.code === code)).toBe(true);
  });
  it("finds duplicate keywords without deleting products", () => {
    const r = {
      title: p.title,
      kind: "product",
      payload: JSON.stringify(p),
      keyword: "test",
      facts: "{}",
    };
    expect(
      auditCatalogue([
        { ...r, id: "1" },
        { ...r, id: "2" },
      ]).issues.some((i) => i.code === "keyword-cannibalisation"),
    ).toBe(true);
  });
  it("detects JSON-LD graph types and invalid JSON", () => {
    const result = schemaNodes(
      '<script type="application/ld+json">{"@graph":[{"@type":"Product","name":"Lamp"}]}</script><script type="application/ld+json">invalid</script>',
    );
    expect(result.nodes[0]["@type"]).toBe("Product");
    expect(result.errors).toHaveLength(1);
    expect(validateSchema([{ "@type": "FAQPage" }])).toHaveLength(1);
  });
});
describe("Shopify operation contracts", () => {
  it("all static operations parse", () =>
    Object.values(operations).forEach((op) =>
      expect(() => parse(op)).not.toThrow(),
    ));
  it.each(["product", "collection", "page", "article"])(
    "generated resource query parses for %s",
    async (kind) => {
      let query = "";
      const client = async (q: string) => {
        query = q;
        return new Response(
          JSON.stringify({
            data: {
              node: {
                id: "gid",
                title: "X",
                handle: "x",
                body: "",
                descriptionHtml: "",
                media: { nodes: [], pageInfo: {} },
                variants: { nodes: [], pageInfo: {} },
              },
            },
          }),
        );
      };
      await fetchResource(client, "gid", kind);
      expect(() => parse(query)).not.toThrow();
    },
  );
  it("Shopify userErrors fail the job rather than reporting success", async () => {
    await expect(
      graphql(
        async () =>
          new Response(
            JSON.stringify({
              data: {
                productUpdate: {
                  userErrors: [{ field: ["title"], message: "Invalid" }],
                },
              },
            }),
          ),
        operations.product,
      ),
    ).rejects.toThrow("Invalid");
  });
  it("writes only whitelisted product fields", async () => {
    let variables: unknown;
    const client = async (_: string, o?: {variables?: Record<string,unknown>}) => {
      variables = o?.variables;
      return new Response(
        JSON.stringify({
          data: { productUpdate: { product: { id: "x" }, userErrors: [] } },
        }),
      );
    };
    await updateResource(client, "x", "product", "title", "New");
    expect(variables).toEqual({ input: { id: "x", title: "New" } });
  });
});
describe("Persistent approval and rollback", () => {
  it("isolates stores, requires approval, applies and rolls back", async () => {
    const r = await prisma.resource.findFirstOrThrow({
      where: { storeId: "demo-test", kind: "product" },
    });
    const c = await prisma.change.create({data:{storeId:"demo-test",resourceId:r.id,feature:"seo",before:JSON.stringify(JSON.parse(r.payload).seo),after:JSON.stringify({title:"Reviewed title",description:"Reviewed source summary"}),reasons:JSON.stringify(["source-reviewed-v1: isolated approval lifecycle fixture"])}});
    expect(c?.status).toBe("pending");
    await applyChange("demo-test", c!.id);
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c!.id } })).status,
    ).toBe("pending");
    await expect(approve("demo-other", c!.id, "other")).rejects.toThrow();
    await approve("demo-test", c!.id, "tester");
    await applyChange("demo-test", c!.id);
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c!.id } })).status,
    ).toBe("applied");
    await applyChange("demo-test", c!.id, true);
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c!.id } })).status,
    ).toBe("rolled_back");
    expect(
      fieldValue(
        JSON.parse(
          (await prisma.resource.findUniqueOrThrow({ where: { id: r.id } }))
            .payload,
        ),
        "seo",
      ),
    ).toEqual(JSON.parse(c!.before));
  });
  it("blocks missing facts even if approval is called directly", async () => {
    const r = await prisma.resource.findFirstOrThrow({
      where: { storeId: "demo-test", remoteId: "demo-product-0" },
    });
    const c = await prisma.change.create({data:{storeId:"demo-test",resourceId:r.id,feature:"description",before:JSON.stringify("Before"),after:JSON.stringify("After"),reasons:JSON.stringify(["source-reviewed-v1: blocked fixture"]),blockers:JSON.stringify(["Confirm missing facts"])}});
    await expect(approve("demo-test", c!.id, "tester")).rejects.toThrow(
      "missing facts",
    );
  });
  it("does not overwrite a manual edit made after approval", async () => {
    const r = await prisma.resource.findFirstOrThrow({
      where: { storeId: "demo-test", remoteId: "demo-product-0" },
    });
    const c = await propose("demo-test", r.id, "title");
    await approve("demo-test", c!.id, "tester");
    const payload = JSON.parse(r.payload);
    payload.title = "Manual newer title";
    await prisma.resource.update({
      where: { id: r.id },
      data: { payload: JSON.stringify(payload) },
    });
    await expect(applyChange("demo-test", c!.id)).rejects.toThrow("Conflict");
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c!.id } })).status,
    ).toBe("conflict");
  });
  it("deduplicates jobs by delivery identity", async () => {
    const a = await enqueue("demo-test", "audit", {}, "same");
    const b = await enqueue("demo-test", "audit", {}, "same");
    expect(a.id).toBe(b.id);
  });
  it("keeps proposals pending even when an old autopilot flag is enabled", async () => {
    const store = await prisma.store.findUniqueOrThrow({
      where: { id: "demo-other" },
    });
    await prisma.store.update({
      where: { id: store.id },
      data: {
        settings: JSON.stringify({ ...defaults, autopilot: { title: true } }),
      },
    });
    const r = await prisma.resource.findFirstOrThrow({
      where: { storeId: "demo-other", kind: "product" },
    });
    await prisma.resource.update({where:{id:r.id},data:{payload:JSON.stringify({...JSON.parse(r.payload),title:"HOT SALE Camping mug!"})}});
    const c = await propose("demo-other", r.id, "title");
    for (let i = 0; i < 10; i++) await tick();
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c!.id } })).status,
    ).toBe("pending");
  });
});

describe("Analytics period comparison", () => {
  it("pairs non-overlapping 28-day periods, ignoring a previous overlapping weekly refresh", async () => {
    const { metricPair, pageGains } = await import("../app/core/analytics");
    const metric = (
      period: string,
      start: string,
      end: string,
      clicks: number,
    ) => ({
      provider: "gsc",
      period,
      payload: JSON.stringify({
        start,
        end,
        rows: [
          {
            keys: ["https://store.test/p"],
            clicks,
            impressions: 100,
            position: 4,
          },
        ],
      }),
    });
    const pair = metricPair(
      [
        metric("2026-08-23:2026-09-19", "2026-08-23", "2026-09-19", 20),
        metric("2026-08-16:2026-09-12", "2026-08-16", "2026-09-12", 99),
        metric("2026-07-26:2026-08-22", "2026-07-26", "2026-08-22", 10),
      ],
      "gsc",
    );
    expect(pair[1].rows[0].clicks).toBe(10);
    expect(pageGains(pair[0], pair[1])[0].change).toBe(10);
  });
});

describe("Draft and retired-collection history", () => {
  it("reconciles a repeated draft job and can roll back its creation", async () => {
    const { createDraft } = await import("../app/core/service.server");
    await createDraft(
      "demo-test",
      "Campervan kitchen essentials for small spaces",
      "draft-idempotency-test",
    );
    await createDraft(
      "demo-test",
      "Campervan kitchen essentials for small spaces",
      "draft-idempotency-test",
    );
    const r = await prisma.resource.findUniqueOrThrow({
      where: {
        storeId_remoteId: {
          storeId: "demo-test",
          remoteId: "draft-draft-idempotency-test",
        },
      },
    });
    const changes = await prisma.change.findMany({
      where: { storeId: "demo-test", resourceId: r.id, feature: "draft" },
    });
    expect(changes).toHaveLength(1);
    expect(JSON.parse(r.payload).published).toBe(false);
    expect(changes[0].status).toBe("pending");
    await approve("demo-test",changes[0].id,"test");
    await applyChange("demo-test",changes[0].id);
    await applyChange("demo-test", changes[0].id, true);
    expect(
      await prisma.resource.findUnique({ where: { id: r.id } }),
    ).toBeNull();
  });
  it("requires retired source and known collection target, then supports rollback", async () => {
    const { proposeRedirect } = await import("../app/core/service.server");
    await expect(
      proposeRedirect(
        "demo-test",
        "/collections/interiors",
        "/collections/off-grid",
      ),
    ).rejects.toThrow("still present");
    await expect(
      proposeRedirect("demo-test", "/collections/retired", "https://evil.test"),
    ).rejects.toThrow();
    const c = await proposeRedirect(
      "demo-test",
      "/collections/retired",
      "/collections/off-grid",
    );
    await approve("demo-test", c.id, "tester");
    await applyChange("demo-test", c.id);
    await applyChange("demo-test", c.id, true);
    expect(
      (await prisma.change.findUniqueOrThrow({ where: { id: c.id } })).status,
    ).toBe("rolled_back");
  });
});
