import {describe,it,expect} from 'vitest';
import {searchVisibility,discoveryReadiness} from '../app/core/visibility-score';
import {actionGroups} from '../app/core/dashboard';
import {linkDiagnosis,linkTargets} from '../app/core/link-diagnosis';
import {removeBrokenLink} from '../app/core/remove-link';
import {metadataWarnings} from '../app/core/search-copy';
import {validateProposalValue} from '../app/core/proposal-value';
import {findingName} from '../app/core/merchant-copy';
import type {Issue} from '../app/core/types';
const now=Date.parse('2026-09-26');
const row=(url:string,position:number,impressions=20,clicks=0)=>({keys:[url,'buyer query'],position,impressions,clicks});
const snap=(rows:ReturnType<typeof row>[])=>({rows,start:'2026-08-25',end:'2026-09-21'});
const issue=(id:string,url='https://shop.test/collections/summer'):Issue=>({resourceId:id,title:id,code:'broken-link',severity:'warning',detail:`Link from https://shop.test/products/${id} to ${url} returns 404.`});
const resource=(id:string,title:string,kind='collection')=>({id,kind,title,handle:id,remoteId:'gid://shopify/Collection/1',payload:JSON.stringify({title,productsCount:13})});
describe('evidence-based visibility',()=>{
 it('keeps missing, old and zero-impression data unmeasured',()=>{
  expect(searchVisibility(undefined)).toBeNull();expect(searchVisibility(snap([]),undefined,now)?.score).toBeNull();
  expect(searchVisibility({...snap([row('https://shop.test/products/p',1)]),end:'2025-01-01'},undefined,now)?.score).toBeNull();
  expect(discoveryReadiness(82,null)).toBeNull();
 });
 it('keeps low traffic readiness below 55 despite high technical health',()=>{
  const v=searchVisibility(snap([row('https://shop.test/products/p',40,100,7)]),undefined,now);
  expect(discoveryReadiness(99,v,{cited:0,total:25})).toBeLessThanOrEqual(55);
  expect(v?.score).toBe(30);
 });
 it('reflects page-one blogs independently of poorly positioned products',()=>{
  const s=snap([row('https://shop.test/blogs/guides/wales',2,40,8),row('https://shop.test/products/chair',35,80,0)]);
  expect(searchVisibility(s,'article',now)?.score).toBeGreaterThan(searchVisibility(s,'product',now)!.score!);
  expect(searchVisibility(s,'collection',now)?.score).toBeNull();
 });
 it('weights observed positions by impressions and flags small samples',()=>{
  const s=searchVisibility(snap([row('https://shop.test/a',2,2,1),row('https://shop.test/b',20,18,0)]),undefined,now)!;
  expect(s.position).toBe(18.2);expect(s.top10).toBe(10);expect(s.lowSample).toBe(true);
 });
});
describe('shared causes and actionable links',()=>{
 it('groups six referring pages by destination without hiding a seventh different problem',()=>{
  const g=actionGroups([...Array.from({length:6},(_,i)=>issue(String(i))),issue('external','https://outside.test/event')]);
  expect(g).toHaveLength(2);expect(g[0].count).toBe(6);expect(g[0].items).toHaveLength(6);
 });
 it('includes the missing destination itself in its shared root cause',()=>{
  const g=actionGroups([issue('p'),{...issue('destination'),code:'404',link:{url:'https://shop.test/collections/summer',status:404,checkedAt:'2026-09-26'}}]);
  expect(g).toHaveLength(1);expect(g[0].count).toBe(2);
 });
 it('counts metadata pages identically in the summary and review selector',()=>{
  const g=actionGroups(['missing-meta-title','missing-meta-description'].map(code=>({...issue('p'),code,feature:'seo' as const})))[0];
  expect(g.count).toBe(1);expect(g.items).toHaveLength(1);expect(g.occurrences).toBe(2);
 });
 it('finds an existing collection, its products and the appropriate restore advice',()=>{
  const d=linkDiagnosis(issue('p'),'https://shop.test',[resource('summer','Summer festivals')]);
  expect(d.existing?.id).toBe('summer');expect(d.count).toBe(13);expect(d.advice).toContain('publication');
 });
 it('never offers an external address as a Shopify redirect',()=>{
  expect(linkDiagnosis(issue('p','https://outside.test/event'),'https://shop.test',[]).external).toBe(true);
 });
 it('ranks scanned related pages above generic pages and excludes the dead target',()=>{
  const r=linkTargets('/collections/summer',[resource('summer-new','Summer camping'),resource('general','All gifts'),resource('summer','Old summer'),resource('unscanned','Summer gear')],['https://shop.test/collections/summer-new','https://shop.test/collections/general','https://shop.test/collections/summer'],'https://shop.test');
  expect(r.map(x=>x.path)).toEqual(['/collections/summer-new','/collections/general']);
 });
 it('replaces only matching anchors and keeps link text and unrelated markup',()=>{
  const result=removeBrokenLink('<p><a href="https://outside.test/event">Event guide</a><a href="/care">Care</a></p>','https://outside.test/event','https://shop.test','/pages/events');
  expect(result.html).toContain('href="/pages/events">Event guide');expect(result.html).toContain('href="/care"');
 });
});
it('allows useful long titles with warnings while retaining structural validation',()=>{
 const title='10 Best Scenic Campervan Stays in Southern England | Views Worth the Drive';
 expect(validateProposalValue('seo',{title,description:'A grounded summary.'})).toBeNull();expect(metadataWarnings(title)).toHaveLength(1);
 expect(validateProposalValue('seo',{title:'',description:''})).not.toBeNull();
 expect(findingName('live-title-long')).toBe('Review a long Google title');expect(findingName('unrecognised_internal_key')).not.toContain('internal');
});
