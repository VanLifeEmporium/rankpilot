import {it,expect} from 'vitest';
import {htmlValue} from '../app/core/html-value';
import {citationMeasure,providerMessage} from '../app/core/provider-health';
import {merchantProduct} from '../app/core/merchant-product';
import {canonicalPage,pageGains,queryTotals} from '../app/core/analytics';
import {technicalHealth,storeScore} from '../app/core/store-score';
import {compactMetrics} from '../app/core/ui-data.server';
import {sourceSuggestions} from '../app/core/source-drafts';
import {topicProfile,relevance} from '../app/core/topic-relevance';
import type {Payload} from '../app/core/types';
const now=Date.parse('2026-09-26T12:00:00Z');
const input={metrics:[],technical:80,schemas:[],healthScores:{product:{score:80}},observations:[],now};
const metric=(provider:string,payload:unknown)=>({provider,period:'current',payload:JSON.stringify(payload)});
it('compares Shopify editor serialisation while retaining link targets and content',()=>{
 const a='<p>A &amp; B</p><section data-rankpilot="collection-guide"><h2>Explore</h2><p><b>Power</b> for camping.</p><ul><li><a title="See details" href="/products/power">Power station</a></li></ul></section>';
 const b='<p>A & B</p>\n<h2>Explore</h2>\n<p><strong>Power</strong> for camping.</p><ul><li><a href="/products/power" title="See details">Power station</a></li></ul>';
 expect(htmlValue(a)).toBe(htmlValue(b));
 expect(htmlValue(b.replace('/products/power','/products/other'))).not.toBe(htmlValue(a));
 expect(htmlValue(b.replace('Power station','Solar panel'))).not.toBe(htmlValue(a));
});
it('does not erase genuine style, image, numeric or merchant wrapper changes',()=>{
 for(const [a,b] of [['<p>350 ml</p>','<p>500 ml</p>'],['<img src="/a" alt="A">','<img src="/b" alt="A">'],['<p style="color:red">A</p>','<p>A</p>'],['<section class="merchant">A</section>','A']])expect(htmlValue(a)).not.toBe(htmlValue(b));
});
it('distinguishes an unavailable sampling run from valid zero citations',()=>{
 const rows=[{createdAt:'2026-09-25',cited:false}];
 expect(citationMeasure(rows,{status:'failed',completed:0},now).score).toBeNull();
 expect(citationMeasure(rows,{status:'completed',completed:1},now).score).toBe(0);
 expect(citationMeasure([],undefined,now).score).toBeNull();
 expect(citationMeasure(rows,{status:'partial',completed:1,failed:1},now).partial).toBe(true);
});
it('excludes failed sampling from the Store Score rather than punishing the store',()=>{
 const score=storeScore({...input,metrics:[metric('ai-sampling',{status:'failed',completed:0})],observations:[{createdAt:'2026-09-25',cited:false}]});
 expect(score.ai).toBeNull();expect(score.parts.find(p=>p.key==='ai')?.value).toBeNull();
 expect(providerMessage('The operation was aborted due to timeout')).toContain('too long');
});
it('reads Merchant API v1 names and gtins and respects identifier exemptions',()=>{
 const product=merchantProduct({name:'opaque',offerId:'opaque2',productAttributes:{title:'Solar power station',link:'https://shop.test/products/power',gtins:['1234567890123'],brand:'Maker',productTypes:['Power'],shipping:[{}]}});
 expect(product.title).toBe('Solar power station');expect(product.missing).toEqual([]);
 expect(merchantProduct({name:'n',offerId:'o',productAttributes:{identifierExists:false}}).missing).not.toContain('gtin');
});
it('folds variants and tracking URLs while retaining meaningful filters',()=>{
 expect(canonicalPage('https://shop.test/products/mug?variant=1&utm_source=x#size')).toBe('https://shop.test/products/mug');
 expect(canonicalPage('https://shop.test/collections/all?filter=blue')).toContain('filter=blue');
 const rows=[{keys:['https://shop.test/products/mug?variant=1','camping mug'],clicks:2,impressions:10,position:4},{keys:['https://shop.test/products/mug?variant=2','camping mug'],clicks:1,impressions:20,position:10}];
 const totals=queryTotals(rows);expect(totals).toHaveLength(1);expect(totals[0]).toMatchObject({clicks:3,impressions:30,position:8});
 const gains=pageGains({rows},{rows:[{...rows[0],clicks:1}]});expect(gains).toHaveLength(1);expect(gains[0].change).toBe(2);
});
it('feeds only measured technical signals into the composite and counts missing schema',()=>{
 const t=technicalHealth({...input,schemas:[{types:['Product'],valid:true},{types:[],valid:false}],metrics:[metric('pagespeed',{checkedAt:'2026-09-25',score:.6}),metric('indexation',{checkedAt:'2026-09-25',indexed:10,inspected:20,submitted:100})]});
 expect(t.schema).toBe(50);expect(t.score).toBe(66);expect(t.partial).toBe(true);
 expect(technicalHealth(input).score).toBe(80);
 expect(technicalHealth({...input,technical:undefined}).score).toBeNull();
});
it('does not retain stale speed or index checks in the score',()=>{
 const t=technicalHealth({...input,metrics:[metric('pagespeed',{checkedAt:'2026-01-01',score:1}),metric('indexation',{checkedAt:'2026-01-01',indexed:100,inspected:100,submitted:100})]});expect(t.score).toBe(80);expect(t.parts.slice(1).every(p=>p.value===null)).toBe(true);
});
it('keeps comparable periods and full score history without sending every old analytics payload',()=>{
 const metrics=[{provider:'gsc',period:'2026-08-27:2026-09-23',payload:JSON.stringify({start:'2026-08-27'})},{provider:'gsc',period:'2026-07-30:2026-08-26',payload:'{}'},{provider:'gsc',period:'2026-07-01:2026-07-28',payload:'{}'},...Array.from({length:50},(_,i)=>({provider:'store-score',period:String(i),payload:'{}'}))];
 const compact=compactMetrics(metrics);expect(compact.filter(m=>m.provider==='gsc')).toHaveLength(2);expect(compact.filter(m=>m.provider==='store-score')).toHaveLength(50);
});
it('chooses useful body evidence ahead of series boilerplate without inventing copy',()=>{
 const sentence='Compare Midlands campsites open through autumn and winter, including pitch prices, electric hookups and facilities for a practical campervan stop.';
 const p={title:'Midlands autumn and winter campsites',descriptionHtml:'<p>Post 2 of 6 in our UK Autumn & Winter Campervan Series.</p><p>'+sentence+'</p>',seo:{title:'',description:''},images:[],collections:[],handle:'midlands'} as Payload;
 expect(sourceSuggestions(p,'article').summary.value).toBe(sentence);
 expect(sourceSuggestions({...p,descriptionHtml:'<p>Post 2 of 6 in our UK Autumn & Winter Campervan Series.</p>'},'article').summary.value).toBe('');
 expect(sourceSuggestions(p,'article').primary).not.toMatch(/ UK$/);
});
it('rejects geographic and seasonal false matches and ranks power for off-grid gear',()=>{
 const guide=topicProfile('Autumn and winter campsites in Northern England','<p>Cook meals on a camping stove. Read our advice for safe winter trips.</p>');
 expect(relevance(guide,topicProfile('Northern Lights Aurora Projector'))).toBeNull();
 expect(relevance(guide,topicProfile('Summer Festival Essentials'))).toBeNull();
 expect(relevance(guide,topicProfile('Van Life Cookbook'))).not.toBeNull();
 const offGrid=topicProfile('Off Grid camping gear');
 expect(relevance(offGrid,topicProfile('100W Solar Power Station'))?.direct).toBe(true);
 expect(relevance(offGrid,topicProfile('Steering Wheel Lock'))).toBeNull();
 expect(relevance(offGrid,topicProfile('Lightweight Snow Shovel'))).toBeNull();
});
