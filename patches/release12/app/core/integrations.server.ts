import type {SearchRow} from "./analytics";
import { SignJWT, importPKCS8 } from "jose";
import prisma from "../db.server";
import { credentials } from "./security.server";
import { settings } from "./types";
import { prompts } from "./catalogue";
async function jsonFetch(url: string, init: RequestInit) {
  const r = await fetch(url, { ...init, signal: AbortSignal.timeout(60000) });
  const j = await r.json();
  if (!r.ok)
    throw new Error(
      `Provider returned ${r.status}: ${j.error?.message || "request failed"}`,
    );
  return j;
}
export async function googleToken(secrets: Record<string, string>) {
  if (secrets.googleServiceAccount) {
    const account = JSON.parse(secrets.googleServiceAccount);
    const jwt = await new SignJWT({
      scope:
        "https://www.googleapis.com/auth/webmasters.readonly https://www.googleapis.com/auth/analytics.readonly https://www.googleapis.com/auth/content",
    })
      .setProtectedHeader({ alg: "RS256" })
      .setIssuer(account.client_email)
      .setAudience("https://oauth2.googleapis.com/token")
      .setIssuedAt()
      .setExpirationTime("1h")
      .sign(await importPKCS8(account.private_key, "RS256"));
    const r = await jsonFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
        assertion: jwt,
      }),
    });
    return r.access_token;
  }
  if (
    secrets.googleRefreshToken &&
    secrets.googleClientId &&
    secrets.googleClientSecret
  ) {
    const r = await jsonFetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        refresh_token: secrets.googleRefreshToken,
        client_id: secrets.googleClientId,
        client_secret: secrets.googleClientSecret,
      }),
    });
    return r.access_token;
  }
  throw new Error(
    "Connect a Google service account or OAuth refresh token in Settings",
  );
}
export async function collectAnalytics(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  if (store.demo)
    throw new Error(
      "Analytics needs a live installation and credentials. Demo metrics are not fabricated.",
    );
  const secrets = await credentials(storeId);
  const cfg = settings(store.settings);
  const results: string[] = [];
  const day = (d: Date) => d.toISOString().slice(0, 10);
  const end = new Date(Date.now() - 3 * 86400000);
  const start = new Date(end.getTime() - 27 * 86400000);
  const prevEnd = new Date(start.getTime() - 86400000);
  const prevStart = new Date(prevEnd.getTime() - 27 * 86400000);
  const save = async (provider: string, period: string, payload: unknown) => {
    await prisma.metric.upsert({
      where: { storeId_provider_period: { storeId, provider, period } },
      create: { storeId, provider, period, payload: JSON.stringify(payload) },
      update: { payload: JSON.stringify(payload) },
    });
  };
  let token = "";
  try {
    token = await googleToken(secrets);
  } catch (e) {
    results.push((e as Error).message);
  }
  if (token) {
    for (const [label, s, e] of [
      ["current", start, end],
      ["previous", prevStart, prevEnd],
    ] as const) {
      const period = `${day(s)}:${day(e)}`;
      try {
        const rows: SearchRow[] = [];
        for (let startRow = 0; ; startRow += 25000) {
          const r = await jsonFetch(
            `https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.gscSite)}/searchAnalytics/query`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${token}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                startDate: day(s),
                endDate: day(e),
                dimensions: ["page", "query"],
                rowLimit: 25000,
                startRow,
              }),
            },
          );
          rows.push(...(r.rows || []));
          if ((r.rows || []).length < 25000) break;
        }
        await save("gsc", period, {
          label,
          start: day(s),
          end: day(e),
          rows,
          limitation: "Search Console returns top rows, not every query.",
        });
      } catch (e) {
        results.push(`Search Console: ${(e as Error).message}`);
      }
      if (cfg.ga4Property)
        try {
          const rows: {metricValues?:{value:string}[];dimensionValues?:{value:string}[]}[] = [];
          let offset = 0;
          while (offset>=0) {
            const r = await jsonFetch(
              `https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4Property}:runReport`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${token}`,
                  "content-type": "application/json",
                },
                body: JSON.stringify({
                  currencyCode: "GBP",
                  dateRanges: [{ startDate: day(s), endDate: day(e) }],
                  dimensions: [{ name: "landingPagePlusQueryString" }],
                  metrics: [{ name: "sessions" }, { name: "totalRevenue" }],
                  dimensionFilter: {
                    filter: {
                      fieldName: "sessionDefaultChannelGroup",
                      stringFilter: {
                        matchType: "EXACT",
                        value: "Organic Search",
                      },
                    },
                  },
                  limit: 10000,
                  offset,
                }),
              },
            );
            rows.push(...(r.rows || []));
            offset += 10000;
            if (offset >= Number(r.rowCount || 0)) break;
          }
          await save("ga4", period, {
            currency: "GBP",
            label,
            start: day(s),
            end: day(e),
            rows,
          });
        } catch (e) {
          results.push(`GA4: ${(e as Error).message}`);
        }
    }
    if(cfg.ga4Property)try {
      for(const [s,e] of [[start,end],[prevStart,prevEnd]]){
        const r=await jsonFetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4Property}:runReport`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({currencyCode:'GBP',dateRanges:[{startDate:day(s),endDate:day(e)}],dimensions:[{name:'sessionSource'}],metrics:[{name:'sessions'},{name:'totalRevenue'},{name:'transactions'}],dimensionFilter:{filter:{fieldName:'sessionSource',inListFilter:{values:['chatgpt.com','chat.openai.com','perplexity.ai','www.perplexity.ai','gemini.google.com','claude.ai','copilot.microsoft.com'],caseSensitive:false}}},limit:1000})});
        await save('ga4-ai',`${day(s)}:${day(e)}`,{start:day(s),end:day(e),currency:'GBP',rows:r.rows||[],limitation:'Identifiable AI session sources only. Analytics attribution is not a verified Shopify order match; missing referrers are not measurable.'});
      }
    }catch(e){results.push(`AI referral analytics: ${(e as Error).message}`);}
    if(cfg.gscSite)try{
      const s=new Date(end.getTime()-89*86400000);
      const r=await jsonFetch(`https://www.googleapis.com/webmasters/v3/sites/${encodeURIComponent(cfg.gscSite)}/searchAnalytics/query`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({startDate:day(s),endDate:day(end),dimensions:['date'],rowLimit:1000})});
      await save('gsc-daily',`${day(s)}:${day(end)}`,{start:day(s),end:day(end),rows:r.rows||[]});
    }catch(e){results.push(`Search trend: ${(e as Error).message}`);}
    if(cfg.ga4Property)try {
      const baselineStart=new Date(end.getTime()-117*86400000);
      const r=await jsonFetch(`https://analyticsdata.googleapis.com/v1beta/properties/${cfg.ga4Property}:runReport`,{method:'POST',headers:{Authorization:`Bearer ${token}`,'content-type':'application/json'},body:JSON.stringify({currencyCode:'GBP',dateRanges:[{startDate:day(baselineStart),endDate:day(end)}],dimensions:[{name:'date'}],metrics:[{name:'totalRevenue'}],dimensionFilter:{filter:{fieldName:'sessionDefaultChannelGroup',stringFilter:{matchType:'EXACT',value:'Organic Search'}}},limit:1000})});
      await save('ga4-organic-daily',`${day(baselineStart)}:${day(end)}`,{start:day(baselineStart),end:day(end),currency:'GBP',rows:r.rows||[]});
    }catch(e){results.push(`Revenue baseline: ${(e as Error).message}`);}
    if (cfg.merchantAccount)
      try {
        const products: {name:string;offerId:string;attributes?:Record<string,string|string[]>;productStatus?:{itemLevelIssues:unknown[]}}[] = [];
        let pageToken = "";
        do {
          const r = await jsonFetch(
            `https://merchantapi.googleapis.com/products/v1/accounts/${cfg.merchantAccount}/products?pageSize=250${pageToken ? "&pageToken=" + encodeURIComponent(pageToken) : ""}`,
            { headers: { Authorization: `Bearer ${token}` } },
          );
          products.push(...(r.products || []));
          pageToken = r.nextPageToken || "";
        } while (pageToken);
        await save("merchant", day(end), {
          products: products.map((p) => ({
            name: p.name,
            offerId: p.offerId,
            title: p.attributes?.title,
            missing: ["gtin", "brand", "productTypes", "shipping"].filter(
              (k) => !p.attributes?.[k]?.length,
            ),
            issues: p.productStatus?.itemLevelIssues || [],
          })),
          note: "Account-level shipping can satisfy shipping configuration; missing per-product shipping needs review.",
        });
      } catch (e) {
        results.push(`Merchant Center: ${(e as Error).message}`);
      }
  }
  if (secrets.bingKey)
    try {
      const r = await jsonFetch(
        `https://ssl.bing.com/webmaster/api.svc/json/GetPageStats?siteUrl=${encodeURIComponent(store.domain)}&apikey=${encodeURIComponent(secrets.bingKey)}`,
        {},
      );
      await save("bing", day(end), r);
    } catch (e) {
      results.push(`Bing: ${(e as Error).message}`);
    }
  await prisma.event.create({
    data: {
      storeId,
      message: "Analytics refresh finished",
      detail: JSON.stringify({ errors: results }),
    },
  });
  return results;
}
export function classifyAnswer(
  answer: string,
  citations: string[],
  domain: string,
) {
  const host = new URL(domain).hostname.replace(/^www\./, "");
  const cited = citations.some((u) => {
    try {
      const h = new URL(u).hostname.replace(/^www\./, "");
      return h === host || h.endsWith("." + host);
    } catch {
      return false;
    }
  });
  const competitors = [
    ...new Set(
      citations.flatMap((u) => {
        try {
          const h = new URL(u).hostname.replace(/^www\./, "");
          return h === host || h.endsWith("." + host) ? [] : [h];
        } catch {
          return [];
        }
      }),
    ),
  ];
  return {
    mentioned:
      /\bvan\s+life\s+emporium\b/i.test(answer) ||
      answer.toLowerCase().includes(host),
    cited,
    competitors,
  };
}
export async function trackVisibility(storeId: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  if (store.demo)
    throw new Error(
      "Live AI sampling requires an installed store and API keys.",
    );
  const keys = await credentials(storeId);
  let completed = 0;
  for (const engine of ["openai", "perplexity", "gemini"]) {
    if (!keys[`${engine}Key`]) continue;
    for (const prompt of prompts) {
      try {
        let text = "",
          citations: string[] = [],
          model = "";
        const input = `${prompt}. Answer for a shopper in the United Kingdom. Give independent recommendations with sources.`;
        if (engine === "openai") {
          model = keys.openaiModel || "gpt-5-mini";
          const j = await jsonFetch("https://api.openai.com/v1/responses", {
            method: "POST",
            headers: {
              Authorization: `Bearer ${keys.openaiKey}`,
              "content-type": "application/json",
            },
            body: JSON.stringify({
              model,
              input,
              tools: [
                {
                  type: "web_search",
                  user_location: { type: "approximate", country: "GB" },
                },
              ],
              tool_choice: "required",
            }),
          });
          for (const o of j.output || [])
            for (const c of o.content || []) {
              text += c.text || "";
              citations.push(
                ...(c.annotations || [])
                  .filter((a: {type:string}) => a.type === "url_citation")
                  .map((a: {url:string}) => a.url),
              );
            }
        }
        if (engine === "perplexity") {
          model = keys.perplexityModel || "sonar";
          const j = await jsonFetch(
            "https://api.perplexity.ai/chat/completions",
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${keys.perplexityKey}`,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                model,
                messages: [{ role: "user", content: input }],
                search_recency_filter: "month",
              }),
            },
          );
          text = j.choices?.[0]?.message?.content || "";
          citations = j.citations || [];
        }
        if (engine === "gemini") {
          model = keys.geminiModel || "gemini-2.5-flash";
          const j = await jsonFetch(
            `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
            {
              method: "POST",
              headers: {
                "x-goog-api-key": keys.geminiKey,
                "content-type": "application/json",
              },
              body: JSON.stringify({
                contents: [{ parts: [{ text: input }] }],
                tools: [{ google_search: {} }],
              }),
            },
          );
          text =
            j.candidates?.[0]?.content?.parts
              ?.map((p: {text?:string}) => p.text || "")
              .join("") || "";
          citations =
            j.candidates?.[0]?.groundingMetadata?.groundingChunks
              ?.map((c: {web?:{uri:string}}) => c.web?.uri)
              .filter(Boolean) || [];
        }
        if (!text) throw new Error("Empty answer");
        citations=citations.filter(u=>/^https?:\/\//i.test(u));
        const result = classifyAnswer(text, citations, store.domain);
        await prisma.observation.create({
          data: {
            storeId,
            engine,
            prompt,
            model,
            text,
            citations: JSON.stringify(citations),
            competitors: JSON.stringify(result.competitors),
            mentioned: result.mentioned,
            cited: result.cited,
          },
        });
        completed++;
      } catch (e) {
        await prisma.event.create({
          data: {
            storeId,
            message: `AI sample failed: ${engine}`,
            detail: JSON.stringify({ prompt, error: (e as Error).message }),
          },
        });
      }
    }
  }
  if (!completed)
    throw new Error(
      "No AI samples completed. Check API keys and provider errors.",
    );
  return completed;
}
export async function pageSpeed(storeId: string, url: string) {
  const store = await prisma.store.findUniqueOrThrow({
    where: { id: storeId },
  });
  if (new URL(url).origin !== new URL(store.domain).origin)
    throw new Error("PageSpeed URL must belong to this store");
  const keys = await credentials(storeId);
  if (!keys.pagespeedKey) throw new Error("Connect a PageSpeed Insights key");
  const j = await jsonFetch(
    `https://www.googleapis.com/pagespeedonline/v5/runPagespeed?url=${encodeURIComponent(url)}&strategy=mobile&category=performance&key=${encodeURIComponent(keys.pagespeedKey)}`,
    {},
  );
  const payload = {
    url,
    checkedAt: new Date().toISOString(),
    error: j.lighthouseResult?.runtimeError?.message,
    score: j.lighthouseResult?.categories?.performance?.score,
    field: j.loadingExperience,
    audits: j.lighthouseResult?.audits,
  };
  await prisma.metric.create({
    data: {
      storeId,
      provider: "pagespeed",
      period: new Date().toISOString(),
      payload: JSON.stringify(payload),
    },
  });
}
