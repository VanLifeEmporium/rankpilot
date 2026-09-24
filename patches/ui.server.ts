import {repairPendingTitles} from "./proposal-repair.server";
import sanitizeHtml from "sanitize-html";
import { data } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { context } from "./context.server";
import { requireSameOrigin, encrypt, credentials } from "./security.server";
import { features, settings } from "./types";
import { enqueue, enqueueGeneration, approve, log, proposeRedirect, propose, refreshCatalogueAudit } from "./service.server";
import { extractFacts, keywordFor } from "./catalogue";
import { audit } from "./service.server";
import { classifyAnswer } from "./integrations.server";
export async function loadUI(request: Request) {
  const { store } = await context(request);
  await repairPendingTitles(store.id);
  let audits = await prisma.audit.findMany({
    where: { storeId: store.id },
    orderBy: { createdAt: "desc" },
    take: new URL(request.url).pathname.endsWith("/reports") ? 12 : 1,
  });
  if (store.demo && !audits.length) {
    await audit(store.id);
    audits = await prisma.audit.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: new URL(request.url).pathname.endsWith("/reports") ? 12 : 1,
    });
  }
  const [
    resources,
    changes,
    jobs,
    events,
    observations,
    metrics,
    reports,
    keys,
  ] = await Promise.all([
    prisma.resource.findMany({
      where: { storeId: store.id },
      orderBy: { title: "asc" },
    }),
    prisma.change.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
    }),
    prisma.job.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 1000,
    }),
    prisma.event.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 50,
    }),
    prisma.observation.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 300,
    }),
    prisma.metric.findMany({
      where: { storeId: store.id },
      orderBy: { period: "desc" },
    }),
    prisma.report.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    credentials(store.id),
  ]);
  return {
    demo: store.demo,
    domain: store.domain,
    settings: {...settings(store.settings), autopilot: Object.fromEntries(features.map(k => [k, false]))},
    discoveries: JSON.parse(store.discoveries),
    resources,
    changes: changes.map((c) => ({
      ...c,
      beforeHtml: ["description", "links"].includes(c.feature)
        ? sanitizeHtml(JSON.parse(c.before), {
            allowedTags: [
              "p",
              "h2",
              "h3",
              "h4",
              "ul",
              "ol",
              "li",
              "strong",
              "em",
              "a",
              "br",
              "details",
              "summary", "img", "table", "thead", "tbody", "tr", "th", "td",
            ],
            allowedAttributes: { a: ["href"], img:["src","alt","width","height"] },
            allowedSchemes: ["https", "http"],
          })
        : null,
      afterHtml: ["description", "links"].includes(c.feature)
        ? sanitizeHtml(JSON.parse(c.after), {
            allowedTags: [
              "p",
              "h2",
              "h3",
              "h4",
              "ul",
              "ol",
              "li",
              "strong",
              "em",
              "a",
              "br",
              "details",
              "summary", "img", "table", "thead", "tbody", "tr", "th", "td",
            ],
            allowedAttributes: { a: ["href"], img:["src","alt","width","height"] },
            allowedSchemes: ["https", "http"],
          })
        : null,
    })),
    jobs,
    events,
    observations,
    metrics,
    reports,
    audits,
    credentialNames: Object.keys(keys).filter((k) => Boolean(keys[k])),
  };
}
const credentialKeys = [
  "googleServiceAccount",
  "googleClientId",
  "googleClientSecret",
  "googleRefreshToken",
  "bingKey",
  "pagespeedKey",
  "openaiKey",
  "openaiModel",
  "perplexityKey",
  "perplexityModel",
  "geminiKey",
  "geminiModel",
];
export async function actionUI(request: Request) {
  requireSameOrigin(request);
  const { store, actor } = await context(request);
  try {
    const f = await request.formData();
    const intent = String(f.get("intent") || "");
    const value = (k: string) => String(f.get(k) || "");
    switch (intent) {
      case "audit": {
        const job = await enqueue(store.id, "audit");
        return data({ok: true, message: "Audit queued. Progress and completion will appear beside Run store audit.", jobId: job.id});
      }
      case "analytics":
      case "visibility":
      case "report":
        await enqueue(store.id, intent);
        break;
      case "pagespeed":
        await enqueue(store.id, "pagespeed", {
          url: z.string().url().parse(value("url")),
        });
        break;
      case "optimise": {
        const feature = z
          .enum(
            features as [
              (typeof features)[number],
              ...(typeof features)[number][],
            ],
          )
          .parse(value("feature"));
        const raw = JSON.parse(value("ids"));
        const ids = z.array(z.string()).min(1).max(5000).parse(raw);
        const rows = await prisma.resource.findMany({
          where: { storeId: store.id, id: { in: ids } },
        });
        if (rows.length !== ids.length)
          throw new Error("Resource selection is invalid");
        if (["filename", "faq"].includes(feature) && rows.some(r => r.kind !== "product"))
          throw new Error("Needs manual review: file renaming and product FAQs currently support products only. No change has been made.");
        if (["seo", "description", "alt"].includes(feature)) {
          const keys = await credentials(store.id);
          if (!keys.openaiKey) throw new Error("Connect an OpenAI API key in Settings to generate source-based copy and image descriptions. No change has been made.");
        }
        const job = await enqueueGeneration(store.id, ids, feature, value('regenerate')==='true');
        return data({ok:true,jobId:job.id,message:job.status==='completed' ? 'Existing generation result retrieved. Review the outcome before generating again.' : 'Generation queued. Nothing is published until you accept a preview.'});
      }
      case "redirect":
        await proposeRedirect(store.id, value("path"), value("target"));
        break;
      case "approve": {
        await approve(store.id, value("id"), actor);
        const job=await prisma.job.findUnique({where:{dedup:`${store.id}:apply:${value('id')}`}});
        return data({ok:true,jobId:job?.id,message:"Accepted. Applying and verifying the change in Shopify."});
      }
      case "reject": {
        const updated = await prisma.change.updateMany({
          where: { id: value("id"), storeId: store.id, status: "pending" },
          data: { status: "rejected" },
        });
        if (!updated.count) throw new Error("Change already reviewed");
        await log(store.id, "Change rejected", {
          changeId: value("id"),
          actor,
        });
        return data({ok:true,message:"Proposal rejected. Shopify content was not changed."});
      }
      case "rollback": {
        const c = await prisma.change.findFirstOrThrow({
          where: { id: value("id"), storeId: store.id, status: "applied" },
        });
        await enqueue(store.id, "rollback", { changeId: c.id }, c.id);
        break;
      }
      case "retry": {
        const j = await prisma.job.findFirstOrThrow({
          where: { id: value("id"), storeId: store.id, status: "failed" },
        });
        if(j.kind==='rollback') await prisma.change.updateMany({where:{id:JSON.parse(j.payload).changeId,storeId:store.id,status:{in:['rollback_failed','verification_failed']}},data:{status:'rolling_back',error:null}});
        await prisma.job.update({
          where: { id: j.id },
          data: { status: "queued", attempts: 0, runAt: new Date() },
        });
        break;
      }
      case "suggestFacts": {
        const r=await prisma.resource.findFirstOrThrow({where:{id:value('id'),storeId:store.id}});
        const payload=JSON.parse(r.payload);
        return data({ok:true,message:'Suggestions extracted from existing product information. Review them before confirming.',factResourceId:r.id,factSuggestions:extractFacts(payload),keywordSuggestion:keywordFor(payload,r.kind)});
      }
      case "facts": {
        const r = await prisma.resource.findFirstOrThrow({
          where: { id: value("id"), storeId: store.id },
        });
        const facts: Record<string, unknown> = {};
        for (const k of [
          "dimensions",
          "weight",
          "materials",
          "power",
          "compatibility",
          "included",
          "care",
        ]) {
          const v = value(k).trim(),
            source = value(k + "Source").trim();
          if (v)
            facts[k] = {
              value: z.string().max(1000).parse(v),
              source: z.string().min(3).max(2000).parse(source),
              confirmed: f.get(k + "Confirmed") === "on",
            };
        }
        await prisma.resource.update({
          where: { id: r.id },
          data: {
            facts: JSON.stringify(facts),
            keyword: z.string().max(200).parse(value("keyword")),
          },
        });
        await prisma.change.updateMany({
          where: {
            storeId: store.id,
            resourceId: r.id,
            status: "pending",
            feature: { in: ["description", "faq", "seo"] },
          },
          data: { status: "superseded" },
        });
        await refreshCatalogueAudit(store.id);
        await log(store.id, "Product facts updated", {
          resourceId: r.id,
          actor,
        });
        return data({ok:true,message:"Product facts saved.",factsSaved:r.id});
      }
      case "keyword": {
        const r = await prisma.resource.findFirstOrThrow({
          where: { id: value("id"), storeId: store.id },
        });
        await prisma.resource.update({
          where: { id: r.id },
          data: { keyword: z.string().max(200).parse(value("keyword")) },
        });
        break;
      }
      case "settings": {
        const cfg = settings(store.settings);
        cfg.autopilot = Object.fromEntries(features.map(k => [k, false]));
        cfg.weekly = f.get("weekly") === "on";
        cfg.requeue = f.get("requeue") === "on";
        cfg.gscSite = z.string().max(300).parse(value("gscSite"));
        cfg.ga4Property = z.string().regex(/^\d*$/).parse(value("ga4Property"));
        cfg.merchantAccount = z
          .string()
          .regex(/^\d*$/)
          .parse(value("merchantAccount"));
        cfg.blogId = value("blogId");
        cfg.crawlLimit = z.coerce
          .number()
          .int()
          .min(1)
          .max(5000)
          .parse(value("crawlLimit"));
        cfg.policies = {
          delivery: value("delivery"),
          returns: value("returns"),
          source: value("policySource"),
        };
        if (
          (cfg.policies.delivery || cfg.policies.returns) &&
          !cfg.policies.source
        )
          throw new Error("Provide a verified policy source");
        await prisma.store.update({
          where: { id: store.id },
          data: { settings: JSON.stringify(cfg) },
        });
        await log(store.id, "Settings updated", {
          actor,
          autopilot: cfg.autopilot,
        });
        break;
      }
      case "credentials": {
        if (store.demo)
          throw new Error(
            "Demo mode does not accept real API credentials. Start a live installation first.",
          );
        const supplied = z
          .record(z.string(), z.string().max(20000))
          .parse(JSON.parse(value("credentials")));
        for (const k of Object.keys(supplied))
          if (!credentialKeys.includes(k))
            throw new Error(`Unknown credential name: ${k}`);
        if (supplied.googleServiceAccount) {
          const s = JSON.parse(supplied.googleServiceAccount);
          if (!s.client_email || !s.private_key)
            throw new Error("Invalid Google service account JSON");
        }
        const existing = await credentials(store.id);
        for (const [k, v] of Object.entries(supplied)) {
          if (v) existing[k] = v;
          else delete existing[k];
        }
        await prisma.store.update({
          where: { id: store.id },
          data: { credentials: encrypt(JSON.stringify(existing)) },
        });
        await log(store.id, "Integration credentials updated", {
          names: Object.keys(supplied),
          actor,
        });
        break;
      }
      case "draft":
        await enqueue(store.id, "draft", { title: value("title") });
        break;
      case "observation": {
        const engine = z
          .enum(["Google AI Overviews", "Copilot"])
          .parse(value("engine"));
        const text = z.string().min(5).max(20000).parse(value("text"));
        const citations = value("citations")
          .split("\n")
          .filter(Boolean)
          .map((s) => z.string().url().refine(v=>/^https?:\/\//.test(v),"Use an HTTP(S) source URL").parse(s.trim()));
        const result = classifyAnswer(text, citations, store.domain);
        await prisma.observation.create({
          data: {
            storeId: store.id,
            engine,
            prompt: z.string().min(3).parse(value("prompt")),
            model: "Manual observation",
            text,
            citations: JSON.stringify(citations),
            competitors: JSON.stringify(result.competitors),
            mentioned: result.mentioned,
            cited: result.cited,
            source: "Manual observation",
          },
        });
        break;
      }
      default:
        throw new Error("Unknown action");
    }
    return data({
      ok: true,
      message: [
        "facts",
        "settings",
        "keyword",
        "credentials",
        "observation",
      ].includes(intent)
        ? "Saved."
        : "Action recorded. Background work will appear below.",
    });
  } catch (e) {
    if (e instanceof Response) throw e;
    return data(
      { ok: false, message: e instanceof Error ? e.message : "Action failed" },
      { status: 400 },
    );
  }
}
