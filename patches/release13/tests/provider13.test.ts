import {it,expect,vi,beforeEach,afterEach} from 'vitest';
const state=vi.hoisted(()=>({snapshots:[] as Record<string,unknown>[],answers:[] as unknown[]}));
vi.mock('../app/db.server',()=>({default:{store:{findUniqueOrThrow:async()=>({active:true,demo:false,domain:'https://vanlifeemporium.com'})},metric:{upsert:async(v:{create:{payload:string}})=>{state.snapshots.push(JSON.parse(v.create.payload));}},event:{create:vi.fn()},observation:{count:async()=>0,create:async(v:unknown)=>{state.answers.push(v);}}}}));
vi.mock('../app/core/security.server',()=>({credentials:async()=>({openaiKey:'test-key'})}));
import {trackVisibility} from '../app/core/integrations.server';
beforeEach(()=>{state.snapshots=[];state.answers=[];});
afterEach(()=>vi.unstubAllGlobals());
const response=()=>Response.json({status:'completed',output:[{type:'web_search_call',status:'completed'},{content:[{type:'output_text',text:'Independent recommendations include Other Store.',annotations:[{type:'url_citation',url:'https://other.example/products'}]}]}]});
it('counts completed grounded answers without citations to this store as measured zero',async()=>{
 const f=vi.fn().mockImplementation(async()=>response());vi.stubGlobal('fetch',f);
 expect(await trackVisibility('s')).toBe(2);expect(state.answers).toHaveLength(2);expect(state.snapshots.at(-1)).toMatchObject({status:'completed',completed:2,failed:0});
 const body=JSON.parse(f.mock.calls[0][1].body);expect(body.reasoning.effort).toBe('low');expect(body.tool_choice).toBe('required');
});
it('records unavailable sampling separately and never stores failed requests as answers',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValue(new DOMException('Timeout','TimeoutError')));
 await expect(trackVisibility('s')).rejects.toThrow('No AI samples completed');expect(state.answers).toHaveLength(0);expect(state.snapshots.at(-1)).toMatchObject({status:'failed',completed:0,failed:2});
});
it('does not treat an incomplete reasoning response as a non-citation',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockImplementation(async()=>Response.json({status:'incomplete',output:[{content:[{type:'output_text',text:'Partial answer'}]}]})));
 await expect(trackVisibility('s')).rejects.toThrow('No AI samples completed');expect(state.answers).toHaveLength(0);
});
it('labels partial provider success and keeps its successful observations',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockRejectedValueOnce(new Error('Temporary timeout')).mockImplementation(async()=>response()));
 expect(await trackVisibility('s')).toBe(1);expect(state.snapshots.at(-1)).toMatchObject({status:'partial',completed:1,failed:1});expect(state.answers).toHaveLength(1);
});
