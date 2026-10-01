import {inspectPage,mapConcurrent} from './technical-audit';
import {renderedChecks,merchantListingGaps} from './rendered-page';
import {themeSignals,themeFindings,type PageSignals} from './theme-leftovers';
import { load } from "cheerio";
import robotsParser from "robots-parser";
import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import type { Issue } from "./types";
const privateIP = (ip: string) =>
  ip === "::1" ||
  ip.startsWith("fc") ||
  ip.startsWith("fd") ||
  ip.startsWith("fe80:") ||
  ip.startsWith("::ffff:") ||
  /^(0|10|127|169\.254|192\.168|172\.(1[6-9]|2\d|3[01]))\./.test(ip);
export async function publicFetch(
  input: string,
  init: RequestInit = {},
  remaining = 4,
  trace: string[] = [],
): Promise<Response> {
  const u = new URL(input);
  if (
    u.protocol !== "https:" ||
    u.username ||
    u.password ||
    (u.port && u.port !== "443")
  )
    throw new Error("Only public HTTPS URLs are allowed");
  if (
    isIP(u.hostname) ||
    u.hostname === "localhost" ||
    u.hostname.endsWith(".local")
  )
    throw new Error("Private network URL rejected");
  const addresses = await lookup(u.hostname, { all: true });
  if (!addresses.length || addresses.some((a) => privateIP(a.address)))
    throw new Error("Private network address rejected");
  const response = await fetch(u, {
    ...init,
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  if (
    response.status >= 300 &&
    response.status < 400 &&
    response.headers.get("location")
  ) {
    if (!remaining) throw new Error("Redirect limit exceeded");
    await response.body?.cancel();
    const next = new URL(response.headers.get("location")!, u).href;
    trace.push(next);
    return publicFetch(next, init, remaining - 1, trace);
  }
  return response;
}
export async function limitedText(response: Response, max = 2_000_000) {
  if (Number(response.headers.get("content-length")) > max)
    throw new Error("Response exceeds scan limit");
  const reader = response.body?.getReader();
  if (!reader) return "";
  let bytes = 0;
  const chunks: Uint8Array[] = [];
  try {
    for (let chunk = await reader.read(); !chunk.done; chunk = await reader.read()) {
      const value = chunk.value;
      bytes += value.length;
      if (bytes > max) throw new Error("Response exceeds scan limit");
      chunks.push(value);
    }
  } finally {
    await reader.cancel();
  }
  return Buffer.concat(chunks).toString("utf8");
}
type SchemaNode={offers?:unknown;image?:unknown;itemListElement?:unknown[];headline?:string;author?:unknown;datePublished?:string;['@type']:string|string[];['@id']?:string;url?:string;name?:string;aggregateRating?:{ratingValue?:unknown;reviewCount?:unknown;ratingCount?:unknown};mainEntity?:{name?:string;acceptedAnswer?:{text?:string}}[];priceCurrency?:string;price?:unknown;availability?:unknown};
type SchemaSource={script:string;types:string[];url:string;id:string;fields:string[]};
type Discoveries={pages?:{url:string;status:number}[];scanned:number;total:number;judgeMe:boolean;ga4:boolean;faqSchema:boolean;robots:{agent:string;home:boolean;product:boolean;samples?:string[];directives?:string}[];errors:string[];schemas:{url:string;types:(string|string[])[];sources:SchemaSource[];valid?:boolean;errors?:string[];checkedAt?:string}[];linkChecks?:{checked:number;skipped:number;unavailable:number};reported?:{path:string;status:number|null;state:string}[];sitemap?:{status:number;valid:boolean};rateLimit?:{hits:number;deferred:number;recovered:number;spacingMs:number};llms?:{status:number|string;present:boolean;excerpt?:string}};
export function schemaNodes(html: string) {
  const $ = load(html);
  const nodes: SchemaNode[] = [];
  const errors: string[] = [];
  const sources: {script:string;types:string[];url:string;id:string;fields:string[]}[] = [];
  const variantNodes = new Set<SchemaNode>();
  const topNodes = new Set<SchemaNode>();
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).html() || "");
      // Release 20 (RP-101): Products under a ProductGroup's hasVariant are variants of one product,
      // not separate products; they are marked so duplicate checks skip them.
      const flatten = (v: unknown, inVariant = false) => {
        if (Array.isArray(v)) v.forEach((x) => flatten(x, inVariant));
        else if (v && typeof v === "object") {
          if ("@type" in v && (typeof v["@type"]==='string' || Array.isArray(v["@type"]))) { nodes.push(v as SchemaNode); if (inVariant) variantNodes.add(v as SchemaNode); }
          const isGroup = [(v as SchemaNode)["@type"]].flat().includes("ProductGroup");
          Object.entries(v).forEach(([key, child])=>{if(child && typeof child === "object")flatten(child, inVariant || (isGroup && key === "hasVariant"));});
        }
      };
      const start=nodes.length;
      // Top-level entities: the block's root object(s) and @graph members.
      for(const root of [j].flat()){if(root&&typeof root==='object'){if('@type' in root)topNodes.add(root as SchemaNode);for(const g of [(root as {'@graph'?:unknown})['@graph']||[]].flat())if(g&&typeof g==='object'&&'@type' in (g as object))topNodes.add(g as SchemaNode);}}
      flatten(j);
      for(const n of nodes.slice(start)) sources.push({script:$(el).attr('id') || `JSON-LD block ${_+1}`,types:[n['@type']].flat(),url:n.url || '',id:n['@id'] || '',fields:Object.keys(n).filter(k=>!k.startsWith('@'))});
    } catch {
      errors.push("Invalid JSON-LD syntax");
    }
  });
  return { nodes, errors, sources, variantNodes, topNodes };
}
export function validateSchema(nodes: SchemaNode[], variants: Set<SchemaNode> = new Set()) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
    for (const type of types) {
      const identity=n["@id"] || n.url || (type==="Organization" ? n.name : "");
      const key = identity ? type + ":" + identity : "";
      // Variants inside one ProductGroup share the product's address; they are not duplicates.
      if (key && !variants.has(n) && seen.has(key)) errors.push(`Duplicate ${type} entity`);
      if(key && !variants.has(n))seen.add(key);
      if (type === "Product") {
        if (!n.name) errors.push("Product is missing name");
        if(!n.offers)errors.push('Product is missing Offer information');
        if(!n.image)errors.push('Product is missing image');
        if (
          n.aggregateRating &&
          (!n.aggregateRating.ratingValue ||
            (!n.aggregateRating.reviewCount && !n.aggregateRating.ratingCount))
        )
          errors.push("Incomplete AggregateRating");
      }
      if(type==='CollectionPage'&&!n.name)errors.push('CollectionPage is missing name');
      if(type==='ItemList'&&(!Array.isArray(n.itemListElement)||!n.itemListElement.length))errors.push('ItemList is missing its items');
      if(type==='BreadcrumbList'&&(!Array.isArray(n.itemListElement)||!n.itemListElement.length))errors.push('BreadcrumbList is missing its items');
      if(type==='Article'&&(!n.headline||!n.author||!n.datePublished))errors.push('Article needs headline, author and datePublished');
      if (
        type === "FAQPage" &&
        (!Array.isArray(n.mainEntity) ||
          n.mainEntity.some((q: {name?:string;acceptedAnswer?:{text?:string}}) => !q.name || !q.acceptedAnswer?.text))
      )
        errors.push("Incomplete FAQPage");
      if (
        type === "Offer" &&
        (!n.priceCurrency || n.price === undefined || !n.availability)
      )
        errors.push("Incomplete Offer");
    }
  }
  return errors;
}
export const crawlers = [
  "GPTBot",
  "OAI-SearchBot",
  "ChatGPT-User",
  "PerplexityBot",
  "Google-Extended",
  "ClaudeBot",
  "Claude-SearchBot",
  "Claude-User",
  "Applebot-Extended",
  "Bingbot",
  "Googlebot",
];
const CRAWL_SPACING_MS = Number(process.env.CRAWL_SPACING_MS ?? 400);
/** Where a redirect chain ended, relative to the requested page; null when it did not move. */
export function redirectOutcome(requested: string, trace: string[]) {
  if (!trace.length) return null;
  const from = new URL(requested);
  const to = new URL(trace[trace.length - 1], requested);
  // Locale prefixes (/en-gb/…), letter case and trailing slashes are the same page.
  const clean = (p: string) => (p.toLowerCase().replace(/^\/[a-z]{2}(-[a-z]{2})?(?=\/|$)/, "").replace(/\/+$/, "") || "/");
  if (clean(to.pathname) === clean(from.pathname)) return null;
  const sameSite = to.hostname.replace(/^www\./, "") === from.hostname.replace(/^www\./, "") || to.origin === from.origin;
  return { path: sameSite ? to.pathname + to.search : to.href, home: sameSite && clean(to.pathname) === "/" };
}
/**
 * Dawn-based themes append " – {shop name}" unless the title already contains it.
 * Returns the served title (without that suffix) when it differs from the stored SEO title.
 */
