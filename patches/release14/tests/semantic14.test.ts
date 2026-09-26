import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const state=vi.hoisted(()=>({key:'fixture',cache:[] as {key:string;value:string}[]}));
vi.mock('../app/db.server',()=>({default:{generationCache:{findMany:async()=>state.cache,upsert:async({create}:{create:{key:string;value:string}})=>state.cache.push(create)}}}));
vi.mock('../app/core/security.server',()=>({credentials:async()=>({openaiKey:state.key})}));
import {semanticLinks,cosine} from '../app/core/semantic-links.server';
const source={id:'a',title:'Off Grid Power Guide',kind:'article',handle:'power-guide',payload:JSON.stringify({descriptionHtml:'<p>Compare power stations and solar charging.</p>',blogHandle:'guides'})};
const targets=[{id:'b',title:'100W Solar Power Station',kind:'product',handle:'solar',payload:JSON.stringify({descriptionHtml:'Solar charging and stored power.'})},{id:'c',title:'Off Grid Power Generator',kind:'product',handle:'generator',payload:JSON.stringify({descriptionHtml:'Petrol generator.'})}];
beforeEach(()=>{state.cache=[];state.key='fixture';});afterEach(()=>vi.unstubAllGlobals());
it('filters below-threshold semantic matches and caches embeddings per source text',async()=>{
 const fetcher=vi.fn().mockImplementation(async()=>Response.json({data:[{index:0,embedding:[1,0]},{index:1,embedding:[1,0]},{index:2,embedding:[0,1]}]}));vi.stubGlobal('fetch',fetcher);
 const result=await semanticLinks('s',source,targets);expect(result).toHaveLength(1);expect(result[0].reason).toContain('Semantic relevance checked');expect(state.cache).toHaveLength(3);
 await semanticLinks('s',source,targets);expect(fetcher).toHaveBeenCalledTimes(1);
});
it('never falls back to unverified word matches after an unavailable provider',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(new Response('',{status:429})));
 await expect(semanticLinks('s',source,targets)).rejects.toThrow('No links have been added');
 state.key='';await expect(semanticLinks('s',source,targets)).rejects.toThrow('Connect OpenAI');
});
it('handles empty and unequal vectors without a false perfect match',()=>{expect(cosine([],[])).toBe(0);expect(cosine([1],[1,2])).toBe(0);expect(cosine([1,0],[0,1])).toBe(0);expect(cosine([1,2],[2,4])).toBeCloseTo(1);});
