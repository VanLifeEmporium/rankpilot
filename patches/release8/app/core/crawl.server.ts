import {inspectPage,mapConcurrent} from './technical-audit';
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
    return publicFetch(
      new URL(response.headers.get("location")!, u).href,
      init,
      remaining - 1,
    );
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
type SchemaNode={['@type']:string|string[];['@id']?:string;url?:string;name?:string;aggregateRating?:{ratingValue?:unknown;reviewCount?:unknown;ratingCount?:unknown};mainEntity?:{name?:string;acceptedAnswer?:{text?:string}}[];priceCurrency?:string;price?:unknown;availability?:unknown};
type SchemaSource={script:string;types:string[];url:string;id:string;fields:string[]};
type Discoveries={scanned:number;total:number;judgeMe:boolean;ga4:boolean;faqSchema:boolean;robots:{agent:string;home:boolean;product:boolean}[];errors:string[];schemas:{url:string;types:(string|string[])[];sources:SchemaSource[];valid?:boolean}[];linkChecks?:{checked:number;skipped:number;unavailable:number};reported?:{path:string;status:number|null;state:string}[];sitemap?:{status:number;valid:boolean};llms?:{status:number|string;present:boolean;excerpt?:string}};
export function schemaNodes(html: string) {
  const $ = load(html);
  const nodes: SchemaNode[] = [];
  const errors: string[] = [];
  const sources: {script:string;types:string[];url:string;id:string;fields:string[]}[] = [];
  $('script[type="application/ld+json"]').each((_, el) => {
    try {
      const j = JSON.parse($(el).html() || "");
      const flatten = (v: unknown) => {
        if (Array.isArray(v)) v.forEach(flatten);
        else if (v && typeof v === "object") {
          if ("@type" in v && (typeof v["@type"]==='string' || Array.isArray(v["@type"]))) nodes.push(v as SchemaNode);
          Object.values(v).forEach(child=>{if(child && typeof child === "object")flatten(child);});
        }
      };
      const start=nodes.length;
      flatten(j);
      for(const n of nodes.slice(start)) sources.push({script:$(el).attr('id') || `JSON-LD block ${_+1}`,types:[n['@type']].flat(),url:n.url || '',id:n['@id'] || '',fields:Object.keys(n).filter(k=>!k.startsWith('@'))});
    } catch {
      errors.push("Invalid JSON-LD syntax");
    }
  });
  return { nodes, errors, sources };
}
export function validateSchema(nodes: SchemaNode[]) {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const n of nodes) {
    const types = Array.isArray(n["@type"]) ? n["@type"] : [n["@type"]];
    for (const type of types) {
      const identity=n["@id"] || n.url || (type==="Organization" ? n.name : "");
      const key = identity ? type + ":" + identity : "";
      if (key && seen.has(key)) errors.push(`Duplicate ${type} entity`);
      if(key)seen.add(key);
      if (type === "Product") {
        if (!n.name) errors.push("Product is missing name");
        if (
          n.aggregateRating &&
          (!n.aggregateRating.ratingValue ||
            (!n.aggregateRating.reviewCount && !n.aggregateRating.ratingCount))
        )
          errors.push("Incomplete AggregateRating");
      }
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
  "Bingbot",
  "Googlebot",
];
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
) {
  const issues: Issue[] = [];
  const discoveries: Discoveries = {
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
  const pageStatuses = new Map<string,number>();
  const linkSources=new Map<string,{id:string;title:string;url:string}[]>();
  discoveries.linkChecks={checked:0,skipped:0,unavailable:0};
  try {const r=await publicFetch(domain+'/sitemap.xml');const xml=await limitedText(r);discoveries.sitemap={status:r.status,valid:r.ok&&/<(?:sitemapindex|urlset)[\s>]/i.test(xml)};if(!discoveries.sitemap.valid)issues.push({resourceId:'store',title:'Store sitemap',code:'sitemap-unavailable',severity:'warning',detail:`sitemap.xml returned ${r.status} or did not contain a recognised XML sitemap.`});}catch{discoveries.errors.push('Sitemap could not be checked.');}
  for(const r of discoveries.robots.filter(r=>!r.home||!r.product))issues.push({resourceId:'store',title:'Crawler access',code:'crawler-blocked',severity:'notice',detail:`${r.agent} is blocked on ${!r.home?'the homepage':'a sample product path'}. Review whether this is intentional; training bots and search bots have different purposes.`});
  const targets = [
    { id: "store", title: "Home page", url: domain + "/" },
    ...resources
      .filter((r) => JSON.parse(r.payload).published !== false)
      .slice(0, Math.max(0, limit - 1))
      .map((r) => {
        const p = JSON.parse(r.payload);
        return {
          id: r.id,
          title: r.title,
          url:
            p.url ||
            `${domain}/${r.kind === "article" ? `blogs/${p.blogHandle}` : r.kind + "s"}/${r.handle}`,
        };
      }),
  ];
  await mapConcurrent(targets,4,async target => {
    try {
      const started = Date.now();
      const res = await publicFetch(target.url);
      pageStatuses.set(target.url,res.status);
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
      discoveries.schemas.push({ url: target.url, types, sources:schema.sources, valid: !schema.errors.length && !validateSchema(schema.nodes).length });
      if (types.includes("FAQPage")) discoveries.faqSchema = true;
      for (const error of [...schema.errors, ...validateSchema(schema.nodes)]) {
        const details=error.includes('Duplicate Organization') ? ' Sources: '+schema.sources.filter(s=>s.types.includes('Organization')).map(s=>`${s.script} (${s.fields.join(', ')})`).join('; ')+'. Compare these blocks in the theme or app that emits them. Preserve genuine contact and social details in the retained entity.' : '';
        add("schema-error", error+details);
      }
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
  });
  await mapConcurrent([...linkSources],6,async ([url,sources])=>{
    try{
      let task=seenLinks.get(url);if(pageStatuses.has(url))task=Promise.resolve(pageStatuses.get(url)!);if(!task){task=(async()=>{let r=await publicFetch(url,{method:'HEAD'});if([403,405,404,410].includes(r.status)){r=await publicFetch(url);await r.body?.cancel();}return r.status;})();seenLinks.set(url,task);}
      const status=await task;discoveries.linkChecks!.checked++;
      if(status===404||status===410)for(const source of sources)issues.push({resourceId:source.id,title:source.title,code:'broken-link',severity:'warning',detail:`Link from ${source.url} to ${url} returns ${status}.`});
      else if(status>=400)discoveries.linkChecks!.unavailable++;
    }catch{discoveries.linkChecks!.unavailable++;}
  });
  discoveries.reported=await mapConcurrent(reportedPaths,4,async path=>{
    if(/^\/(cart|checkout|account)(\/|$)/.test(path))return {path,status:null,state:'Not checked: transactional URL'};
    try{const r=await publicFetch(new URL(path,domain).href);await r.body?.cancel();if([404,410].includes(r.status))issues.push({resourceId:'reported:'+path,title:path,code:'reported-404',severity:'warning',detail:`Imported missing URL ${path} still returns ${r.status}. Choose a relevant replacement; this does not prove a current internal page links here.`});return {path,status:r.status,state:r.ok?'Working or redirected':[404,410].includes(r.status)?'Missing page':'Could not confirm'};}catch{return {path,status:null,state:'Could not check'};}
  });
  return { issues, discoveries };
}
