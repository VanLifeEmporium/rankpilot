import {load as loadHtml} from 'cheerio';
import {z} from "zod";
import type {Change} from "@prisma/client";
import {validateProposalValue} from "./proposal-value";
import {catalogueCodes} from "./finding-workflow";
import { redirectAction } from "./redirects";
import { generateCopy, generateAlts, generateArticle } from "./generation.server";
import { updateInlineAlts } from "./image-content";
import { createHash, randomUUID } from "node:crypto";
import prisma from "../db.server";
import {
  auditCatalogue,
  cleanTitle,
  extractFacts,
  keywordFor,
  optimise,
  topics,
} from "./catalogue";
import {
  type Payload,
  type Feature,
  type Facts,
  settings,
  slug,
} from "./types";
import {
  allNodes,
  hydrateProduct,
  normalise,
  graphql,
  operations,
  fetchResource,
  updateResource,
  type GraphQL,
} from "./shopify-api.server";
import { crawlStore, publicFetch } from "./crawl.server";
import { metricPair } from "./analytics";
import {
  collectAnalytics,
  trackVisibility,
  pageSpeed,
} from "./integrations.server";
export const log = (storeId: string, message: string, detail: unknown = {}) =>
  prisma.event.create({
    data: { storeId, message, detail: JSON.stringify(detail) },
  });
