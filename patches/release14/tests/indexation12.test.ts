import {beforeEach,afterEach,it,expect,vi} from 'vitest';
const fixture=vi.hoisted(()=>({previous:null as null|{payload:string},snapshots:[] as {rows:{url:string;verdict?:string;error?:string}[];indexed:number;inspected:number;submitted:number}[],demo:false}));
vi.mock('../app/db.server',()=>({default:{store:{findUniqueOrThrow:async()=>({domain:'https://store.test',demo:fixture.demo,settings:JSON.stringify({gscSite:'sc-domain:store.test'})})},metric:{findFirst:async()=>fixture.previous,upsert:async(args:{create:{payload:string}})=>fixture.snapshots.push(JSON.parse(args.create.payload))}}}));
vi.mock('../app/core/security.server',()=>({credentials:async()=>({})}));
vi.mock('../app/core/integrations.server',()=>({googleToken:async()=> 'test-token'}));
vi.mock('../app/core/crawl.server',()=>({publicFetch:async()=>new Response('<urlset>'+Array.from({length:25},(_,i)=>`<url><loc>https://store.test/products/p${i}</loc></url>`).join('')+'</urlset>'),limitedText:async(r:Response)=>r.text()}));
import {checkIndexation} from '../app/core/indexation.server';
beforeEach(()=>{fixture.previous=null;fixture.snapshots=[];fixture.demo=false;});afterEach(()=>vi.unstubAllGlobals());
it('persists bounded inspection batches and resumes without inventing unknown index status',async()=>{
 const f=vi.fn().mockResolvedValue(new Response(JSON.stringify({inspectionResult:{indexStatusResult:{verdict:'PASS',coverageState:'Indexed'}}})));f.mockImplementation(async()=>new Response(JSON.stringify({inspectionResult:{indexStatusResult:{verdict:'PASS',coverageState:'Indexed'}}})));vi.stubGlobal('fetch',f);
 await checkIndexation('s');expect(f).toHaveBeenCalledTimes(20);expect(fixture.snapshots.at(-1)).toMatchObject({submitted:25,inspected:20,indexed:20});
 fixture.previous={payload:JSON.stringify(fixture.snapshots.at(-1))};f.mockClear();await checkIndexation('s');expect(f).toHaveBeenCalledTimes(5);expect(fixture.snapshots.at(-1)).toMatchObject({submitted:25,inspected:25,indexed:25});
});
it('keeps provider failures unknown and stops repeating an access failure',async()=>{
 const f=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({error:{message:'Access denied'}}),{status:403}));vi.stubGlobal('fetch',f);await checkIndexation('s');expect(f).toHaveBeenCalledTimes(3);expect(fixture.snapshots.at(-1)).toMatchObject({submitted:25,inspected:0,indexed:0});expect(fixture.snapshots.at(-1)?.rows.every(r=>r.error==='Access denied')).toBe(true);
});
it('never pretends demo data came from Google',async()=>{fixture.demo=true;await expect(checkIndexation('s')).rejects.toThrow('live Search Console');expect(fixture.snapshots).toHaveLength(0);});
it('reports progress after every saved row and rechecks an already inspected URL',async()=>{
 const f=vi.fn().mockImplementation(async()=>new Response(JSON.stringify({inspectionResult:{indexStatusResult:{verdict:'PASS',coverageState:'Indexed'}}})));vi.stubGlobal('fetch',f);const progress=vi.fn().mockResolvedValue(undefined);
 await checkIndexation('s',{onProgress:progress});expect(progress).toHaveBeenCalledTimes(20);expect(progress).toHaveBeenLastCalledWith(20,25);
 fixture.previous={payload:JSON.stringify(fixture.snapshots.at(-1))};f.mockClear();await checkIndexation('s',{url:'https://store.test/products/p0'});expect(f).toHaveBeenCalledTimes(1);expect(fixture.snapshots.at(-1)).toMatchObject({inspected:20,lastRecheck:{url:'https://store.test/products/p0',before:{verdict:'PASS'},after:{verdict:'PASS'}}});
});
