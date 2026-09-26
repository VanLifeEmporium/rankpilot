import {describe,it,expect} from 'vitest';
import {storeScore,revenueIndex,observedPage} from '../app/core/store-score';
import {sourceDraft,sourceSuggestions} from '../app/core/source-drafts';
import {relevantLinks,incomingPlan} from '../app/core/link-intelligence';
import {defaults,type Payload} from '../app/core/types';
const now=Date.parse('2026-09-26T12:00:00Z');
const payload:Payload={title:'Ceramic camping mug',handle:'ceramic-mug',descriptionHtml:'<p>Material: Ceramic</p><p>A handmade ceramic mug with a blue glaze.</p>',seo:{title:'',description:''},collections:[],images:[{id:'i',url:'https://cdn.shopify.com/mug.jpg',filename:'mug.jpg',alt:''}],tags:['Blue mugs'],productType:'Mugs'};
const gsc=(clicks=20)=>({provider:'gsc',period:'2026-08-27:2026-09-23',payload:JSON.stringify({start:'2026-08-27',end:'2026-09-23',rows:[{keys:['https://shop.test/products/ceramic-mug','mug'],clicks,impressions:400,position:5}]})});
const scoreInput={metrics:[gsc()],technical:80,healthScores:{product:{score:90},collection:{score:70},article:{score:80}},observations:Array.from({length:10},()=>({createdAt:'2026-09-25',cited:true})),now};
describe('honest Store Score',()=>{
 it('declares requested weights and excludes unavailable revenue instead of assuming zero',()=>{const s=storeScore(scoreInput);expect(s.parts.map(p=>p.weight)).toEqual([30,20,15,10,15,10]);expect(s.parts[4].value).toBeNull();expect(s.coverage).toBe(85);expect(s.score).toBeGreaterThan(55);expect(s.limited).toBe(true);});
 it('caps a technically tidy site when it has fewer than ten clicks',()=>{const s=storeScore({...scoreInput,metrics:[gsc(1)],technical:100});expect(s.score).toBeLessThanOrEqual(55);expect(s.capped).toBe(true);expect(s.parts[0].low).toBe(true);});
 it('does not invent absent observations or a score for an unaudited store',()=>{const s=storeScore({metrics:[],healthScores:{},observations:[],now});expect(s.score).toBeNull();expect(s.parts.every(p=>p.value===null)).toBe(true);});
 it('excludes stale search and old AI samples',()=>{const s=storeScore({...scoreInput,now:now+90*86400000});expect(s.search?.score).toBeNull();expect(s.ai).toBeNull();expect(s.capped).toBe(true);});
 it('uses preceding 90 days vs current 28 without overlapping the baseline',()=>{const rows=Array.from({length:118},(_,i)=>({dimensionValues:[{value:new Date(Date.parse('2026-05-29')+i*86400000).toISOString().slice(0,10).replaceAll('-','')}],metricValues:[{value:i<90?'1':'2'}]}));const r=revenueIndex({start:'2026-05-29',end:'2026-09-23',rows},now);expect(r).toEqual({score:100,current:56,baseline:90,ratio:2});});
 it('requires a nonzero complete baseline',()=>{expect(revenueIndex({start:'2026-09-01',end:'2026-09-23',rows:[]},now)).toBeNull();expect(revenueIndex({start:'2026-05-29',end:'2026-09-23',rows:[]},now)).toBeNull();});
 it('does not invent zero clicks for an unreported page',()=>{expect(observedPage([{keys:['https://shop.test/products/other'],clicks:3,impressions:20}],'/products/mug')).toBeNull();});
});
describe('source first suggestions',()=>{
 it('preserves existing metadata and marks extracted facts as unconfirmed',()=>{const p={...payload,seo:{title:'My own title',description:'My own checked description'}};const s=sourceSuggestions(p,'product');expect(s.title.value).toBe(p.seo.title);expect(s.summary.value).toBe(p.seo.description);expect(s.facts.materials.confirmed).toBe(false);expect(s.alts[0].value).toBe('');expect(s.secondary).toContain('Mugs');});
 it('prepares a draft from complete source wording and discloses its review method',()=>{const d=sourceDraft(payload,'product',defaults);expect(d.after.description).toBe('A handmade ceramic mug with a blue glaze.');expect(d.reasons[0]).toContain('not had an AI content review');expect(d.after.title).toBe(payload.title);});
 it('does not truncate a long factual statement or invent missing metadata',()=>{expect(()=>sourceDraft({...payload,descriptionHtml:'<p>'+('A qualification '.repeat(80))+'</p>'},'product',defaults)).toThrow('no complete');});
 it('does not populate a specification from an unlabelled inference',()=>{expect(sourceSuggestions({...payload,descriptionHtml:'<p>Perfect for long journeys with a kettle.</p>'},'product').facts.power).toBeUndefined();});
});
const r=(id:string,title:string,kind='collection',descriptionHtml='')=>({id,title,kind,handle:title.toLowerCase().replaceAll(' ','-'),payload:JSON.stringify({...payload,title,descriptionHtml,productsCount:3})});
describe('relevant links',()=>{
 it('suppresses broad matches and promotes topical commercial destinations',()=>{const source=r('blog','Choosing a portable fridge','article','<p>A portable fridge for a journey.</p>');const matches=relevantLinks(source,[r('fridge','Portable fridge'),r('irrelevant','Camping outdoor')]);expect(matches.map(m=>m.id)).toEqual(['fridge']);expect(matches[0].reason).toContain('unmeasured');});
 it('avoids duplicate links including absolute addresses',()=>{const source=r('blog','Portable fridge guide','article','<a href="https://shop.test/collections/portable-fridge">Fridge</a>');expect(relevantLinks(source,[r('fridge','Portable fridge')])).toHaveLength(0);});
 it('excludes unpublished and empty destinations',()=>{const target=r('target','Portable fridge');target.payload=JSON.stringify({...payload,productsCount:0});expect(relevantLinks(r('blog','Portable fridge guide','article'),[target])).toHaveLength(0);});
 it('finds a relevant incoming source without claiming full-site orphan coverage',()=>{const target=r('blog','Portable fridge guide','article');const source=r('collection','Portable fridge');const plan=incomingPlan(target,[target,source]);expect(plan.count).toBe(0);expect(plan.limited).toBe(true);expect(plan.suggestions[0].id).toBe('collection');});
});