export function servedTitleMismatch(served: string, stored: string, shopName?: string) {
  const normal = (v: string) => load(`<p>${v}</p>`)("p").text().normalize("NFC").replace(/\s+/g, " ").trim().toLowerCase();
  if (!served || !String(stored || "").trim()) return null;
  let core = served.replace(/\s+/g, " ").trim();
  const suffix = shopName ? new RegExp(`\\s[–—|-]\\s${shopName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}$`, "i") : null;
  if (suffix) core = core.replace(suffix, "");
  if (normal(core) === normal(stored) || normal(served) === normal(stored)) return null;
  return { served: core };
}
export async function crawlStore(
  domain: string,
  resources: {
    id: string;
    title: string;
    kind: string;
    payload: string;
    handle: string;
  }[],
  limit: number,
  reportedPaths: string[] = [],
  options: { shopName?: string } = {},
) {
  const issues: Issue[] = [];
  const discoveries: Discoveries = {
    pages:[],
    scanned: 0,
    total: resources.length,
    judgeMe: false,
    ga4: false,
    faqSchema: false,
    robots: [],
    errors: [],
    schemas: [],
  };
  let robots = "";
  try {
    const r = await publicFetch(domain + "/robots.txt");
    robots = await limitedText(r, 200000);
    if (r.ok) {
      const parser = robotsParser(domain + "/robots.txt", robots);
      discoveries.robots = crawlers.map((agent) => ({
        agent,
        samples:[domain+'/',domain+'/products/example'],directives:robots,
        home: parser.isAllowed(domain + "/", agent) ?? true,
        product: parser.isAllowed(domain + "/products/example", agent) ?? true,
      }));
    } else discoveries.errors.push(`robots.txt returned ${r.status}`);
  } catch (e) {
    discoveries.errors.push("robots.txt could not be fetched");
  }
  try {
    const r = await publicFetch(domain + "/llms.txt");
    const txt = await limitedText(r, 200000);
    discoveries.llms = {
      status: r.status,
      present: r.ok && !/<html/i.test(txt),
      excerpt: txt.slice(0, 1500),
    };
  } catch {
    discoveries.llms = { present: false, status: "unavailable" };
  }
  const seenLinks = new Map<string,Promise<number>>();
  const redirectsTo = new Map<string,string>();
  const pageStatuses = new Map<string,number>();
  const linkSources=new Map<string,{id:string;title:string;url:string}[]>();
  discoveries.linkChecks={checked:0,skipped:0,unavailable:0};
  try {const r=await publicFetch(domain+'/sitemap.xml');const xml=await limitedText(r);discoveries.sitemap={status:r.status,valid:r.ok&&/<(?:sitemapindex|urlset)[\s>]/i.test(xml)};if(!discoveries.sitemap.valid)issues.push({resourceId:'store',title:'Store sitemap',code:'sitemap-unavailable',severity:'warning',detail:`sitemap.xml returned ${r.status} or did not contain a recognised XML sitemap.`});}catch{discoveries.errors.push('Sitemap could not be checked.');}
  for(const r of discoveries.robots.filter(r=>!r.home||!r.product))issues.push({resourceId:'store',title:'Crawler access',code:'crawler-blocked',severity:'notice',detail:`${r.agent} is blocked on ${!r.home?'the homepage':'a sample product path'}. Review whether this is intentional; training bots and search bots have different purposes.`});
  const targets = [
    { id: "store", title: "Home page", kind: "home", seoTitle: "", url: domain + "/" },
    ...resources
      .filter((r) => JSON.parse(r.payload).published !== false)
      .slice(0, Math.max(0, limit - 1))
      .map((r) => {
        const p = JSON.parse(r.payload);
        return {
          id: r.id,
          title: r.title,
          kind: r.kind,
          seoTitle: String(p.seo?.title || ""),
          url:
            p.url ||
            `${domain}/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${r.handle}`,
        };
      }),
  ];
  // Release 18: adaptive spacing. The first 429 slows the whole crawl down; pages still rate-limited
  // after their retries are checked again, one at a time, at the end instead of being reported.
  // Release 19 (R19-17): merchant-listing fields, counted across products and reported once.
  let listingChecked=0;const listingGaps=new Map<string,string[]>();
  let spacing=CRAWL_SPACING_MS;const deferred:typeof targets=[];const signals:PageSignals[]=[];
  discoveries.rateLimit={hits:0,deferred:0,recovered:0,spacingMs:spacing};
  const visit=async (target:(typeof targets)[number],final:boolean) => {
    try {
      // Release 17: space requests so the crawl does not trigger Shopify's rate limiter,
      // and time only the final attempt so back-off waits are not reported as slow pages.
      await new Promise(ok=>setTimeout(ok,final?Math.max(spacing,2000):spacing));
      let trace: string[] = [];
      let started = Date.now();
      let res = await publicFetch(target.url, {}, 4, trace);
      // Shopify rate-limits bursts; a 429/503 is not evidence that the page is broken. Back off and retry.
      for(let attempt=1;attempt<=3&&(res.status===429||res.status===503);attempt++){if(res.status===429){discoveries.rateLimit!.hits++;spacing=Math.min(4000,Math.max(1000,spacing*2));discoveries.rateLimit!.spacingMs=spacing;}await res.body?.cancel();await new Promise(ok=>setTimeout(ok,Math.min(10000,(Number(res.headers.get('retry-after'))||2*attempt)*1000)));trace=[];started=Date.now();res=await publicFetch(target.url, {}, 4, trace);}
      if(!final&&(res.status===429||res.status===503)){await res.body?.cancel();deferred.push(target);discoveries.rateLimit!.deferred++;return;}
      if(final&&res.ok)discoveries.rateLimit!.recovered++;
      pageStatuses.set(target.url,res.status);
      discoveries.pages!.push({url:target.url,status:res.status});
      const html = await limitedText(res);
      const ms = Date.now() - started;
      discoveries.scanned++;
      const add = (
        code: string,
        detail: string,
        severity: Issue["severity"] = "warning",
      ) =>
        issues.push({
          resourceId: target.id,
          title: target.title,
          code,
          severity,
          detail,
          ...(["404","http-error"].includes(code)?{link:{url:target.url,status:res.status,checkedAt:new Date().toISOString()}}:{}),
        });
      if (res.status === 404) {
        add("404", "Storefront URL returns 404.", "critical");
        return;
      }
      if (!res.ok) {
        add(
          "http-error",
          `Storefront returned ${res.status}; may be protected or temporarily unavailable.`,
        );
        return;
      }
      const $ = load(html);
      const landed = redirectOutcome(target.url, trace);
      if (landed && target.id !== "store") {
        if (landed.home)
          add(
            "redirects-home",
            `${new URL(target.url).pathname} redirects to the home page. RankPilot still lists this ${target.title ? `page (“${target.title}”)` : "page"} as published. Redirecting a retired page to the home page is treated as a soft 404; point it at the closest relevant collection or product instead, or unpublish and remove it from the catalogue.`,
          );
        else
          add(
            "redirected",
            `${new URL(target.url).pathname} redirects to ${landed.path}. Update internal links to the final address, or restore the page if the redirect is not intended.`,
            "notice",
          );
        return;
      }
      const servedTitle = $("title").first().text().replace(/\s+/g, " ").trim();
      const mismatch = servedTitleMismatch(servedTitle, target.seoTitle, options.shopName);
      if (mismatch)
        add(
          "served-title-mismatch",
          `The storefront shows “${mismatch.served}” but the Shopify SEO title is “${target.seoTitle}”. Something between Shopify and the page is replacing the title: check Markets or Translate & Adapt for a market-specific SEO title, and any SEO app or theme code that rewrites <title>. RankPilot changes the Shopify SEO title, so its edits will not show until the override is removed.`,
        );
      const canonical = $('link[rel="canonical"]').attr("href");
      if (!canonical) add("canonical-missing", "No canonical link found.");
      else if (
        new URL(canonical, target.url).pathname !== new URL(target.url).pathname
      )
        add(
          "canonical-differs",
          `Canonical points to ${canonical}. Review whether intentional.`,
        );
      if ($("h1").length !== 1)
        add(
          "heading-structure",
          `${$("h1").length} H1 headings found; review the rendered template.`,
        );
      let level = 0;
      let skips = false;
      $("h1,h2,h3,h4,h5,h6").each((_, e) => {
        const n = Number(e.tagName[1]);
        if (level && n > level + 1) skips = true;
        level = n;
      });
      if (skips)
        add(
          "heading-level-skip",
          "Heading levels skip in the rendered document.",
        );
      if (ms > 2500)
        add(
          "slow-response",
          `${ms} ms to fetch HTML. This is a server observation, not Core Web Vitals.`,
          "notice",
        );
      discoveries.judgeMe ||= /judgeme|jdgm-/i.test(html);
      discoveries.ga4 ||= /G-[A-Z0-9]{6,}|googletagmanager\.com/i.test(html);
      const schema = schemaNodes(html);
      const types = schema.nodes.flatMap((n) => n["@type"]);
      discoveries.schemas.push({ url: target.url, types, sources:schema.sources, errors:[...schema.errors,...validateSchema(schema.nodes,schema.variantNodes)],checkedAt:new Date().toISOString(),valid: !schema.errors.length && !validateSchema(schema.nodes,schema.variantNodes).length });
      if (types.includes("FAQPage")) discoveries.faqSchema = true;
      for (const error of [...schema.errors, ...validateSchema(schema.nodes,schema.variantNodes)]) {
        const details=error.includes('Duplicate Organization') ? ' Sources: '+schema.sources.filter(s=>s.types.includes('Organization')).map(s=>`${s.script} (${s.fields.join(', ')})`).join('; ')+'. Compare these blocks in the theme or app that emits them. Preserve genuine contact and social details in the retained entity.' : '';
        add("schema-error", error+details);
      }
      // Release 19: what the storefront renders (soft 404s, missing Product data, images, brand).
      issues.push(...renderedChecks(html,schema.nodes,target,{variants:schema.variantNodes,top:schema.topNodes,sources:schema.sources}));
      if(target.kind==='product'){listingChecked++;for(const gap of merchantListingGaps(schema.nodes))listingGaps.set(gap,[...(listingGaps.get(gap)||[]),target.url]);}
      signals.push(themeSignals(html,target.url));
      const inspected=inspectPage(html,target.url,target.id,target.title);
      issues.push(...inspected.issues);
      for(const href of inspected.links){
        const sources=linkSources.get(href)||[];
        if(!linkSources.has(href)&&linkSources.size>=3000){discoveries.linkChecks!.skipped++;continue;}
        sources.push(target);linkSources.set(href,sources);
      }
    } catch (e) {
      discoveries.errors.push(
        `${target.title}: ${e instanceof Error ? e.message : "Scan failed"}`,
      );
    }
  };
  await mapConcurrent(targets,2,target=>visit(target,false));
  for(const target of deferred)await visit(target,true);
  issues.push(...themeFindings(signals));
  if(listingGaps.size)issues.push({resourceId:'theme',title:'Live theme',code:'merchant-listing-fields',severity:'warning',detail:`Product structured data has no ${[...listingGaps.keys()].map(k=>k==='shippingDetails'?'shipping details (shippingDetails)':'return policy (hasMerchantReturnPolicy)').join(' or ')} on ${Math.max(...[...listingGaps.values()].map(v=>v.length))} of ${listingChecked} product pages (e.g. ${[...listingGaps.values()][0].slice(0,3).join(', ')}). Google uses these for merchant listings. Add them in the theme's product structured data (or set shipping and returns in Google Merchant Center); RankPilot cannot change the theme.`});
  await mapConcurrent([...linkSources],6,async ([url,sources])=>{
    try{
      let task=seenLinks.get(url);if(pageStatuses.has(url))task=Promise.resolve(pageStatuses.get(url)!);if(!task){task=(async()=>{const trace:string[]=[];let r=await publicFetch(url,{method:'HEAD'},4,trace);if([403,405,404,410].includes(r.status)){trace.length=0;r=await publicFetch(url,{},4,trace);await r.body?.cancel();}if(trace.length)redirectsTo.set(url,trace[trace.length-1]);return r.status;})();seenLinks.set(url,task);}
      const status=await task;discoveries.linkChecks!.checked++;
      // Release 19 (R19-18): internal links that go through a redirect.
      const final=redirectsTo.get(url);
      if(final&&status<400&&new URL(url).origin===new URL(domain).origin)for(const source of sources)if(source.id!=='store')issues.push({resourceId:source.id,title:source.title,code:'redirected-link',severity:'notice',feature:'links',link:{url,sourceUrl:source.url,status,checkedAt:new Date().toISOString()},detail:`Link from ${source.url} to ${url} redirects to ${final}. Link straight to the final address.`});
      if(status===404||status===410)for(const source of sources)issues.push({resourceId:source.id,title:source.title,code:'broken-link',severity:'warning',link:{url,sourceUrl:source.url,status,checkedAt:new Date().toISOString()},detail:`Link from ${source.url} to ${url} returns ${status}.`});
      else if(status>=400)discoveries.linkChecks!.unavailable++;
    }catch{discoveries.linkChecks!.unavailable++;}
  });
  discoveries.reported=await mapConcurrent(reportedPaths,4,async path=>{
    if(/^\/(cart|checkout|account)(\/|$)/.test(path))return {path,status:null,state:'Not checked: transactional URL'};
    try{const r=await publicFetch(new URL(path,domain).href);await r.body?.cancel();if([404,410].includes(r.status))issues.push({resourceId:'reported:'+path,title:path,code:'reported-404',severity:'warning',link:{url:new URL(path,domain).href,status:r.status,checkedAt:new Date().toISOString()},detail:`Imported missing URL ${path} still returns ${r.status}. Choose a relevant replacement; this does not prove a current internal page links here.`});return {path,status:r.status,state:r.ok?'Working or redirected':[404,410].includes(r.status)?'Missing page':'Could not confirm'};}catch{return {path,status:null,state:'Could not check'};}
  });
  return { issues, discoveries };
}
