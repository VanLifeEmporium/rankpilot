import {describe,it,expect} from 'vitest';
import {inspectPage,parseReportedUrls,mapConcurrent} from '../app/core/technical-audit';
import {actionGroups,resourceHealth,opportunityQueries} from '../app/core/dashboard';
import {speedRecommendations} from '../app/core/performance';
describe('technical audit coverage',()=>{
 it('checks links beyond navigation and keeps external destinations',()=>{const html='<title>Page</title>'+Array.from({length:40},(_,i)=>`<a href="/pages/${i}">link</a>`).join('')+'<a href="https://external.example/guide">guide</a><a href="/cart/123:1">cart</a>';const r=inspectPage(html,'https://shop.example/', 'p','Page');expect(r.links).toHaveLength(41);expect(r.links).toContain('https://external.example/guide');});
 it('distinguishes intentionally empty alt from missing attributes',()=>{const r=inspectPage('<img alt="" src="decorative.png"><img src="product.png">','https://shop.example/','p','Page');expect(r.issues.find(i=>i.code==='live-alt-missing')?.detail).toContain('1 images');});
 it('does not classify nofollow as a critical error',()=>{expect(inspectPage('<a href="https://example.org" rel="nofollow sponsored">Paid</a>','https://shop.example/','p','Page').issues.find(i=>i.code==='nofollow-review')?.severity).toBe('notice');});
 it('parses Avada CSV and rejects foreign origins',()=>{expect(parseReportedUrls('Url,Status,Traffic\n/products/a,Unresolved,2\n"/products/a",Unresolved,2','https://shop.example')).toEqual(['/products/a']);expect(()=>parseReportedUrls('https://evil.example/a','https://shop.example')).toThrow();});
 it('limits concurrency and preserves output order',async()=>{let running=0,max=0;const result=await mapConcurrent([1,2,3,4,5],2,async x=>{running++;max=Math.max(max,running);await new Promise(r=>setTimeout(r,2));running--;return x*2;});expect(max).toBe(2);expect(result).toEqual([2,4,6,8,10]);});
});
describe('dashboard truthfulness',()=>{
 it('prioritises failures above subjective suggestions and groups title and summary',()=>{const groups=actionGroups([{resourceId:'p',title:'P',code:'supplier-language',severity:'warning',detail:''},{resourceId:'p',title:'P',code:'404',severity:'critical',detail:''},{resourceId:'q',title:'Q',code:'missing-meta-title',severity:'warning',detail:''},{resourceId:'q',title:'Q',code:'missing-meta-description',severity:'warning',detail:''}]);expect(groups[0].code).toBe('404');expect(groups.find(g=>g.code==='google-listings')?.count).toBe(1);});
 it('does not report unaudited families as healthy',()=>{expect(resourceHealth(['p'],[],false)).toBeNull();expect(resourceHealth([],[],true)).toBeNull();});
 it('identifies striking-distance queries with actual positions',()=>{expect(opportunityQueries([{keys:['p','q'],position:9,impressions:100,clicks:1},{keys:['p','q2'],position:21,impressions:100,clicks:0}])).toHaveLength(1);});
 it('sorts measurable speed opportunities and excludes passed checks',()=>{const r=speedRecommendations({url:'https://shop.example',audits:{a:{score:0,title:'Images',details:{type:'opportunity',overallSavingsMs:300}},b:{score:1,title:'Passed',details:{type:'opportunity',overallSavingsMs:600}},c:{score:0,title:'Scripts',details:{type:'opportunity',overallSavingsMs:500}}}});expect(r.map(x=>x.id)).toEqual(['c','a']);});
});
