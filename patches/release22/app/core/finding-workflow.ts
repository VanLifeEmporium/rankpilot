import type {Issue,Settings,Facts} from './types';
import {jobResults,jobMessage,resultMessage} from './job-feedback';
export const catalogueCodes=new Set(['supplier-formatting','imperial-units','long-url','duplicate-alt','article-dated-facts','invalid-gtin','book-without-isbn','gtin-unusual-prefix','vendor-placeholder','vendor-near-duplicate','vendor-store-on-book','vendor-mismatch','brand-is-store','repeated-template','generic-faq','faq-answer-wrong','answer-missing-size','answer-missing-material','answer-missing-included','answer-missing-weight','answer-missing-care','answer-missing-fit','answer-missing-delivery','supplier-markup','missing-meta-title','long-title','duplicate-title','missing-meta-description','long-meta-description','short-meta-description','duplicate-meta-description','thin-content','supplier-language','missing-alt','large-image','keyword-cannibalisation','possible-duplicate-product','missing-product-faq','missing-gtin']);
export const findingKey=(i:Issue)=>`${i.resourceId}:${i.code}:${i.detail}`;
export function hasFaqSources(facts:Facts,settings:Settings) {
 return Object.entries(facts).some(([k,f])=>k!=='barcode' && f.confirmed && f.value.trim() && f.source.trim()) || Boolean(settings.policies.source && (settings.policies.delivery || settings.policies.returns));
}
export function findingAction(i:Issue,resource:{kind:string;facts:string}|undefined,settings:Settings) {
 // Release 20 (RP-201): brand proposals are prepared from the finding's evidence, not generated.
 if(i.code==='brand-is-store')return {kind:'manual',label:'Propose the brand',detail:i.brand?`Propose vendor “${i.brand.vendor}” (${i.brand.confidence} confidence). The change waits for your approval and can be undone in Results & history.`:'Set the vendor to the manufacturer.'};
 if(i.feature && resource) {
  if(i.feature==='faq' && !hasFaqSources(JSON.parse(resource.facts),settings))
   return {kind:'facts',label:'Confirm product facts',detail:'Confirm at least one sourced fact, then generate an FAQ preview. No API credits are needed for fact-based FAQs.'};
  return {kind:'generate',label:'Generate fix',detail:''};
 }
 const details:Record<string,string>={
  'large-image':'Check the image size delivered on the storefront before replacing the source. Source dimensions alone do not prove the image is slow.',
  'missing-gtin':'Check the supplier barcode. Add only the manufacturer’s assigned GTIN to the relevant variant; some products legitimately have none.',
  'keyword-cannibalisation':'Review the other page named here and assign distinct primary keywords where the pages serve different searches.',
  'possible-duplicate-product':'Compare the two supplier listings and variants. Decide which to retain before merging or removing anything.',
  'thin-content':'Check whether this page answers its purpose. Contact and other utility pages need not meet a minimum word count.',
  'schema-error':'Compare the schema sources listed in this finding. Correct the responsible theme or app; retain verified organisation details. This requires a theme-specific change.',
  'broken-link':'The destination in the evidence is missing. Correct the link on its source page, or prepare a redirect below if the old destination belongs to this store.',
  'reported-404':'This imported address is still missing. Redirect it to a relevant replacement, or remove it from tracking if it no longer needs monitoring.',
  '404':'Check whether the page is published or retired. Restore it or redirect its old URL to a relevant live destination.',
  'heading-structure':'Open the page and its theme template. Keep one page-level H1 and use appropriate section headings.',
  'heading-level-skip':'Open the page and theme template. Correct the skipped heading level without changing the visual design.',
  'canonical-missing':'Check the theme’s canonical URL output for this template.',
  'canonical-differs':'Check whether the canonical destination is intentional before editing the theme.',
  'http-error':'Check the reported storefront response. Rerun the audit after access or availability is restored.',
  '404-with-impressions':'Redirect the old address to the suggested live page. If there is no close match, leave it as a 404; a redirect to the home page is treated as a soft 404.',
  'unpublished-with-impressions':'Republish the page in Shopify if it should be live, or redirect its address to the suggested live page.',
  'invalid-gtin':'Check the barcode printed on the product or in the manufacturer’s specification and correct the variant in Shopify. Never make up a barcode; if there is none, confirm “No manufacturer barcode”.',
  'book-without-isbn':'Use the book flow: RankPilot suggests the publisher and 13-digit ISBN (978 or 979). Check the edition against the book’s copyright page, then save both for review.',
  'gtin-unusual-prefix':'Check with the supplier that this is the manufacturer’s GTIN rather than an internal or in-store number.',
  'vendor-placeholder':'Set the vendor in Shopify to the manufacturer, or to your store name for own-label products.',
  'vendor-near-duplicate':'Choose one spelling for this brand and use it on every product (Shopify bulk editor).',
  'vendor-store-on-book':'Use the book flow: find the publisher and ISBN, check the edition, then save both for review.',
  'vendor-mismatch':'If the brand named in the title makes this product, set it as the vendor.',
  'answer-missing-size':'Add the size in the description or confirm it in Product details. Fill specs for all products can read sizes already in the text.',
  'answer-missing-material':'Add what it is made from, or confirm Materials in Product details.',
  'answer-missing-included':'List what comes in the box, or confirm What is included in Product details.',
  'answer-missing-weight':'Add the weight in the description or confirm it in Product details.',
  'answer-missing-care':'Add short care or cleaning instructions.',
  'answer-missing-fit':'Say where it fits: a van locker, shelf, under a seat, or its packed size.',
  'answer-missing-delivery':'Add delivery information in Settings (store policies) or in the description.',
  'page-not-found':'Open the product in Shopify: check it is Active, available on the Online Store and has at least one image. Set it to Draft until it is ready, then run a fresh audit.',
  'product-schema-missing':'Check the product template in the theme editor and any structured-data app. Shopify themes normally output Product data; restore it rather than adding a second copy.',
  'product-schema-multiple':'Keep one source of Product data: the theme or one app. Remove the duplicate block or app embed, then recheck.',
  'rendered-no-images':'Add at least one image to this product in Shopify, then run a fresh audit.',
  'product-brand-missing':'Set the product vendor in Shopify to the manufacturer or your own brand.',
  'faq-not-live':'Add the RankPilot FAQ block to the product template: theme editor › Products › Add block › Apps › RankPilot FAQ. Review flagged FAQ answers first, then preview and publish. RankPilot rechecks the live pages after each FAQ change and on every audit.',
  'supplier-markup':'Choose “Clean supplier formatting” to prepare a formatting-only change. It removes buttons, forms, H1 and unsafe links, keeps every word, and waits for your approval.',
  'theme-leftover':'Check in Shopify whether this app is still installed and wanted. If not, duplicate the theme, remove the app snippet and its render line from theme.liquid, preview, then publish. Run a fresh audit to confirm.',
  'app-block-failed':'Open the theme editor on an affected page and remove the app block that shows as unavailable, or reinstall the app if you still need it.',
  'liquid-error':'Open the theme code and find the snippet named in the error. Usually left by a removed app; remove or fix it in a duplicate theme first.',
  'duplicate-head-tags':'Search theme.liquid and snippets for a second <title> or meta description (often an SEO app snippet). Keep Shopify’s own tags only.',
  'supplier-copy':'Rewrite the description in your own words using confirmed facts, or ask the agent for a reviewed rewrite. Keep specifications accurate.',
  'slow-response':'Check repeated PageSpeed measurements before changing the theme; one server observation is not a Core Web Vitals assessment.'
 };
 return {kind:'manual',label:'Guided review',detail:details[i.code] || 'Inspect this page and its source before editing. No supported automatic write is available for this finding.'};
}
type Change={id:string;resourceId:string;feature:string;status:string;error?:string|null};
type Job={id:string;kind:string;status:string;payload:string;error?:string|null};
export function findingProgress(issue:Issue,changes:Change[],jobs:Job[]) {
 // Release 19: only a change still in progress belongs to this finding. Applied, rejected, undone or
 // superseded changes are history; returning them sent the fix dialog to an old review (dead ends,
 // and "Keep Shopify's version" was unreachable).
 const OPEN=['pending','approved','applying','verifying','verification_failed','apply_failed','rollback_failed','conflict'];
 if(issue.code==='changed-outside')return {busy:false,message:'',changeId:undefined,canGenerate:true};
 const change=changes.find(c=>c.resourceId===issue.resourceId && c.feature===issue.feature && OPEN.includes(c.status));
 const open=(id?:string)=>id&&changes.some(c=>c.id===id&&OPEN.includes(c.status))?id:undefined;
 const job=jobs.find(j=>{try{const p=JSON.parse(j.payload);return j.kind==='optimise' && p.feature===issue.feature && Array.isArray(p.ids) && p.ids.includes(issue.resourceId);}catch{return false;}});
 if(job && ['queued','running'].includes(job.status)) return {busy:true,message:jobMessage(job),changeId:undefined,canGenerate:false};
 if(change && ['pending','approved','applying','verifying','verification_failed','apply_failed','rollback_failed','conflict'].includes(change.status)) {
  const labels:Record<string,string>={pending:'Ready for review; nothing published',approved:'Accepted; waiting to apply',applying:'Saving your change',verifying:'Checking your saved update automatically',verification_failed:'Could not verify the Shopify update',apply_failed:'Application failed; check the error before retrying',rollback_failed:'Rollback failed; check the error before retrying',conflict:'Newer Shopify edits need a fresh preview'};
  return {busy:['approved','applying','verifying'].includes(change.status),message:change.error || labels[change.status],changeId:change.id,canGenerate:change.status==='conflict'};
 }
 if(job) {
  const result=jobResults(job).find(r=>r.resourceId===issue.resourceId) || jobResults(job).find(r=>r.changeId && r.changeId===change?.id);
  return {busy:false,message:result ? resultMessage(result,changes) : jobMessage(job,changes),changeId:open(result?.changeId),canGenerate:true};
 }
 const last=changes.find(c=>c.resourceId===issue.resourceId && c.feature===issue.feature);
 return {busy:false,message:last ? `Previous proposal ${last.status==='rolled_back'?'undone':last.status.replaceAll('_',' ')}. You can prepare a new one.` : '',changeId:undefined,canGenerate:true};
}
