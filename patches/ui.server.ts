import {displayResource,displayChange,jsonObject,jsonList} from "./ui-data.server";
import {updateConnection,connection} from "./connections";
import {visibleJobs} from './jobs.server';
import {repairPendingTitles} from "./proposal-repair.server";
import sanitizeHtml from "sanitize-html";
import { data } from "react-router";
import { z } from "zod";
import prisma from "../db.server";
import { context } from "./context.server";
import { requireSameOrigin, encrypt, credentials } from "./security.server";
import { features, settings } from "./types";
import { enqueue, enqueueGeneration, approve, log, proposeRedirect, tick, refreshCatalogueAudit, audit } from "./service.server";
import { extractFacts, keywordFor } from "./catalogue";
import { classifyAnswer } from "./integrations.server";
export async function loadUI(request: Request) {
  const { store } = await context(request);
  const section=new URL(request.url).pathname.split("/").pop();
  const historyPage=Math.max(0,Math.min(10000,Number(new URL(request.url).searchParams.get("historyPage"))||0));

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
    appliedCount,
    historyCount,
  ] = await Promise.all([
    prisma.resource.findMany({
      where: { storeId: store.id },
      orderBy: { title: "asc" },
    }),
    Promise.all([
      prisma.change.findMany({where:{storeId:store.id,status:{in:['pending','approved','applying','rolling_back','apply_failed','verification_failed','rollback_failed','conflict']}},orderBy:{createdAt:'desc'}}),
      prisma.change.findMany({where:{storeId:store.id,status:{in:['applied','rolled_back','rejected','superseded']}},orderBy:{createdAt:'desc'},skip:historyPage*50,take:50}),
    ]).then(groups=>groups.flat()),
    visibleJobs(store.id),
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
    Promise.all(['gsc','ga4','merchant','bing','pagespeed'].map(provider=>prisma.metric.findMany({where:{storeId:store.id,provider},orderBy:{period:'desc'},take:12}))).then(groups=>groups.flat()),
    prisma.report.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    credentials(store.id),
    prisma.change.count({where:{storeId:store.id,status:"applied"}}),
    prisma.change.count({where:{storeId:store.id,status:{in:["applied","rolled_back","rejected","superseded"]}}}),
  ]);
  return {
    demo: store.demo,
    domain: store.domain,
    settings: {...settings(store.settings), autopilot: Object.fromEntries(features.map(k => [k, false]))},
    discoveries: JSON.parse(JSON.stringify(jsonObject(store.discoveries))),
    resources: resources.map(r=>displayResource(r,section==="content" && ["article","page"].includes(r.kind))),
    appliedCount, historyCount, historyPage,
    changes: changes.map(displayChange).map((c) => ({
      ...c,
      beforeHtml: ["description", "links"].includes(c.feature)
        ? sanitizeHtml(typeof JSON.parse(c.before)==="string"?JSON.parse(c.before):"", {
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
        ? sanitizeHtml(typeof JSON.parse(c.after)==="string"?JSON.parse(c.after):"", {
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
    audits:audits.map(a=>({...a,issues:JSON.stringify(jsonList(a.issues)),coverage:JSON.stringify(jsonObject(a.coverage))})),
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
      case "report": {
        const job=await enqueue(store.id,intent);
        return data({ok:true,jobId:job.id,message:'Started. Progress and any errors will appear here.'});
      }
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
      case "redirect": {
        const change=await proposeRedirect(store.id,value('path'),value('target'));
        return data({ok:true,changeId:change.id,message:'Redirect ready to review. Nothing published.'});
      }
      case 'repairTitle':
        await repairPendingTitles(store.id);
        return data({ok:true,message:'Saved titles checked. Review the proposal before accepting.'});
      case "approve": {
        await approve(store.id, value("id"), actor);
        const job=await prisma.job.findUnique({where:{dedup:`${store.id}:apply:${value('id')}`}});
        if(job){
          let timer:ReturnType<typeof setTimeout>|undefined;
          await Promise.race([tick({jobId:job.id}),new Promise(resolve=>{timer=setTimeout(resolve,4200);})]).finally(()=>{if(timer)clearTimeout(timer);});
          const result=await prisma.change.findFirstOrThrow({where:{id:value('id'),storeId:store.id}});
          return data({ok:!['apply_failed','verification_failed','conflict'].includes(result.status),jobId:job.id,message:result.status==='applied'?'Applied and verified in Shopify.':result.error || 'Shopify is still processing this update. We will verify it automatically; you can keep working.'});
        }
        return data({ok:true,message:'Accepted. Applying and verifying in Shopify.'});
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
          data: { status: "queued", attempts: 0, runAt: new Date(), error:null },
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
            feature: { in: ["description", "faq", "seo", "title"] },
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
        const oldPolicies=JSON.stringify(cfg.policies);
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
        if(oldPolicies!==JSON.stringify(cfg.policies)) await prisma.change.updateMany({where:{storeId:store.id,feature:'faq',status:'pending'},data:{status:'superseded',error:'Store policy changed. Generate an updated preview.'}});
        await log(store.id, "Settings updated", {
          actor,
          autopilot: cfg.autopilot,
        });
        break;
      }
      case 'connectionSave':
      case 'connectionDisconnect':
      case 'connectionTest': {
        if(store.demo)throw new Error('Connections are disabled in the demonstration workspace.');
        const provider=value('provider');const option=connection(provider);
        const existing=await credentials(store.id);
        if(intent==='connectionTest'){
          if(provider!=='openai' || !existing.openaiKey)throw new Error('Save an OpenAI key before checking it.');
          let response:Response;
          try{response=await fetch('https://api.openai.com/v1/models',{headers:{Authorization:`Bearer ${existing.openaiKey}`},signal:AbortSignal.timeout(8000)});}catch{throw new Error('OpenAI did not respond in time. Your saved key has not changed. Try again later.');}
          if(!response.ok)throw new Error(response.status===401?'OpenAI did not accept the saved key. Replace it and try again.':response.status===429?'OpenAI is limiting requests. Check your account limits and try again later.':'OpenAI could not check this key. Check its permissions in your OpenAI account.');
          return data({ok:true,message:'OpenAI accepted the key. This check did not generate content; generation billing and model access are checked when you generate a preview.'});
        }
        const next=updateConnection(existing,provider,value('key'),value('model'),intent==='connectionDisconnect');
        await prisma.store.update({where:{id:store.id},data:{credentials:encrypt(JSON.stringify(next))}});
        await log(store.id,intent==='connectionDisconnect'?'Connection removed':'Connection saved',{provider,actor});
        return data({ok:true,message:intent==='connectionDisconnect'?`${option.name} disconnected.`:`${option.name} saved securely. Use its feature to confirm access.`});
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
      case "draft": {
        if(!settings(store.settings).blogId && !store.demo)throw new Error('Choose a blog in Settings before creating a draft.');
        const keys=await credentials(store.id);if(!keys.openaiKey)throw new Error('Connect OpenAI in Settings before creating a draft.');
        const job=await enqueue(store.id,'draft',{title:value('title')});
        return data({ok:true,jobId:job.id,message:'Preparing an unpublished draft. Progress will appear here.'});
      }
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
      { ok: false, message: e instanceof z.ZodError ? "Check the form and try again. Some values are missing, invalid or too long." : e instanceof Error ? e.message : "Action failed" },
      { status: 400 },
    );
  }
}