export async function enqueue(
  storeId: string,
  kind: string,
  payload: unknown = {},
  dedup: string = randomUUID(),
) {
  return prisma.job.upsert({
    where: { dedup: `${storeId}:${kind}:${dedup}` },
    create: {
      storeId,
      kind,
      payload: JSON.stringify(payload),
      dedup: `${storeId}:${kind}:${dedup}`,
    },
    update: {},
  });
}
export async function enqueueGeneration(storeId:string, ids:string[], feature:Feature, regenerate=false) {
 const resources=await prisma.resource.findMany({where:{storeId,id:{in:ids}},orderBy:{id:'asc'}});
 if(resources.length!==new Set(ids).size) throw new Error('Resource selection is invalid');
 const store=await prisma.store.findUniqueOrThrow({where:{id:storeId}});
 const policy=settings(store.settings).policies;
 const fingerprint=createHash('sha256').update(JSON.stringify({version:6,feature,titleBrandMode:settings(store.settings).titleBrandMode,titleBrand:settings(store.settings).titleBrand,policy:feature==='faq'?policy:undefined,resources:resources.map(r=>[r.id,r.payload,r.facts])})).digest('hex');
 const job=await enqueue(storeId,'optimise',{ids:[...new Set(ids)],feature},fingerprint);
 const result=JSON.parse(job.payload).result;
 const changeIds=Array.isArray(result)?result.map((r:{changeId?:string})=>r.changeId).filter((id):id is string=>Boolean(id)):[];
 const existingChanges=changeIds.length?await prisma.change.findMany({where:{storeId,id:{in:changeIds}}}):[];
 const obsolete=existingChanges.some(c=>['rejected','superseded','rolled_back','conflict'].includes(c.status)) || (changeIds.length>existingChanges.length);
 const failedResult=Array.isArray(result) && result.some(r=>r && typeof r==='object' && typeof r.error==='string');
 if((regenerate || obsolete || failedResult || job.status==='failed') && ['completed','failed'].includes(job.status)) {
  await prisma.job.updateMany({where:{id:job.id,status:{in:['completed','failed']}},data:{status:'queued',attempts:0,runAt:new Date(),error:null,payload:JSON.stringify({ids:[...new Set(ids)],feature})}});
  return prisma.job.findUniqueOrThrow({where:{id:job.id}});
 }
 return job;
}
export async function refreshCatalogueAudit(storeId:string) {
 const latest=await prisma.audit.findFirst({where:{storeId},orderBy:{createdAt:'desc'}});
 if(!latest) return;
 const resources=await prisma.resource.findMany({where:{storeId,kind:{in:['product','collection','page','article']}}});
 const checked=auditCatalogue(resources);
 const retained=JSON.parse(latest.issues).filter((i:{code:string})=>!catalogueCodes.has(i.code));
 await prisma.audit.update({where:{id:latest.id},data:{score:checked.score,aeoScore:checked.aeoScore,resourceCount:resources.length,issues:JSON.stringify([...checked.issues,...retained]),coverage:JSON.stringify({...JSON.parse(latest.coverage),catalogueRecheckedAt:new Date().toISOString()})}});
}
export function sameField(actual:unknown,expected:unknown):boolean {
 if(Array.isArray(actual) && Array.isArray(expected)) {
  if(actual.length!==expected.length)return false;
  if(expected.every(v=>v && typeof v==='object' && typeof v.id==='string'))
   return expected.every(v=>sameField(actual.find(a=>a?.id===v.id),v));
  return actual.every((v,i)=>sameField(v,expected[i]));
 }
 if(actual && expected && typeof actual==='object' && typeof expected==='object') {
  const keys=Object.keys(expected);return keys.length===Object.keys(actual).length && keys.every(k=>sameField((actual as Record<string,unknown>)[k],(expected as Record<string,unknown>)[k]));
 }
 return actual===expected;
}
// Compare display-equivalent metadata only. Preserve punctuation, numbers and case.
export function matchesField(actual:unknown, expected:unknown, feature:string):boolean {
 if(feature!=='seo')return sameField(actual,expected);
 const normal=(value:unknown)=>typeof value==='string'?loadHtml('<textarea></textarea>')('textarea').html(value).text().normalize('NFC').replace(/\s+/gu,' ').trim():value;
 if(!actual || !expected || typeof actual!=='object' || typeof expected!=='object')return false;
 return ['title','description'].every(k=>normal((actual as Record<string,unknown>)[k])===normal((expected as Record<string,unknown>)[k]));
}
export async function clientFor(storeId: string): Promise<GraphQL | null> {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  if (!store.active) throw new Error("Store is uninstalled");
  if (store.demo) return null;
  const { unauthenticated } = await import("../shopify.server");
  const { admin } = await unauthenticated.admin(storeId);
  return async (query,options) => {
    const active=await prisma.store.findUnique({where:{id:storeId},select:{active:true}});
    if(!active?.active) throw new Error('Store is uninstalled; work cancelled');
    return admin.graphql(query,options);
  };
}
export function fieldValue(p: Payload, feature: string) {
  switch (feature) {
    case "title":
      return p.title;
    case "seo":
      return p.seo;
    case "handle":
      return p.handle;
    case "description":
    case "links":
      return p.descriptionHtml;
    case "faq":
      return p.faqs || [];
    case "alt":
      return p.images.map(({ id, alt }) => ({ id, alt }));
    case "filename":
      return p.images.map(({ id, filename }) => ({ id, filename }));
    default:
      throw new Error("Unknown feature");
  }
}
export function withField(p:Payload,feature:string,value:unknown):Payload {
 const next=structuredClone(p);
 if(['description','links'].includes(feature))next.descriptionHtml=z.string().parse(value);
 else if(feature==='faq')next.faqs=z.array(z.object({question:z.string(),answer:z.string()})).parse(value);
 else if(feature==='seo')next.seo=z.object({title:z.string(),description:z.string()}).parse(value);
 else if(feature==='title')next.title=z.string().parse(value);
 else if(feature==='handle')next.handle=z.string().parse(value);
 else if(feature==='alt'){
  const alts=z.array(z.object({id:z.string(),alt:z.string()})).parse(value);
  next.images=next.images.map(i=>({...i,...alts.find(v=>v.id===i.id)}));
  next.descriptionHtml=updateInlineAlts(next.descriptionHtml,alts);
 }else if(feature==='filename'){
  const files=z.array(z.object({id:z.string(),filename:z.string()})).parse(value);
  next.images=next.images.map(i=>({...i,...files.find(v=>v.id===i.id)}));
 }else throw new Error('Unknown field');
 return next;
}
export async function sync(storeId: string, productId?: string) {
  const client = await clientFor(storeId);
  if (!client) return;
  if (!productId) {
    const d = await graphql(client, operations.shop);
    if (d.shop.currencyCode !== "GBP")
      throw new Error(
        "RankPilot is configured for GBP. Check the store before proceeding.",
      );
    const s = await prisma.store.findUniqueOrThrow({ where: { id: storeId } });
    const discovery = JSON.parse(s.discoveries);
    await prisma.store.update({
      where: { id: storeId },
      data: {
        domain: d.shop.primaryDomain.url,
        discoveries: JSON.stringify({
          ...discovery,
          shop: d.shop,
          blogs: d.blogs.nodes,
        }),
      },
    });
  }
  const kinds: ("products"|"collections"|"pages"|"articles")[] = productId
    ? ["products"]
    : ["products", "collections", "pages", "articles"];
  for (const plural of kinds) {
    const kind =
      plural.slice(0, -1) === "categorie" ? "category" : plural.slice(0, -1);
    if (productId) {
      const p = await fetchResource(client, productId, "product");
      await saveResource(storeId, productId, "product", p);
      continue;
    }
    const nodes = await allNodes(client, plural);
    for (const node of nodes) {
      if (kind === "product") await hydrateProduct(client, node);
      await saveResource(storeId, node.id, kind, normalise(node, kind));
    }
    await prisma.resource.deleteMany({
      where: { storeId, kind, remoteId: { notIn: nodes.map((n) => n.id) } },
    });
  }
  await log(storeId, "Catalogue synchronised", {
    scope: productId || "all resources",
  });
}
async function saveResource(
  storeId: string,
  remoteId: string,
  kind: string,
  p: Payload,
) {
  const existing = await prisma.resource.findUnique({
    where: { storeId_remoteId: { storeId, remoteId } },
  });
  const changed =
    existing &&
    JSON.stringify(JSON.parse(existing.payload)) !== JSON.stringify(p);
  let facts: Facts = existing ? JSON.parse(existing.facts) : extractFacts(p);
  // Supplier updates invalidate confirmation, except when the new field matches an app-applied change.
  if (
    changed &&
    JSON.parse(existing!.payload).descriptionHtml !== p.descriptionHtml
  ) {
    const applied = await prisma.change.findFirst({
      where: {
        storeId,
        resourceId: existing!.id,
        feature: { in: ["description", "links"] },
        status: "applied",
      },
      orderBy: { appliedAt: "desc" },
    });
    if (!applied || JSON.parse(applied.after) !== p.descriptionHtml)
      facts = Object.fromEntries(
        Object.entries(facts).map(([k, v]) => [k, { ...v, confirmed: false }]),
      );
  }
  return prisma.resource.upsert({
    where: { storeId_remoteId: { storeId, remoteId } },
    create: {
      storeId,
      remoteId,
      kind,
      title: p.title,
      handle: p.handle,
      collection: p.collections[0] || "",
      payload: JSON.stringify(p),
      facts: JSON.stringify(facts),
      keyword: keywordFor(p, kind),
    },
    update: {
      title: p.title,
      handle: p.handle,
      collection: p.collections[0] || "",
      payload: JSON.stringify(p),
      facts: JSON.stringify(facts),
    },
  });
}
export async function audit(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  const resources = await prisma.resource.findMany({
    where: {
      storeId,
      kind: { in: ["product", "collection", "page", "article"] },
    },
  });
  const result = auditCatalogue(resources);
  let coverage: Record<string,unknown> = {
    catalogue: resources.length,
    storefront: 0,
    externalLinks: "Not scanned",
    supplierCopy: "Heuristic only",
    score: "Catalogue checks only; not a search-engine ranking score",
    aeoScore: "Percentage of four core product facts confirmed",
  };
  if (!store.demo) {
    const crawl = await crawlStore(
      store.domain,
      resources,
      settings(store.settings).crawlLimit,
    );
    result.issues.push(...crawl.issues);
    await prisma.store.update({
      where: { id: storeId },
      data: {
        discoveries: JSON.stringify({
          ...JSON.parse(store.discoveries),
          ...crawl.discoveries,
        }),
      },
    });
    coverage = {
      ...coverage,
      storefront: crawl.discoveries.scanned,
      crawlLimit: settings(store.settings).crawlLimit,
      errors: crawl.discoveries.errors,
    };
  } else
    coverage.demo =
      "Sample data. Live HTML, links, schema and template performance are not assessed.";
  const row = await prisma.audit.create({
    data: {
      storeId,
      score: result.score,
      aeoScore: result.aeoScore,
      resourceCount: resources.length,
      issues: JSON.stringify(result.issues),
      coverage: JSON.stringify(coverage),
    },
  });
  await log(storeId, "Audit completed", {
    score: result.score,
    issues: result.issues.length,
  });
  return row;
}
export async function propose(
  storeId: string,
  resourceId: string,
  feature: Feature,
  outcome?: {message?:string},
) {
  const resource = await prisma.resource.findFirstOrThrow({
    where: { id: resourceId, storeId },
  });
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  const cfg = settings(store.settings);
  const p: Payload = JSON.parse(resource.payload);
  if (
    ["filename", "faq"].includes(feature) &&
    resource.kind !== "product"
  )
    throw new Error("This feature currently applies to product resources");
  const pending = await prisma.change.findFirst({
    where: {
      storeId,
      resourceId,
      feature,
      status: { in: ["pending", "approved", "applying"] },
    },
  });
  if (pending) {
    const reasons:string[]=JSON.parse(pending.reasons);
    const outdated = ((feature === "seo" || feature === "title") && ((t:string)=>!t || t.split(/\s+/u).length>5 || t.length>60)(String(feature === "seo" ? JSON.parse(pending.after).title : JSON.parse(pending.after)).trim())) || (["seo","description"].includes(feature) && !reasons.some(trustedSourceReview)) || (feature === "alt" && !reasons.some(r=>r.startsWith("image-reviewed-v1:")));
    if(pending.status !== "pending" || (!outdated && sameField(JSON.parse(pending.before),fieldValue(p,feature)))) return pending;
    // Keep this draft visible until a reviewed replacement is safely stored.
  }
  const related = await prisma.resource.findMany({
    where: {
      storeId,
      collection: resource.collection,
      id: { not: resource.id },
      kind: { in: ["product", "collection"] },
    },
    take: 3,
  });
  const proposal = feature === "title" && (cleanTitle(p.title).split(/\s+/u).length > 5 || cleanTitle(p.title).length>60)
    ? await generateCopy(storeId,{...p,seo:{title:p.title,description:p.seo.description}},resource.kind,"seo",JSON.parse(resource.facts),cfg).then(result=>({...result,before:p.title,after:(result.after as Payload["seo"]).title}))
    : feature === "description" || feature === "seo"
    ? await generateCopy(storeId, p, resource.kind, feature, JSON.parse(resource.facts),cfg)
    : feature === "alt" ? await generateAlts(storeId, p, {
      get:async(id,url)=>{const key=createHash('sha256').update(JSON.stringify([storeId,id,url,'alt-v5'])).digest('hex');const row=await prisma.generationCache.findUnique({where:{key}});return row && Date.now()-row.createdAt.getTime()<30*86400000?row.value:null;},
      set:async(id,url,value)=>{const key=createHash('sha256').update(JSON.stringify([storeId,id,url,'alt-v5'])).digest('hex');await prisma.generationCache.upsert({where:{key},create:{key,storeId,value},update:{value,createdAt:new Date()}});}
    }) : optimise(
    p,
    resource.kind,
    feature,
    JSON.parse(resource.facts),
    resource.keyword,
    cfg,
    related.map((r) => ({ title: r.title, url: `/${r.kind}s/${r.handle}` })),
  );
  if (proposal.blockers.length && JSON.stringify(proposal.before) === JSON.stringify(proposal.after))
    throw new Error(proposal.blockers.join(" "));
  if (JSON.stringify(proposal.before) === JSON.stringify(proposal.after)) {
    if(outcome) outcome.message='No change created. '+(proposal.reasons.join(' ') || 'Existing content retained.');
    return null;
  }
  const row = await prisma.change.create({
    data: {
      storeId,
      resourceId,
      feature,
      before: JSON.stringify(proposal.before),
      after: JSON.stringify(proposal.after),
      blockers: JSON.stringify(proposal.blockers),
      reasons: JSON.stringify(proposal.reasons),
    },
  });
  if(pending?.status==='pending') await prisma.change.updateMany({where:{id:pending.id,status:'pending'},data:{status:'superseded',error:`Replaced by reviewed proposal ${row.id}`}});
  // Approval-only while content and storefront remediation is being verified.
  return row;
}
export const trustedSourceReview=(reason:string)=>reason.startsWith('source-reviewed-v1:') && !reason.startsWith('source-reviewed-v1: The existing Shopify page title');
export function assertSafeCopy(feature: string, before: unknown, after: unknown, reasons: string[] = []) {
  const invalid=validateProposalValue(feature,after);if(invalid)throw new Error(invalid);
  const beforeMeta=before as Record<string,unknown>|null;const afterMeta=after as Record<string,unknown>|null;
  if (["title","seo"].includes(feature)) { const title=String(feature === "seo" ? afterMeta?.title || "" : after || "").trim(); if(!title || title.split(/\s+/u).length>5 || title.length>60) throw new Error("Regenerate this proposal: titles must be at most five words and 60 characters."); }
  if (feature === "alt" && !reasons.some(r => r.startsWith("image-reviewed-v1:")))
    throw new Error("Regenerate this image proposal from the actual image before approval.");
  if (reasons.some(trustedSourceReview)) return;
  if (feature === "description")
    throw new Error("Description replacement is paused. Existing content is protected; reject this proposal.");
  if (feature === "seo" && ["title", "description"].some(key =>
    String(beforeMeta?.[key] || "").trim() && beforeMeta?.[key] !== afterMeta?.[key]))
    throw new Error("This proposal replaces existing metadata. Reject it and regenerate using the content safeguards.");
}
export async function approve(storeId: string, id: string, actor: string) {
  const row = await prisma.change.findFirstOrThrow({ where: { id, storeId } });
  assertSafeCopy(row.feature, JSON.parse(row.before), JSON.parse(row.after), JSON.parse(row.reasons));
  if (row.status !== "pending")
    throw new Error("This change is no longer awaiting approval");
  if (JSON.parse(row.blockers).length)
    throw new Error("Resolve missing facts and regenerate this preview first");
  await prisma.$transaction(async (tx) => {
    const other=await tx.change.findFirst({where:{storeId,resourceId:row.resourceId,id:{not:id},status:{in:['approved','applying','rolling_back']}}});
    if(other)throw new Error('Another update is applying to this page. Wait for verification, then accept this preview.');
    const claimed = await tx.change.updateMany({
      where: { id, storeId, status: "pending" },
      data: { status: "approved", approvedBy: actor },
    });
    if (!claimed.count) throw new Error("Change already reviewed");
    await tx.job.create({
      data: {
        storeId,
        kind: "apply",
        payload: JSON.stringify({ changeId: id }),
        dedup: `${storeId}:apply:${id}`,
      },
    });
  });
  await log(storeId, "Change approved", { changeId: id, actor });
}
export function compatibleState(
  actual: unknown,
  before: unknown,
  after: unknown,
  feature: string,
) {
  if (feature === "alt" || feature === "filename")
    return (
      Array.isArray(actual) && Array.isArray(before) && Array.isArray(after) &&
      actual.length === before.length &&
      actual.every((item: {id:string}) =>
        [
          before.find((v: {id:string}) => v.id === item.id),
          after.find((v: {id:string}) => v.id === item.id),
        ].some((v) => sameField(v,item)),
      )
    );
  return (
    matchesField(actual,before,feature) || matchesField(actual,after,feature)
  );
}
export async function applyChange(
  storeId: string,
  id: string,
  rollback = false,
) {
  const change = await prisma.change.findFirstOrThrow({
    where: { id, storeId },
  });
  if (
    rollback &&
    change.status !== "applied" &&
    change.status !== "rolling_back"
  )
    throw new Error("Only applied changes can be rolled back");
  if (!rollback && !["approved", "applying", "apply_failed", "verification_failed"].includes(change.status)) return;
  if (change.feature === "redirect")
    return applyRedirect(storeId, change, rollback);
  if (change.feature === "draft")
    return rollback ? rollbackDraft(storeId, change, true) : applyDraft(storeId,change);
  const r = await prisma.resource.findFirstOrThrow({
    where: { id: change.resourceId, storeId },
  });
  const client = await clientFor(storeId);
  const p = client
    ? await fetchResource(client, r.remoteId, r.kind)
    : JSON.parse(r.payload);
  const before = JSON.parse(rollback ? change.after : change.before),
    after = JSON.parse(rollback ? change.before : change.after);
  if (!rollback) assertSafeCopy(change.feature, before, after, JSON.parse(change.reasons));
  const actual = fieldValue(p, change.feature);
  if (!compatibleState(actual, before, after, change.feature)) {
    await prisma.change.update({
      where: { id },
      data: {
        status: rollback ? "applied" : "conflict",
        error:
          "The resource changed after this preview. Refresh and review again.",
      },
    });
    throw new Error("Conflict: refusing to overwrite newer edits");
  }
  await prisma.change.update({
    where: { id },
    data: { status: rollback ? "rolling_back" : "applying", error: null },
  });
  if (!matchesField(actual,after,change.feature) && client) {
    // Shopify may already have a redirect at the destination of a rollback. Remove only an exact app-created inverse.
    if (change.feature === "handle" && rollback) {
      const path = `/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${after}`;
      const redirects = await graphql(client, operations.redirectLookup, {
        query: `path:${path}`,
      });
      for (const redirect of redirects.urlRedirects.nodes) {
        if (
          redirect.path === path &&
          redirect.target ===
            `/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${before}`
        )
          await graphql(client, operations.redirectDelete, { id: redirect.id });
      }
    }
    await updateResource(client, r.remoteId, r.kind, change.feature, after);
  }
  // Read back from Shopify; never manufacture a successful local snapshot.
  let next = client ? await fetchResource(client, r.remoteId, r.kind) : withField(p, change.feature, after);
  // A successful mutation can precede the readable value. Retry reads, never writes.
  for(const delay of [250,750]) {
    if(matchesField(fieldValue(next,change.feature),after,change.feature) || !client)break;
    await new Promise(resolve=>setTimeout(resolve,delay));
    next=await fetchResource(client,r.remoteId,r.kind);
  }
  if(!matchesField(fieldValue(next,change.feature),after,change.feature)) {
    await prisma.change.update({where:{id},data:{status:'verification_failed',error:'The saved value is not confirmed yet. The update may have saved. Use Verify in Shopify before retrying; no additional write is needed to check.'}});
    throw new Error('Verification failed: the saved value is not confirmed yet.');
  }
  await prisma.$transaction([
    prisma.resource.update({
      where: { id: r.id },
      data: {
        payload: JSON.stringify(next),
        title: next.title,
        handle: next.handle,
      },
    }),
    prisma.change.update({
      where: { id },
      data: {
        status: rollback ? "rolled_back" : "applied",
        appliedAt: rollback ? change.appliedAt : new Date(),
        error: null,
      },
    }),
  ]);
  await refreshCatalogueAudit(storeId);
  await log(storeId, rollback ? "Change rolled back" : "Change applied and verified", {
    changeId: id,
    feature: change.feature,
    title: r.title,
    demo: !client,
  });
}
export async function verifyChange(storeId:string,id:string) {
 const change=await prisma.change.findFirstOrThrow({where:{id,storeId}});
 if(!change.approvedBy || !['applied','approved','applying','apply_failed','verification_failed','conflict'].includes(change.status))throw new Error('Only accepted changes can be verified.');
 if(['draft','redirect'].includes(change.feature))throw new Error('Live verification currently supports page and product fields.');
 const resource=await prisma.resource.findFirstOrThrow({where:{id:change.resourceId,storeId}});
 const client=await clientFor(storeId);
 if(!client)throw new Error('Live Shopify verification is unavailable in demo mode.');
 const live=await fetchResource(client,resource.remoteId,resource.kind);
 if(!matchesField(fieldValue(live,change.feature),JSON.parse(change.after),change.feature))return {ok:false,message:'The live Shopify value differs from this accepted proposal. No content was changed. Review Shopify before retrying.'};
 await prisma.$transaction([
  prisma.resource.update({where:{id:resource.id},data:{payload:JSON.stringify(live),title:live.title,handle:live.handle}}),
  prisma.change.update({where:{id},data:{status:'applied',appliedAt:change.appliedAt || new Date(),error:null}}),
  prisma.job.updateMany({where:{storeId,kind:'apply',dedup:`${storeId}:apply:${id}`,status:{in:['failed','queued']}},data:{status:'completed',error:null,lockedAt:null}})
 ]);
 await refreshCatalogueAudit(storeId);
 await log(storeId,'Live Shopify value verified',{changeId:id});
 return {ok:true,message:'Verified against live Shopify. The accepted value is saved; no additional write was made.'};
}
export async function createDraft(
  storeId: string,
  title: string,
  jobId: string,
) {
  if (!topics.includes(title)) throw new Error("Select a content-plan topic");
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  const products = await prisma.resource.findMany({
    where: { storeId, kind: "product" },
  });
  const terms = /power/i.test(title) ? /power|solar|battery|off.grid|12v/i : /kitchen/i.test(title) ? /kitchen|cook|stove|mug|kettle|pan|utensil/i : /gift/i.test(title) ? /signature|wood.print|art|gift/i : /warm|winter/i.test(title) ? /blanket|insulat|curtain|winter|warm/i : /interior|storage|basket|cushion|curtain|decor/i;
  const relevant = products.filter(r=>{
    const p:Payload=JSON.parse(r.payload);
    return terms.test([p.title,...p.collections].join(' '));
  }).slice(0,6);
  const job = await prisma.job.findFirst({where:{id:jobId,storeId}});
  const jobPayload = job ? JSON.parse(job.payload) : {};
  const saved = await prisma.resource.findUnique({where:{storeId_remoteId:{storeId,remoteId:`draft-${jobId}`}}});
  const body = jobPayload.draftBody || (saved && JSON.parse(saved.payload).descriptionHtml) || await generateArticle(storeId,title,relevant.map(r=>JSON.parse(r.payload)));
  if(job && !jobPayload.draftBody) await prisma.job.update({where:{id:job.id},data:{payload:JSON.stringify({...jobPayload,draftBody:body})}});
  const draftHandle=slug(title)+'-'+jobId.slice(-6);
  const remoteId=`draft-${jobId}`;
  const cfg=settings(store.settings);
  const payload: Payload = {
    title,
    handle: draftHandle,
    descriptionHtml: body,
    seo: { title, description: "" },
    images: [],
    collections: [],
    published: false,
    blogId: cfg.blogId,
  };
  const resource = await saveResource(storeId, remoteId, "article", payload);
  let change=await prisma.change.findFirst({where:{storeId,resourceId:resource.id,feature:'draft'}});
  if(!change)change=await prisma.change.create({data:{storeId,resourceId:resource.id,feature:'draft',before:'null',after:JSON.stringify(payload),status:'pending',reasons:JSON.stringify(['Reviewed against catalogue sources. Accept to create an unpublished Shopify article.'])}});
  await log(storeId,'Article preview ready',{title,changeId:change.id});
  return [{changeId:change.id,message:'Article preview ready. Accept it to save an unpublished draft in Shopify.'}];
}
async function applyDraft(storeId:string,change:{id:string;resourceId:string;after:string}) {
 const resource=await prisma.resource.findFirstOrThrow({where:{id:change.resourceId,storeId}});
 const proposal:Payload=JSON.parse(change.after);
 const client=await clientFor(storeId);
 await prisma.change.update({where:{id:change.id},data:{status:'applying',error:null}});
 let remoteId=resource.remoteId;let actual=proposal;
 if(client){
  if(!proposal.blogId)throw new Error('Choose a blog in Settings and regenerate this draft.');
  const existing=await graphql(client,operations.draftLookup,{query:`handle:${proposal.handle}`});
  const match=existing.articles.nodes.find((a:{handle:string})=>a.handle===proposal.handle);
  if(match){
   if(match.body!==proposal.descriptionHtml || match.title!==proposal.title || match.isPublished)throw new Error('Conflict: an article already uses this draft address. No overwrite made.');
   remoteId=match.id;
  }else{
   const created=await graphql(client,operations.draft,{article:{blogId:proposal.blogId,handle:proposal.handle,title:proposal.title,body:proposal.descriptionHtml,isPublished:false,author:{name:'Van Life Emporium'},tags:['RankPilot draft','Manual verification required']}});
   remoteId=created.articleCreate.article.id;
  }
  actual=await fetchResource(client,remoteId,'article');
  if(actual.title!==proposal.title || actual.descriptionHtml!==proposal.descriptionHtml || actual.handle!==proposal.handle || actual.published || actual.blogId!==proposal.blogId)throw new Error('Verification failed: the saved article does not match the accepted unpublished draft.');
 }
 await prisma.$transaction([
  prisma.resource.update({where:{id:resource.id},data:{remoteId,payload:JSON.stringify(actual)}}),
  prisma.change.update({where:{id:change.id},data:{status:'applied',appliedAt:new Date(),error:null}}),
 ]);
 await log(storeId,'Article saved and verified as unpublished',{changeId:change.id,title:proposal.title});
}

