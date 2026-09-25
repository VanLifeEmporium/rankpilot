import {it,expect,vi,afterEach} from 'vitest';
import {parse} from 'graphql';
import {fetchResource,normalise,type RemoteNode} from '../app/core/shopify-api.server';
import {workspaceJSON} from '../app/core/live-workspace';
import {searchSummary,issuePriority} from '../app/core/merchant-copy';
import type {Issue} from '../app/core/types';
afterEach(()=>vi.unstubAllGlobals());
it.each(['product','collection','page','article'])('reads explicit Google listing fields in a valid %s query',async kind=>{
 const node={id:'gid://shopify/Product/1',title:'Mug',handle:'mug',seo:{title:'Resolved',description:'Resolved'},seoTitle:{value:'Saved title'},seoDescription:{value:'Saved summary'}};
 const client=vi.fn(async(query:string)=>{
  const ast=parse(query);expect(ast.definitions).toHaveLength(1);
  expect(query).toContain('seoTitle:metafield(namespace:"global",key:"title_tag")');
  expect(query).toContain('seoDescription:metafield(namespace:"global",key:"description_tag")');
  return Response.json({data:{node}});
 });
 expect((await fetchResource(client,node.id,kind)).seo).toEqual({title:'Saved title',description:'Saved summary'});
});
it('does not replace explicit empty metadata with fallback content',()=>{
 const node={id:'1',title:'Mug',handle:'mug',seo:{title:'Fallback',description:'Fallback'},seoTitle:{value:''},seoDescription:null} as RemoteNode;
 expect(normalise(node,'product').seo).toEqual({title:'',description:'Fallback'});
});
it('refresh requests obtain a fresh Shopify ID token and reject login HTML',async()=>{
 const token=vi.fn().mockResolvedValueOnce('test-one').mockResolvedValueOnce('test-two');
 vi.stubGlobal('window',{shopify:{idToken:token}});
 const fetcher=vi.fn().mockResolvedValueOnce(Response.json({revision:'done'})).mockResolvedValueOnce(new Response('<html>Sign in</html>',{headers:{'Content-Type':'text/html'}}));
 vi.stubGlobal('fetch',fetcher);
 expect(await workspaceJSON('/app/job-status',false,new AbortController().signal)).toEqual({revision:'done'});
 expect(fetcher.mock.calls[0][1].headers.Authorization).toBe('Bearer test-one');
 await expect(workspaceJSON('/app/job-status',false,new AbortController().signal)).rejects.toThrow('Live refresh unavailable');
 expect(fetcher.mock.calls[1][1].headers.Authorization).toBe('Bearer test-two');
 expect(fetcher.mock.calls[0][1].redirect).toBe('error');
});
it('reports clicks honestly without implying people or caused improvements',()=>{
 const text=searchSummary({rows:[{clicks:14}]},{rows:[{clicks:7}]});
 expect(text).toContain('7 more');expect(text).toContain('not unique people');expect(text).toContain('does not prove');
 expect(searchSummary({rows:[{clicks:7}]})).toContain('need an earlier period');
});
it('keeps subjective content suggestions out of the top priority list',()=>{
 expect(issuePriority({code:'supplier-language',severity:'warning'} as Issue)).toBeGreaterThan(issuePriority({code:'missing-meta-description',severity:'warning'} as Issue));
});

it('a stuck ID-token request can time out without freezing further polling',async()=>{
 vi.stubGlobal('window',{shopify:{idToken:()=>new Promise(()=>{})}});
 const abort=new AbortController();const pending=workspaceJSON('/app/job-status',false,abort.signal);
 abort.abort(new Error('Timed out'));
 await expect(pending).rejects.toThrow('Timed out');
});
