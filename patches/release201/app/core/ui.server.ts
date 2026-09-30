import {plural} from './plural';
import type {Feature,Issue} from './types';
import {saveSupplierOriginals,proposeCleanFormatting} from './supplier-copy.server';
import {splitUnpublished,applyFindingState,snooze,unsnooze,keepShopify,noBarcodeFact} from './finding-state';
import {indexSummary} from './index-summary';
import {collectionCopy} from './suggestions.server';
import {parseReportedUrls} from './technical-audit';
import {previewFactImport,readCsv} from './fact-import';
import {displayResource,displayChange,jsonObject,jsonList,compactMetrics} from "./ui-data.server";
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
import { propose, queueSavedChecks, verifyChange, enqueue, enqueueGeneration, approve, log, proposeRedirect, proposeLinkRemoval, tick, refreshCatalogueAudit, audit } from "./service.server";
import { auditCatalogue, extractFacts, keywordFor } from "./catalogue";
import { cached, resourceFingerprint } from "./load-cache";
import { livenessIndex, normalisePath } from "./page-liveness";
import { classifyAnswer } from "./integrations.server";
export async function loadUI(request: Request) {
  const { store } = await context(request);
  if(!store.demo)await queueSavedChecks(store.id);
  const section=new URL(request.url).pathname.split("/").pop();
  const historyPage=Math.max(0,Math.min(10000,Number(new URL(request.url).searchParams.get("historyPage"))||0));

  // Release 20.1: only the latest audit's findings and coverage are shown, so only its are read.
  const loadAudits = async () => {
    const rows = await prisma.audit.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 24,
      select: { id: true, storeId: true, score: true, aeoScore: true, resourceCount: true, createdAt: true },
    });
    if (!rows.length) return [];
    const first = await prisma.audit.findUnique({ where: { id: rows[0].id }, select: { issues: true, coverage: true } });
    return rows.map((r, i) => ({ ...r, issues: i === 0 ? first?.issues || "[]" : "[]", coverage: i === 0 ? first?.coverage || "{}" : "{}" }));
  };
  let audits = await loadAudits();
  if (store.demo && !audits.length) {
    await audit(store.id);
    audits = await loadAudits();
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
      prisma.change.findMany({where:{storeId:store.id,status:{in:['pending','approved','applying','verifying','rolling_back','apply_failed','verification_failed','rollback_failed','conflict']}},orderBy:{createdAt:'desc'}}),
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
    Promise.all(['gsc','ga4','merchant','bing','pagespeed','crux','ga4-ai','gsc-daily','ga4-organic-daily','indexation','ai-sampling','store-score','change-impact'].map(provider=>prisma.metric.findMany({where:{storeId:store.id,provider},orderBy:provider==='change-impact'?{createdAt:'desc'}:{period:'desc'},take:provider==='store-score'?10000:provider==='change-impact'?200:12}))).then(groups=>groups.flat()),
    prisma.report.findMany({
      where: { storeId: store.id },
      orderBy: { createdAt: "desc" },
      take: 10,
    }),
    credentials(store.id),
    prisma.change.count({where:{storeId:store.id,status:"applied"}}),
    prisma.change.count({where:{storeId:store.id,status:{in:["applied","rolled_back","rejected","superseded"]}}}),
  ]);
  const samplingJob=jobs.find(j=>j.kind==='visibility');
  if(!metrics.some(m=>m.provider==='ai-sampling') && samplingJob && ['failed','running','queued'].includes(samplingJob.status)){
    metrics.push({id:'legacy-sampling-status',storeId:store.id,provider:'ai-sampling',period:'current',createdAt:samplingJob.updatedAt,payload:JSON.stringify({status:samplingJob.status==='failed'?'failed':'running',completed:0,failed:samplingJob.status==='failed'?1:0,startedAt:samplingJob.createdAt})});
  }
  // Release 20.1: the page loader must not block the web process. Release 20 re-ran the catalogue audit,
  // re-read every resource and worked out finding state three times on every load and live-state poll.
  const cfg = settings(store.settings);
  const latestCoverage = jsonObject(audits[0]?.coverage || "{}") as { healthScores?: Record<string, { score: number; checks: number; failed: number }> };
  const fingerprint = resourceFingerprint(resources);
  const healthScores = Object.fromEntries(["product","collection","article"].map(kind=>{
    const rows=resources.filter(r=>r.kind===kind);
    if(!audits.length||!rows.length)return [kind,null];
    // Scores stored by the worker with the audit (release 20.1 onwards); older audits compute once, cached.
    const stored=latestCoverage.healthScores?.[kind];
    if(stored)return [kind,stored];
    return [kind,cached(`health:${store.id}:${kind}`,`${fingerprint}|${audits[0].id}`,()=>{const result=auditCatalogue(rows);return {score:result.score,checks:result.checks,failed:result.failed};})];
  }));
  const findingState = audits[0] ? applyFindingState(jsonList(audits[0].issues) as Issue[], cfg) : null;
  const findingSplit = findingState ? splitUnpublished(findingState.active) : null;
  // Only Settings shows learned rules; only the Dashboard and Results & history use not-live paths.
  const learned = section === "settings" ? await import("./learned-rules.server").then(m=>m.learnedRules(store.id)).then(r=>r.rules).catch(()=>[]) : [];
  const gsc = ["app", "reports"].includes(section || "") ? metrics.find(m=>m.provider==="gsc") : undefined;
  const notLivePaths = gsc ? await (async()=>{
    const idx=await prisma.metric.findFirst({where:{storeId:store.id,provider:"indexation"},orderBy:{period:"desc"},select:{id:true,payload:true}});
    return cached(`notlive:${store.id}`,`${fingerprint}|${gsc.id}|${idx?.id||""}|${store.discoveries.length}`,()=>{
      const pages=(()=>{try{return JSON.parse(store.discoveries||"{}").pages||[];}catch{return [];}})();
      const rows=(()=>{try{return idx?JSON.parse(idx.payload).rows||[]:[];}catch{return [];}})();
      const live=livenessIndex(resources.filter(r=>["product","collection","page","article"].includes(r.kind)).map(r=>{let p:Record<string,unknown>={};try{p=JSON.parse(r.payload);}catch{/* empty */}return {id:r.id,kind:r.kind,handle:r.handle,title:r.title,payload:JSON.stringify({url:p.url,published:p.published,blogHandle:p.blogHandle})};}),pages,rows);
      let gscRows:{keys?:string[]}[]=[];try{gscRows=JSON.parse(gsc.payload).rows||[];}catch{/* none */}
      return [...new Set(gscRows.map(r=>r.keys?.[0]||"").filter(Boolean).filter(u=>!live(u).live).map(normalisePath))];
    });
  })() : [];
  return {
    healthScores,
    shop:store.id,
    measuredAt:new Date().toISOString(),
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
    metrics:compactMetrics(metrics).map(m=>m.provider==='indexation'?{...m,payload:JSON.stringify(indexSummary(m.payload))}:m),
    reports,
    audits:audits.map((a,index)=>index>0?{...a,issues:'[]',coverage:'{}'}:({...a,issues:JSON.stringify((findingSplit?.live||[]).filter(i=>!i||typeof i!=='object'||!('code' in i)||i.code!=='reported-404'||('resourceId' in i&&(cfg.reportedPaths||[]).some(p=>i.resourceId==='reported:'+p)))),coverage:JSON.stringify(jsonObject(a.coverage))})),
    credentialNames: Object.keys(keys).filter((k) => Boolean(keys[k])),
    // Release 18: findings hidden until a date, listed so they can be brought back.
    // Release 20 (RP-301): findings on unpublished pages, shown under "Unpublished pages".
    unpublishedIssues: findingSplit?.unpublished||[],
    // Release 20 (RP-303): Search Console pages that are not live (404, unpublished, noindex, redirected).
    // Release 20 (RP-403): rules learned from rejected proposals, shown in Settings with a reset.
    learned,
    notLivePaths,
    snoozed: findingState?.snoozed||[],
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
    const applyAccepted=async (id:string) => {
        await approve(store.id, id, actor);
        const job=await prisma.job.findUnique({where:{dedup:`${store.id}:apply:${id}`}});
        if(job){
          let timer:ReturnType<typeof setTimeout>|undefined;
          await Promise.race([tick({jobId:job.id}),new Promise(resolve=>{timer=setTimeout(resolve,4200);})]).finally(()=>{if(timer)clearTimeout(timer);});
          const result=await prisma.change.findFirstOrThrow({where:{id:id,storeId:store.id}});
          if(result.status==='conflict')return data(await verifyChange(store.id,id));
          return data({ok:!['apply_failed','verification_failed','conflict'].includes(result.status),jobId:job.id,message:result.status==='applied'?'Done. Your shop has been updated.':result.error || 'Shopify is still processing this update. We will verify it automatically; you can keep working.'});
        }
        return data({ok:true,message:'Accepted. Applying and verifying in Shopify.'});
    }
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
      case "removeReportedUrl": {
        const path=value('path');const cfg=settings(store.settings);
        if(!(cfg.reportedPaths||[]).includes(path))throw new Error('This address is no longer in the imported list.');
        cfg.reportedPaths=(cfg.reportedPaths||[]).filter(p=>p!==path);
        const discoveries=jsonObject(store.discoveries);
        if(Array.isArray(discoveries.reported))discoveries.reported=discoveries.reported.filter(r=>!r||typeof r!=='object'||!('path' in r)||r.path!==path);
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg),discoveries:JSON.stringify(discoveries)}});
        await log(store.id,'Removed an imported URL from tracking',{path,actor});
        return data({ok:true,message:'Removed from tracking. No Shopify page or redirect was deleted. Import this address again to resume checking it.'});
      }
      case "importMissingUrls": {
        const paths=parseReportedUrls(value("urls"),store.domain);const cfg=settings(store.settings);
        cfg.reportedPaths=[...new Set([...(cfg.reportedPaths||[]),...paths])].slice(0,1000);
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg)}});
        const job=await enqueue(store.id,"audit");
        return data({ok:true,jobId:job.id,message:`${paths.length} addresses imported. A scan will check their current status; no redirects have been applied.`});
      }
      case "cleanFormatting": {
        const result=await proposeCleanFormatting(store.id,value('id'));
        await log(store.id,'Formatting clean-up proposed',{resourceId:value('id'),changeId:result.change?.id,actor});
        return data({ok:true,changeId:result.change?.id,message:result.message});
      }
      case "supplierOriginals": {
        const [header,...rows]=readCsv(value('csv').replace(/^\uFEFF/,''));const h=header.map(x=>x.trim().toLowerCase());
        const col=(name:string)=>h.indexOf(name);
        if(col('handle')<0||col('original')<0)throw new Error('Use a CSV with columns handle, original and (optionally) source.');
        const result=await saveSupplierOriginals(store.id,{items:rows.map(r=>({handle:r[col('handle')],text:r[col('original')],source:col('source')>=0&&r[col('source')]?r[col('source')]:'Supplier original (CSV import)'}))});
        await log(store.id,'Supplier originals imported',{count:result.saved,actor});
        return data({ok:true,message:`${result.saved} supplier originals saved${result.results.some(r=>!r.ok)?`; ${result.results.filter(r=>!r.ok).length} rows did not match a product`:''}. Nothing in Shopify changed.`});
      }
      case "bulkFaqs": {
        // Release 18: FAQ proposals built only from confirmed facts, for products with 3+ confirmed facts and no FAQs yet.
        const rows=await prisma.resource.findMany({where:{storeId:store.id,kind:'product'},select:{id:true,facts:true,payload:true}});
        const {bodyFaqQuestions}=await import('./catalogue');
        const ids=rows.filter(r=>{const facts=JSON.parse(r.facts||'{}');const p=JSON.parse(r.payload);const n=Object.entries(facts).filter(([k,v])=>{const f=v as {value?:string;source?:string;confirmed?:boolean};return k!=='barcode'&&f.confirmed&&f.value?.trim()&&f.source?.trim();}).length;return n>=3&&!p.faqs?.length&&!bodyFaqQuestions(p.descriptionHtml||'');}).map(r=>r.id).slice(0,100);
        if(!ids.length)return data({ok:false,message:'No product has 3 or more confirmed facts and no FAQs yet. Confirm facts first (Fill specs for all products).'});
        const job=await enqueueGeneration(store.id,ids,'faq');
        await log(store.id,'Bulk FAQ proposals queued',{count:ids.length,actor});
        return data({ok:true,jobId:job.id,message:`Preparing FAQ proposals for ${plural(ids.length,'product')} from confirmed facts only. They appear in the review queue; nothing is published until you accept.`});
      }
      case "snoozeFinding": {
        const cfg=snooze(settings(store.settings),{resourceId:value('resourceId'),code:value('code'),until:value('until'),reason:value('reason'),title:value('title')||undefined});
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg)}});
        await log(store.id,'Finding snoozed',{resourceId:value('resourceId'),code:value('code'),until:value('until'),reason:value('reason'),actor});
        return data({ok:true,message:`Snoozed until ${new Date(value('until')).toLocaleDateString('en-GB')}. It is listed under Snoozed findings and returns automatically after that date.`});
      }
      case "unsnoozeFinding": {
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(unsnooze(settings(store.settings),{resourceId:value('resourceId'),code:value('code')}))}});
        await log(store.id,'Finding snooze removed',{resourceId:value('resourceId'),code:value('code'),actor});
        return data({ok:true,message:'Snooze removed. The finding shows again if the next check still finds it.'});
      }
      case "restoreRankpilot": {
        const {restoreRankpilotVersion}=await import('./history-hygiene.server');
        const result=await restoreRankpilotVersion(store.id,value('changeId'));
        return data({ok:true,changeId:result.change.id,message:result.message});
      }
      case "keepShopify": {
        const change=await prisma.change.findFirstOrThrow({where:{id:value('changeId'),storeId:store.id,status:{in:['applied','rollback_failed']}}});
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(keepShopify(settings(store.settings),change.id))}});
        await log(store.id,"Kept Shopify's version",{changeId:change.id,resourceId:change.resourceId,actor});
        await refreshCatalogueAudit(store.id);
        return data({ok:true,message:"Recorded: Shopify's current value is kept. Nothing was written to Shopify; RankPilot's earlier change stays in history with its undo."});
      }
      case "proposeBrands": {
        // Release 20 (RP-201): pending vendor changes from brand-is-store findings (one product or all).
        const { proposeBrands } = await import("./brand-proposals.server");
        const ids = f.getAll("ids").map(String).filter(Boolean);
        const { results } = await proposeBrands(store.id, { ids: ids.length ? ids : undefined, actor });
        const pending = results.filter((r) => r.status === "pending");
        const warned = results.filter((r) => r.warnings?.length);
        const failed = results.filter((r) => !r.ok);
        if (!results.length) return data({ ok: false, message: "No products with a detected brand. Run a fresh audit first." });
        return data({ ok: !failed.length || pending.length > 0, changeId: pending.length === 1 ? pending[0].changeId : undefined,
          message: `${plural(pending.length, "brand change")} ready for review.${warned.length ? ` ${warned.length} affect smart collections: ${warned[0].warnings![0]}` : ""}${failed.length ? ` ${failed.length} not prepared: ${failed[0].message}` : ""}${results.length - pending.length - failed.length ? ` ${results.length - pending.length - failed.length} unchanged.` : ""}` });
      }
      case "bookSuggest": {
        const { suggestBook } = await import("./brand-proposals.server");
        const r = await suggestBook(store.id, value("id"));
        return data({ ok: r.ok, message: r.message });
      }
      case "bookApply": {
        const { applyBook } = await import("./brand-proposals.server");
        const r = await applyBook(store.id, value("id"), { isbn: value("isbn"), publisher: value("publisher"), editionConfirmed: value("editionConfirmed") === "on", actor });
        return data({ ok: true, message: r.message, changeId: r.changeIds[0] });
      }
      case "resetLearned": {
        const cfg = settings(store.settings);
        cfg.learnedResetAt = new Date().toISOString();
        await prisma.store.update({ where: { id: store.id }, data: { settings: JSON.stringify(cfg) } });
        await log(store.id, "Learned rules reset", { actor });
        return data({ ok: true, message: "Learned rules reset. RankPilot will learn again from your next decisions." });
      }
      case "noBarcode": {
        const ids=f.getAll('ids').map(String).filter(Boolean).slice(0,500);
        if(!ids.length)throw new Error('Select at least one product.');
        const undo=value('undo')==='on';
        const rows=await prisma.resource.findMany({where:{storeId:store.id,kind:'product',id:{in:ids}}});
        for(const r of rows){const facts=JSON.parse(r.facts||'{}');if(undo)delete facts.barcode;else facts.barcode=noBarcodeFact();await prisma.resource.update({where:{id:r.id},data:{facts:JSON.stringify(facts)}});}
        await refreshCatalogueAudit(store.id);
        await log(store.id,undo?'No-barcode confirmation removed':'Confirmed no manufacturer barcode',{count:rows.length,actor});
        return data({ok:true,message:undo?`Removed the confirmation for ${plural(rows.length,'product')}.`:`${plural(rows.length,'product')} confirmed as having no manufacturer barcode. They are no longer flagged for GTIN.`});
      }
      case "fieldSpeed": {
        const active=await prisma.job.findFirst({where:{storeId:store.id,kind:'crux',status:{in:['queued','running']}}});
        const job=active||await enqueue(store.id,'crux');
        return data({ok:true,jobId:job.id,message:'Reading real-visitor speed from the Chrome UX Report.'});
      }
      case "pagespeed": {
        const job=await enqueue(store.id,"pagespeed",{url:z.string().url().parse(value("url"))});
        return data({ok:true,jobId:job.id,message:"Mobile speed test queued. Results will appear below automatically."});
      }
      case 'linkIntoPage': {
        const row=await propose(store.id,value('id'),'links',undefined,false,value('targetId'));
        return data({ok:true,changeId:row?.id,message:'Review the incoming link on its source page before accepting.'});
      }
      case 'collectionCopy': {
        const row=await collectionCopy(store.id,value('id'));
        return data({ok:true,changeId:row.id,message:'Collection guide ready for review. Existing copy is kept.'});
      }
      case 'saveSourceDraft': {
        if(value('confirmed')!=='yes')throw new Error('Check the source and confirm accuracy before preparing this preview.');
        const r=await prisma.resource.findFirstOrThrow({where:{id:value('id'),storeId:store.id}});
        const p=JSON.parse(r.payload);
        const after=z.object({title:z.string().trim().min(1).max(255),description:z.string().trim().min(1).max(500)}).parse({title:value('title'),description:value('description')});
        if(JSON.stringify(p.seo)===JSON.stringify(after))return data({ok:true,message:'The suggested listing is already saved. No change is needed.'});
        const row=await prisma.change.create({data:{storeId:store.id,resourceId:r.id,feature:'seo',before:JSON.stringify(p.seo),after:JSON.stringify(after),reasons:JSON.stringify(['merchant-reviewed-v1: Edited or checked by the merchant against the source. This is a human-reviewed draft, not an independently verified product specification.','Medium impact: gives shoppers a specific Google title and summary. Google can choose different wording.']),blockers:'[]'}});
        return data({ok:true,changeId:row.id,message:'Preview prepared. Review the before and after, then accept or reject.'});
      }
      case "sourceDraft": {
        const outcome:{message?:string}={};
        const row=await propose(store.id,value('id'),'seo',outcome,true);
        return data({ok:true,changeId:row?.id,message:row?'Source draft ready. Check the before and after before accepting.':outcome.message||'Existing listing retained.'});
      }
      case "indexation": {
        const active=await prisma.job.findFirst({where:{storeId:store.id,kind:'indexation',status:{in:['queued','running']}}});
        const limit=value('limit')==='200'?200:20;
        const job=active||await enqueue(store.id,'indexation',limit===20?{}:{limit});
        return data({ok:true,jobId:job.id,message:`Checking the next ${limit} sitemap URLs against Google’s index. Progress is saved between runs.`});
      }
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
        if (["description", "alt"].includes(feature)) {
          const keys = await credentials(store.id);
          if (!keys.openaiKey) throw new Error("Connect an OpenAI API key in Settings to generate source-based copy and image descriptions. No change has been made.");
        }
        const job = await enqueueGeneration(store.id, ids, feature, value('regenerate')==='true');
        return data({ok:true,jobId:job.id,message:job.status==='completed' ? 'Existing generation result retrieved. Review the outcome before generating again.' : 'Generation queued. Nothing is published until you accept a preview.'});
      }
      case "recheckBrokenURL": {
        const address=z.string().min(1).max(2000).parse(value('path'));
        const job=await enqueue(store.id,'recheck-link',{address},`manual:${address}:${Date.now()}`);
        return data({ok:true,jobId:job.id,message:'Checking this destination now. Counts update only when the check succeeds.'});
      }
      case "markExpectedLink": {
        const r=await prisma.resource.findFirstOrThrow({where:{storeId:store.id,id:value('resourceId')}});
        const address=z.string().url().parse(value('path'));const discoveries=JSON.parse(store.discoveries||'{}');
        const expectedLinks=[...(discoveries.expectedLinks||[]).filter((x:{resourceId:string;address:string})=>x.resourceId!==r.id||x.address!==address),{resourceId:r.id,address,recordedAt:new Date().toISOString()}];
        await prisma.store.update({where:{id:store.id},data:{discoveries:JSON.stringify({...discoveries,expectedLinks})}});
        const audits=await prisma.audit.findMany({where:{storeId:store.id},orderBy:{createdAt:'desc'},take:1});
        for(const a of audits)await prisma.audit.update({where:{id:a.id},data:{issues:JSON.stringify(JSON.parse(a.issues).filter((i:import("./types").Issue)=>!(i.resourceId===r.id&&i.code==='broken-link'&&i.link?.url===address)))}});
        await log(store.id,'Broken link marked as expected',{resourceId:r.id,address,actor});
        return data({ok:true,message:'Marked as expected. This link is retained in your page and recorded in history; no redirect was created.'});
      }
      case "replaceBrokenLink":
      case "removeBrokenLink": {
        const change=await proposeLinkRemoval(store.id,value("resourceId"),value("path"),intent==="replaceBrokenLink"?value("target"):undefined);
        return await applyAccepted(change.id);
      }
      case "applyRedirect":
      case "redirect": {
        const change=await proposeRedirect(store.id,value('path'),value('target'));
        if(intent==='applyRedirect')return await applyAccepted(change.id);
        return data({ok:true,changeId:change.id,message:'Redirect ready to review. Nothing published.'});
      }
      case 'repairTitle':
        await repairPendingTitles(store.id);
        return data({ok:true,message:'Saved titles checked. Review the proposal before accepting.'});
      case "refreshChange": {
        const id=value('id');const checked=await verifyChange(store.id,id);if(checked.ok)return data(checked);
        const change=await prisma.change.findFirstOrThrow({where:{id,storeId:store.id}});
        if(!features.includes(change.feature as Feature))throw new Error('Open this change for a new review.');
        const job=await enqueueGeneration(store.id,[change.resourceId],change.feature as Feature,true);
        return data({...checked,jobId:job.id,message:'Current Shopify content has been re-read. Preparing a new preview against that content; nothing else has been written.'});
      }
      case "verify": return data(await verifyChange(store.id,value("id")));
      case 'approveBatch': {
        const items=z.array(z.object({id:z.string(),version:z.string().datetime()})).min(1).max(25).parse(JSON.parse(value('items')));
        if(new Set(items.map(i=>i.id)).size!==items.length)throw new Error('Choose each preview once.');
        const results=[];
        for(const item of items){
          try {
            const row=await prisma.change.findFirstOrThrow({where:{id:item.id,storeId:store.id,status:'pending',feature:{in:['seo','alt']}}});
            if(JSON.parse(displayChange(row).blockers).length)throw new Error('Needs a new review');
            await approve(store.id,item.id,actor,item.version);results.push({id:item.id,ok:true});
          }catch{results.push({id:item.id,ok:false});}
        }
        const accepted=results.filter(r=>r.ok).length;
        return data({ok:accepted===items.length,message:`${plural(accepted,'change')} accepted and queued to save. ${items.length-accepted ? `${items.length-accepted} previews changed or need attention; these were not accepted.` : 'Progress appears automatically below.'}`});
      }
      case "reviseProposal": {
        const fields=z.object({title:z.string().trim().min(1).max(255),description:z.string().trim().min(1).max(500),version:z.string(),confirmed:z.literal(true)}).parse(JSON.parse(value('reason')));
        const row=await prisma.$transaction(async tx=>{
          const old=await tx.change.findFirstOrThrow({where:{id:value('id'),storeId:store.id,status:'pending',feature:'seo'}});
          if(old.updatedAt.toISOString()!==fields.version)throw new Error('This preview changed. Open it again before editing.');
          const after=JSON.stringify({title:fields.title,description:fields.description});if(after===old.before)throw new Error('Your edited fields match the current content. No update is needed.');
          const revised=await tx.change.create({data:{storeId:store.id,resourceId:old.resourceId,feature:'seo',before:old.before,after,blockers:'[]',reasons:JSON.stringify(['merchant-reviewed-v1: You edited these fields and confirmed them against your page information. Review this final preview before accepting.'])}});
          await tx.change.update({where:{id:old.id},data:{status:'superseded',error:`Replaced by your edited preview ${revised.id}`}});return revised;
        });
        return data({ok:true,changeId:row.id,message:'Your edited preview is ready. Nothing has been published.'});
      }
      case "approve": {
        // Release 20 (RP-301): say so when the page is not live, so the merchant is not surprised it changes nothing visible.
        const change=await prisma.change.findFirst({where:{id:value("id"),storeId:store.id},select:{resourceId:true}});
        const page=change?await prisma.resource.findFirst({where:{id:change.resourceId,storeId:store.id},select:{payload:true}}):null;
        const hidden=page?(()=>{try{return JSON.parse(page.payload).published===false;}catch{return false;}})():false;
        const result=await applyAccepted(value("id"));
        if(!hidden)return result;
        const body=(result as unknown as {data:{message?:string}}).data;
        if(body&&typeof body==='object')body.message=`${body.message||''} Note: this page is not live (unpublished), so shoppers will not see the change until you publish it in Shopify.`.trim();
        return result;
      }
      case "dismiss": {
        const {dismissChanges}=await import("./history-hygiene.server");
        const result=await dismissChanges(store.id,[value("id")],"No longer needed",actor);
        return data({ok:result.dismissed>0,message:result.dismissed?'Dismissed from the list. Dismissing does not edit your shop.':(result.skipped[0]?.message||'This change could not be dismissed.')});
      }
      case "settleHistory": {
        const {settleStaleChanges}=await import("./history-hygiene.server");
        const {settled}=await settleStaleChanges(store.id);
        return data({ok:true,message:settled?`${settled} failed or conflicted items were already replaced by a later applied update and have been cleared.`:'Nothing to clear: no failed item has a later applied update.'});
      }
      case "agentRevoke": {
        const cfg=settings(store.settings);cfg.agentEpoch=(cfg.agentEpoch||0)+1;
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg)}});
        await log(store.id,"Agent sessions revoked",{actor});
        return data({ok:true,message:'All agent links and sessions are revoked. Create a new link when you need one.'});
      }
      case "agentToggle": {
        const cfg=settings(store.settings);cfg.agentAccess=value("enabled")==="on";if(!cfg.agentAccess)cfg.agentEpoch=(cfg.agentEpoch||0)+1;
        await prisma.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg)}});
        await log(store.id,cfg.agentAccess?"Agent access switched on":"Agent access switched off",{actor});
        return data({ok:true,message:cfg.agentAccess?'Agent access is on.':'Agent access is off and existing sessions are revoked.'});
      }
      case "agentLink": {
        const {mintLink}=await import("./agent.server");
        return data({ok:true,url:await mintLink(store.id,actor),message:'Agent workspace link ready. It expires in 15 minutes; the session it opens lasts 2 hours.'});
      }
      case "reject": {
        const updated = await prisma.change.updateMany({
          where: { id: value("id"), storeId: store.id, status: "pending" },
          data: { status: "rejected" },
        });
        if (!updated.count) throw new Error("Change already reviewed");
        await log(store.id, "Change rejected", {
          changeId: value("id"),
          actor, resourceId:(await prisma.change.findFirst({where:{id:value("id"),storeId:store.id}}))?.resourceId, reason:value('reason').slice(0,500)||'No reason supplied',
        });
        return data({ok:true,message:"Proposal rejected. Shopify content was not changed."});
      }
      case "rollbackBatch": {
        if(value('confirmed')!=='yes')throw new Error('Review and confirm the dated set first.');
        const ids=z.array(z.string()).min(1).max(25).parse(JSON.parse(value('ids')));
        const rows=await prisma.change.findMany({where:{storeId:store.id,id:{in:ids},status:'applied'},orderBy:{appliedAt:'desc'}});
        if(rows.length!==new Set(ids).size)throw new Error('A selected change is no longer available to undo. Reload the history.');
        const unique=new Set(rows.map(r=>r.resourceId+':'+r.feature));if(unique.size!==rows.length)throw new Error('This set has multiple edits to the same field. Undo the latest edit individually first, then review the remaining set.');
        for(const c of rows)await enqueue(store.id,'rollback',{changeId:c.id},c.id);
        await log(store.id,'Dated undo set queued',{ids,actor});
        return data({ok:true,message:`${plural(rows.length,'change')} queued for undo. Each current value is checked before restoration.`});
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
      case "extractFactsCsv": {
        const rows=await prisma.resource.findMany({where:{storeId:store.id,kind:'product'},orderBy:{title:'asc'},take:500});
        const keys=['dimensions','weight','capacity','materials','power','compatibility','included','care'];
        const quote=(v:string)=>'"'+v.replaceAll('"','""')+'"';
        const extracted=rows.map(r=>({r,facts:extractFacts(JSON.parse(r.payload))})).filter(x=>Object.keys(x.facts).length);
        if(!extracted.length)return data({ok:false,message:'No clearly labelled specifications were found. Add a supplier spreadsheet instead; no details were guessed.'});
        const csv=[['handle',...keys,...keys.map(k=>k+'_source')].map(quote).join(','),...extracted.map(({r,facts})=>[r.handle,...keys.map(k=>facts[k]?.value||''),...keys.map(k=>facts[k]?.source||'')].map(quote).join(','))].join('\n');
        const plan=previewFactImport(csv,rows);
        const core=['dimensions','weight','materials','included'];
        const confirmed=rows.reduce((n,r)=>n+core.filter(k=>{const f=JSON.parse(r.facts)[k];return f?.confirmed&&f.value&&f.source;}).length,0);
        const possible=plan.reduce((n,r)=>n+core.filter(k=>r.facts[k]?.value&&r.facts[k]?.source&&!r.facts[k]?.confirmed).length,0);
        return data({ok:true,csv,factImport:plan,message:`Preview for ${plural(plan.length,'product')}: ${rows.length?Math.round(100*confirmed/(rows.length*4)):0}% confirmed core facts now; up to ${rows.length?Math.round(100*(confirmed+possible)/(rows.length*4)):0}% if you independently check and confirm every extracted core fact. Importing alone does not confirm facts or publish content.`});
      }
      case "suggestFacts": {
        const r=await prisma.resource.findFirstOrThrow({where:{id:value('id'),storeId:store.id}});
        const payload=JSON.parse(r.payload);
        // Release 18: wider rule reader, then a grounded AI pass for empty fields when OpenAI is connected.
        const {suggestSpecs,aiAvailable}=await import('./spec-review.server');
        const useAi=r.kind==='product'&&await aiAvailable(store.id);
        const {suggestions,aiNote}=await suggestSpecs(store.id,payload,JSON.parse(r.facts||'{}'),useAi);
        const factSuggestions=Object.fromEntries(suggestions.map(s=>[s.key,{value:s.value,source:s.source,confirmed:false}]));
        const fromAi=suggestions.filter(s=>s.method==='ai').length;
        return data({ok:true,message:`Suggestions read from the product description${fromAi?` (${fromAi} by AI, each quote checked against the description)`:''}. Review them before confirming.${aiNote?` AI reading unavailable: ${aiNote}`:''}`,factResourceId:r.id,factSuggestions,keywordSuggestion:keywordFor(payload,r.kind)});
      }
      case "fillSpecs": {
        const ai=f.get('ai')==='on';
        if(ai){const {aiAvailable}=await import('./spec-review.server');if(!await aiAvailable(store.id))return data({ok:false,message:'Connect an OpenAI key in Settings to use AI reading, or run without it.'});}
        await enqueue(store.id,'spec-fill',{ai},`spec-fill-${Date.now()}`);
        await log(store.id,'Specification fill queued',{ai,actor});
        return data({ok:true,message:'Reading product descriptions. Suggestions appear below as they are found; nothing is confirmed or published.'});
      }
      case "confirmSpecs":
      case "discardSpecs": {
        const {confirmAllSpecs,discardSpecs}=await import('./spec-review.server');
        const keys=intent==='confirmSpecs'?z.array(z.string()).min(1,'Tick the values you have checked.').parse(JSON.parse(value('keys')||'[]')):undefined;
        const n=intent==='confirmSpecs'?await confirmAllSpecs(store.id,value('id'),keys):await discardSpecs(store.id,value('id'));
        const replaced=n?(await prisma.change.updateMany({where:{storeId:store.id,resourceId:value('id'),status:'pending',feature:{in:['description','faq','seo','title']}},data:{status:'superseded'}})).count:0;
        await refreshCatalogueAudit(store.id);
        await log(store.id,intent==='confirmSpecs'?'Product facts confirmed in bulk review':'Unconfirmed suggestions discarded',{resourceId:value('id'),count:n,actor});
        return data({ok:true,message:intent==='confirmSpecs'?`${plural(n,'fact')} confirmed.${replaced?` ${plural(replaced,'waiting proposal')} replaced; prepare ${replaced===1?'it':'them'} again to use the confirmed facts.`:''}`:`${plural(n,'suggestion')} discarded.`});
      }
      case 'previewFactsImport':
      case 'importFacts': {
        const csv=value('csv');
        const resources=await prisma.resource.findMany({where:{storeId:store.id,kind:'product'}});
        const plan=previewFactImport(csv,resources);
        if(intent==='previewFactsImport')return data({ok:true,message:`Matched ${plural(plan.length,'product')}. Nothing saved yet. Confirmed facts will be kept.${plan.some(r=>r.kept?.length)?` ${plural(plan.reduce((n,r)=>n+(r.kept?.length||0),0),'existing value')} differ from the file and will be kept; edit them in Product details if the file is right.`:''}`,factImport:plan,csv});
        // Recompute inside the transaction so facts verified after preview are protected.
        const count=await prisma.$transaction(async tx=>{
          const current=await tx.resource.findMany({where:{storeId:store.id,kind:'product'}});
          const fresh=previewFactImport(csv,current).filter(r=>r.count>0);
          for(const item of fresh)await tx.resource.update({where:{id:item.id},data:{facts:JSON.stringify(item.facts)}});
          return fresh.reduce((total,item)=>total+item.count,0);
        });
        await refreshCatalogueAudit(store.id);
        await log(store.id,'Unconfirmed sourced facts imported',{count,actor});
        return data({ok:true,message:`Imported ${count} unconfirmed facts. Open Product details to check sources and confirm accurate values. No Shopify content was changed.`});
      }
      case "facts": {
        const r = await prisma.resource.findFirstOrThrow({
          where: { id: value("id"), storeId: store.id },
        });
        const facts: Record<string, unknown> = {};
        for (const k of [
          "dimensions",
          "weight",
          "capacity",
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
        // Release 18: keep the merchant's "no manufacturer barcode" confirmation, which has no form field.
        const previous=JSON.parse(r.facts||'{}');if(previous.barcode)facts.barcode=previous.barcode;
        await prisma.resource.update({
          where: { id: r.id },
          data: {
            facts: JSON.stringify(facts),
            // Release 19: a blank field never wipes the saved search phrase.
            keyword: z.string().max(200).parse(value("keyword").trim()||r.keyword),
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
          data: { keyword: z.string().max(200).parse(value("keyword").trim()||r.keyword) },
        });
        break;
      }
      case "settings": {
        const cfg = settings(store.settings);
        const oldPolicies=JSON.stringify(cfg.policies);
        cfg.autopilot = Object.fromEntries(features.map(k => [k, false]));
        cfg.titleBrandMode=z.enum(['preserve','omit','append']).parse(value('titleBrandMode') || 'preserve');
        cfg.titleBrand=z.string().max(60).parse(value('titleBrand').trim());
        if(cfg.titleBrandMode==='append' && !cfg.titleBrand)throw new Error('Enter the store brand to append.');
        cfg.brandVoice=z.string().max(1500).parse(value("brandVoice"));
        if(f.has("capsAllowlist"))cfg.capsAllowlist=[...new Set(value("capsAllowlist").split(/[,\n]/).map(w=>w.trim().toUpperCase()).filter(w=>/^[A-Z0-9-]{2,30}$/.test(w)))].slice(0,200);
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