export function llmsText(
  domain: string,
  resources: { kind: string; title: string; handle: string }[],
  config: ReturnType<typeof settings>,
) {
  return `# Van Life Emporium\n\n> Home is the road. Campervan, motorhome and outdoor products for shoppers in the UK.\n\n## Collections\n${resources
    .filter((r) => r.kind === "collection")
    .map((r) => `- [${r.title}](${domain}/collections/${r.handle})`)
    .join(
      "\n",
    )}\n\n## Signature\nThe brand's own wood print line, produced to order. Refer to individual product pages for verified specifications.\n\n## Delivery and returns\n${config.policies.delivery || "Delivery times have not been confirmed in RankPilot. Consult the store policy."}\n${config.policies.returns || "Consult the current returns policy before ordering."}\n${config.policies.source ? `Policy source: ${config.policies.source}` : ""}\n\nPrices and availability change. Read the live product page.\n`;
}
export async function weeklyReport(storeId: string) {
  const since = new Date(Date.now() - 7 * 86400000);
  const changes = await prisma.change.findMany({
    where: { storeId, appliedAt: { gte: since } },
  });
  const audits = await prisma.audit.findMany({
    where: { storeId },
    orderBy: { createdAt: "desc" },
    take: 2,
  });
  const observations = await prisma.observation.findMany({
    where: { storeId, createdAt: { gte: since } },
  });
  const metrics = await prisma.metric.findMany({ where: { storeId } });
  const markdown = `# RankPilot weekly report\n\nWeek ending ${new Date().toLocaleDateString("en-GB")}\n\n## Changes\n${changes.filter(c=>c.status==='applied').length} changes remain applied. ${changes.filter(c=>c.status==='rolled_back').length} changes were rolled back. ${changes.length} application events recorded this week.\n${changes.map((c) => `- ${c.feature}: ${c.status} (${c.id})`).join("\n")}\n\n## Visibility\nCatalogue SEO score: ${audits[0]?.score ?? "Not audited"}. Previous: ${audits[1]?.score ?? "No baseline"}.\nAI mention rate: ${observations.length ? Math.round((observations.filter((o) => o.mentioned).length / observations.length) * 100) + "% of " + observations.length + " samples" : "No observations"}. API samples are not consumer search rankings.\nAnalytics snapshots: ${metrics.length}. Changes in traffic do not establish causation.\n\n## Next priorities\n${
    audits[0]
      ? JSON.parse(audits[0].issues)
          .slice(0, 10)
          .map((i: {title:string;detail:string}) => `- ${i.title}: ${i.detail}`)
          .join("\n")
      : "Run the first audit."
  }\n`;
  return prisma.report.create({ data: { storeId, markdown } });
}
export async function requeueUnderperformers(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  if (!settings(store.settings).requeue) return;
  const snapshots = await prisma.metric.findMany({
    where: { storeId, provider: "gsc" },
    orderBy: { period: "desc" },
  });
  const pair = metricPair(snapshots, "gsc");
  if (pair.length < 2) return;
  const totals = (s: string) => {
    const map = new Map<string, { clicks: number; impressions: number }>();
    for (const row of JSON.parse(s).rows || []) {
      const p = row.keys[0];
      const v = map.get(p) || { clicks: 0, impressions: 0 };
      v.clicks += row.clicks;
      v.impressions += row.impressions;
      map.set(p, v);
    }
    return map;
  };
  const current = totals(JSON.stringify(pair[0])),
    previous = totals(JSON.stringify(pair[1]));
  const resources = await prisma.resource.findMany({ where: { storeId } });
  for (const [url, p] of previous) {
    const c = current.get(url);
    if (
      p.impressions < 100 ||
      p.clicks < 10 ||
      !c ||
      c.clicks > p.clicks * 0.75
    )
      continue;
    const resource = resources.find((r) =>
      new URL(url).pathname.endsWith("/" + r.handle),
    );
    if (!resource) continue;
    const recent = await prisma.change.findFirst({
      where: {
        storeId,
        resourceId: resource.id,
        createdAt: { gte: new Date(Date.now() - 28 * 86400000) },
      },
    });
    if (!recent) {
      await propose(storeId, resource.id, "seo");
      await log(storeId, "Underperforming page re-queued", {
        url,
        previousClicks: p.clicks,
        currentClicks: c.clicks,
      });
    }
  }
}
export async function executeJob(job: {
  id: string;
  storeId: string;
  kind: string;
  payload: string;
}, yieldAfterResource = false) {
  const p = JSON.parse(job.payload);
  switch (job.kind) {
    case "audit":
      await sync(job.storeId);
      return audit(job.storeId);
    case "optimise": {
      const results: {resourceId:string;changeId?:string;message?:string;error?:string}[] = Array.isArray(p.result) ? p.result : [];
      for (const id of p.ids) {
        if(results.some(r=>r.resourceId===id)) continue;
        try {
          const outcome:{message?:string}={};
          const change = await propose(job.storeId, id, p.feature, outcome);
          results.push({resourceId:id,changeId:change?.id,message:change ? "Proposal ready for review" : outcome.message || "No change needed; existing content retained"});
        } catch (e) {
          results.push({resourceId:id,error:e instanceof Error ? e.message : "Generation failed"});
        }
        await prisma.job.update({where:{id:job.id},data:{payload:JSON.stringify({...p,result:results})}});
        if(yieldAfterResource) break;
      }
      return results;
    }
    case "apply":
      return applyChange(job.storeId, p.changeId);
    case "rollback":
      return applyChange(job.storeId, p.changeId, true);
    case "webhook": {
      // Supplier webhooks refresh source data only. Paid generation requires a merchant action.
      await sync(job.storeId, p.productId);
      return;
    }
    case "draft":
      return createDraft(job.storeId, p.title, job.id);
    case "analytics":
      {
      const errors=await collectAnalytics(job.storeId);
      if(errors.length) return errors.map(error=>({error}));
      await requeueUnderperformers(job.storeId);
      return [{message:'Connected analytics refreshed.'}];
      }
    case "visibility":
      return trackVisibility(job.storeId);
    case "pagespeed":
      return pageSpeed(job.storeId, p.url);
    case "refresh-audit":
      return refreshCatalogueAudit(job.storeId);
    case "report":
      return weeklyReport(job.storeId);
    default:
      throw new Error("Unknown job type");
  }
}
export async function tick(options:{lane?:'apply'|'background';jobId?:string}={}) {
  const cutoff = new Date(Date.now() - 5 * 60000);
  await prisma.job.updateMany({
    where: { status: "running", lockedAt: { lt: cutoff } },
    data: { status: "queued", lockedAt: null },
  });
  await prisma.job.updateMany({where:{status:"queued",attempts:{gte:5}},data:{status:"failed",lockedAt:null,error:"Job stopped after repeated interruptions. Review completed results before retrying."}});
  const filter={status:'queued',runAt:{lte:new Date()},attempts:{lt:5},...(options.jobId?{id:options.jobId}:{}),...(options.lane?{kind:options.lane==='apply'?{in:['apply','rollback']}:{notIn:['apply','rollback']}}:{})};
  const priority=options.lane==='background'?null:await prisma.job.findFirst({where:{...filter,kind:{in:['apply','rollback']}},orderBy:{createdAt:'asc'}});
  const next=priority || await prisma.job.findFirst({where:filter,orderBy:{createdAt:'asc'}});
  if (!next) return false;
  const claimed = await prisma.job.updateMany({
    where: { id: next.id, status: "queued" },
    data: {
      status: "running",
      lockedAt: new Date(),
      attempts: { increment: 1 },
    },
  });
  if (!claimed.count) return true;
  const heartbeat = setInterval(
    () =>
      void prisma.job
        .updateMany({
          where: { id: next.id, status: "running" },
          data: { lockedAt: new Date() },
        })
        .catch(() => {}),
    30000,
  );
  try {
    const active=await prisma.store.findUnique({where:{id:next.storeId},select:{active:true}});
    if(!active?.active) {await prisma.job.updateMany({where:{id:next.id,status:'running'},data:{status:'cancelled',lockedAt:null}});return true;}
    const result = await executeJob(next, true);
    const payload=JSON.parse((await prisma.job.findUniqueOrThrow({where:{id:next.id}})).payload);
    const unfinished=next.kind === "optimise" && Array.isArray(result) && result.length < payload.ids.length;
    await prisma.job.updateMany({
      where: { id: next.id, status:"running" },
      data: { status: unfinished ? "queued" : "completed", attempts:0, lockedAt: null, error: null, payload: JSON.stringify({...payload, result}) },
    });
  } catch (e) {
    const error = e instanceof Error ? e.message : "Job failed";
    const terminal =
      next.attempts >= 3 || ['draft','visibility'].includes(next.kind) || /Verification failed|Needs manual review/.test(error) ||
      /Conflict|Confirm|Select|Choose|Connect|requires|No AI|Only|longer|credentials/i.test(
        error,
      );
    await prisma.job.updateMany({
      where: { id: next.id, status:"running" },
      data: {
        status: terminal ? "failed" : "queued",
        lockedAt: null,
        error,
        runAt: new Date(
          Date.now() + Math.min(60000, 2000 * 2 ** next.attempts),
        ),
      },
    });
    if(['apply','rollback'].includes(next.kind)) {
      const changeId=JSON.parse(next.payload).changeId;
      await prisma.change.updateMany({where:{id:changeId,storeId:next.storeId,status:{in:['approved','applying','rolling_back']}},data:{status:terminal ? (next.kind==='rollback'?'rollback_failed':'apply_failed') : (next.kind==='rollback'?'rolling_back':'applying'),error}});
    }
    await log(next.storeId, "Job needs attention", { kind: next.kind, error });
  } finally {
    clearInterval(heartbeat);
  }
  return true;
}
export async function schedule() {
  const stores = await prisma.store.findMany({
    where: { active: true, demo: false, nextWeekly: { lte: new Date() } },
  });
  for (const s of stores) {
    const cfg = settings(s.settings);
    if (cfg.weekly) {
      for (const kind of ["audit", "analytics", "report"])
        await enqueue(s.id, kind, {}, `${s.nextWeekly.toISOString()}`);
    }
    await prisma.store.update({
      where: { id: s.id },
      data: { nextWeekly: new Date(Date.now() + 7 * 86400000) },
    });
  }
}

export async function proposeRedirect(
  storeId: string,
  path: string,
  target: string,
) {
  if (
    !/^\/collections\/[a-z0-9][a-z0-9-]*$/.test(path) ||
    !/^\/collections\/[a-z0-9][a-z0-9-]*$/.test(target) ||
    path === target
  )
    throw new Error(
      "Use distinct collection paths such as /collections/retired-name",
    );
  const resources = await prisma.resource.findMany({
    where: { storeId, kind: "collection" },
  });
  if (resources.some((r) => "/collections/" + r.handle === path))
    throw new Error(
      "The old collection is still present. Retire it in Shopify before adding a redirect.",
    );
  if (!resources.some((r) => "/collections/" + r.handle === target))
    throw new Error("Choose an existing collection as the destination.");
  const client = await clientFor(storeId);
  let previous: {path:string;target:string} | null = null;
  if (client) {
    await verifyRedirectTarget(storeId, target);
    const result = await graphql(client, operations.redirectLookup, {query: `path:${path}`});
    const existing = result.urlRedirects.nodes.find((r:{path:string}) => r.path === path);
    if (existing) previous = {path:existing.path,target:existing.target};
    if (previous?.target === target) throw new Error("This redirect already points to the selected destination.");
  }
  const resource = await prisma.resource.upsert({
    where: { storeId_remoteId: { storeId, remoteId: "redirect:" + path } },
    create: {
      storeId,
      remoteId: "redirect:" + path,
      kind: "redirect",
      title: path,
      handle: path,
      payload: JSON.stringify({ path, target }),
    },
    update: {},
  });
  const pending = await prisma.change.findFirst({
    where: {
      storeId,
      resourceId: resource.id,
      feature: "redirect",
      status: { in: ["pending", "approved", "applying"] },
    },
  });
  if (pending) {
    if(sameField(JSON.parse(pending.after),{path,target})) return pending;
    if(pending.status!=='pending') throw new Error('A redirect for this path is already being applied. Wait for it to finish before changing the destination.');
    await prisma.change.updateMany({where:{id:pending.id,status:'pending'},data:{status:'superseded',error:'Replaced by a newer destination'}});
  }
  return prisma.change.create({
    data: {
      storeId,
      resourceId: resource.id,
      feature: "redirect",
      before: JSON.stringify(previous),
      after: JSON.stringify({ path, target }),
      reasons: JSON.stringify([
        "Repair the collection redirect to the selected verified live destination. Rollback restores the previous mapping, or removes a newly created mapping, only if nobody has edited it.",
      ]),
    },
  });
}
async function verifyRedirectTarget(storeId:string, target:string) {
  const store = await prisma.store.findUniqueOrThrow({where:{id:storeId}});
  const url = new URL(target, store.domain).href;
  const response = await publicFetch(url, {method:"HEAD"});
  if (!response.ok || new URL(response.url).origin !== new URL(url).origin || new URL(response.url).pathname.replace(/\/$/,"") !== target.replace(/\/$/,""))
    throw new Error("Choose a live destination that does not redirect elsewhere.");
}
async function applyRedirect(storeId: string, change: Change, rollback: boolean) {
  const mapping = JSON.parse(change.after);
  const previous = JSON.parse(change.before);
  const expected = rollback ? mapping : previous;
  const desired = rollback ? previous : mapping;
  const client = await clientFor(storeId);
  await prisma.change.update({
    where: { id: change.id },
    data: { status: rollback ? "rolling_back" : "applying" },
  });
  if (client) {
    const result = await graphql(client, operations.redirectLookup, {
      query: `path:${mapping.path}`,
    });
    const existing = result.urlRedirects.nodes.find(
      (r:{path:string}) => r.path === mapping.path,
    );
    const action=redirectAction(existing || null,expected,desired);
    if (action !== 'none') {
      if (!rollback && desired) await verifyRedirectTarget(storeId, desired.target);
      if (action === 'delete') await graphql(client, operations.redirectDelete, {id:existing.id});
      else if (action === 'update') await graphql(client, operations.redirectUpdate, {id:existing.id,input:desired});
      else await graphql(client, operations.redirect, {input:desired});
    }
    const confirmed=await graphql(client,operations.redirectLookup,{query:`path:${mapping.path}`});
    const saved=confirmed.urlRedirects.nodes.find((r:{path:string})=>r.path===mapping.path);
    if(!sameField(saved ? {path:saved.path,target:saved.target} : null,desired)) {
      await prisma.change.update({where:{id:change.id},data:{status:'verification_failed',error:'Shopify did not return the accepted redirect mapping.'}});
      throw new Error('Verification failed: redirect mapping was not saved.');
    }
  }
  await prisma.change.update({
    where: { id: change.id },
    data: {
      status: rollback ? "rolled_back" : "applied",
      appliedAt: new Date(),
      error: null,
    },
  });
  if(client) await enqueue(storeId,'audit',{},`redirect-verification:${change.id}:${rollback}`);
  await log(
    storeId,
    rollback ? "Redirect rolled back" : "Redirect applied and verified",
    mapping,
  );
}

async function rollbackDraft(storeId: string, change: Change, rollback: boolean) {
  if (!rollback) return;
  const resource = await prisma.resource.findFirstOrThrow({
    where: { id: change.resourceId, storeId },
  });
  const original: Payload = JSON.parse(change.after);
  const client = await clientFor(storeId);
  let current: Payload | null = JSON.parse(resource.payload);
  if (client) {
    try {
      current = await fetchResource(client, resource.remoteId, "article");
    } catch (e) {
      if (e instanceof Error && e.message === "Resource no longer exists")
        current = null;
      else throw e;
    }
  }
  if (
    current &&
    (current.published ||
      current.title !== original.title ||
      current.descriptionHtml !== original.descriptionHtml ||
      current.handle !== original.handle)
  )
    throw new Error(
      "Conflict: draft has been edited or published; preserve the newer version",
    );
  if (client && current)
    await graphql(client, operations.deleteDraft, { id: resource.remoteId });
  await prisma.change.update({
    where: { id: change.id },
    data: { status: "rolled_back" },
  });
  await prisma.resource.deleteMany({ where: { id: resource.id, storeId } });
  await log(storeId, "Draft creation rolled back", { title: original.title });
}
