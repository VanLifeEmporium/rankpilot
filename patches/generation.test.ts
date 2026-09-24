import {it,expect,vi,afterEach} from 'vitest';
vi.mock('../app/core/security.server',()=>({credentials:async()=>({openaiKey:'test'})}));
import {generateCopy,generateAlts,validateCopy} from '../app/core/generation.server';
import {inlineImages,updateInlineAlts} from '../app/core/image-content';
import {normalise,updateResource} from '../app/core/shopify-api.server';
import type {Payload} from '../app/core/types';
const p:Payload={title:'Camping mug',handle:'camping-mug',descriptionHtml:'<p>A compact camping mug. Capacity 350 ml.</p>',seo:{title:'',description:''},images:[],collections:[]};
const answer=(obj:any)=>new Response(JSON.stringify({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(obj)}]}]}),{status:200});
const imagePayload:Payload={...p,images:[{id:'img',url:'https://cdn.shopify.com/test.jpg',alt:'',filename:'test.jpg'}]};
it('repairs an overlong alt once and sends the length constraint to the provider',async()=>{
 const f=vi.fn().mockResolvedValueOnce(answer({alt:'x'.repeat(251),uncertain:false,reason:'Visible image'})).mockResolvedValueOnce(answer({alt:'A white mug on a wooden table.',uncertain:false,reason:'Visible image'}));
 vi.stubGlobal('fetch',f);
 const result=await generateAlts('s',imagePayload);
 expect(result.after[0].alt).toBe('A white mug on a wooden table.');expect(f).toHaveBeenCalledTimes(2);
 const request=JSON.parse(f.mock.calls[0][1].body);
 expect(request.text.format.schema.properties.alt.maxLength).toBe(250);
 expect(request.instructions).toContain('250 characters');
 expect(JSON.parse(f.mock.calls[1][1].body).input).toEqual(request.input);
});
it('stops after one failed shortening attempt with a readable error',async()=>{
 const f=vi.fn().mockImplementation(async()=>answer({alt:'x'.repeat(251),uncertain:false,reason:'Visible image'}));vi.stubGlobal('fetch',f);
 await expect(generateAlts('s',imagePayload)).rejects.toThrow('still too long after one shortening attempt');expect(f).toHaveBeenCalledTimes(2);
 expect(imagePayload.images[0].alt).toBe('');
});
it('accepts the boundary length without another charge',async()=>{
 const f=vi.fn().mockResolvedValue(answer({alt:'x'.repeat(250),uncertain:false,reason:'Visible image'}));vi.stubGlobal('fetch',f);
 expect((await generateAlts('s',imagePayload)).after[0].alt).toHaveLength(250);expect(f).toHaveBeenCalledTimes(1);
});
it('does not expose validation JSON or retry malformed results',async()=>{
 const f=vi.fn().mockResolvedValue(answer({alt:123,uncertain:false,reason:'bad'}));vi.stubGlobal('fetch',f);
 await expect(generateAlts('s',imagePayload)).rejects.toThrow('image description response was invalid');expect(f).toHaveBeenCalledTimes(1);
});
it('does not retry uncertain images even when their explanation is too long',async()=>{
 const f=vi.fn().mockResolvedValue(answer({alt:'x'.repeat(251),uncertain:true,reason:'Cannot distinguish the subject'}));vi.stubGlobal('fetch',f);
 await expect(generateAlts('s',imagePayload)).rejects.toThrow('Cannot distinguish');expect(f).toHaveBeenCalledTimes(1);
});
it('does not retry provider failures as length repairs',async()=>{
 const f=vi.fn().mockResolvedValue(new Response('{}',{status:429}));vi.stubGlobal('fetch',f);
 await expect(generateAlts('s',imagePayload)).rejects.toThrow('429');expect(f).toHaveBeenCalledTimes(1);
});
const proposal={changed:true,content:'<p>A compact camping mug with a capacity of 350 ml.</p>',title:'Camping mug | Van Life Emporium',description:'A compact camping mug with a 350 ml capacity.',reason:'Makes the capacity explicit in the summary.',missingFacts:[],evidence:[{claim:'350 ml',quote:'Capacity 350 ml.'}]};
afterEach(()=>vi.unstubAllGlobals());
it('rejects an unsupported numerical specification',()=>{
 expect(()=>validateCopy('Capacity 350 ml.',p.descriptionHtml,{...proposal,content:'Capacity 500 ml.',evidence:[{claim:'Capacity',quote:'Capacity'}]},'description')).toThrow(/number/);
});
it('rejects fabricated evidence',()=>{
 expect(()=>validateCopy('Capacity 350 ml.',p.descriptionHtml,{...proposal,evidence:[{claim:'350 ml',quote:'Made in Britain'}]},'description')).toThrow(/source/);
});
it('requires the second quality review to pass',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(answer(proposal)).mockResolvedValueOnce(answer({allowed:false,reason:'Important details removed'})));
 await expect(generateCopy('s',p,'product','description',{})).rejects.toThrow('Important details removed');
});
it('returns supported reviewed copy as a proposal only',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValueOnce(answer(proposal)).mockResolvedValueOnce(answer({allowed:true,reason:'Preserves capacity and identifies the product.'})));
 const result=await generateCopy('s',p,'product','description',{});
 expect(result.after).toContain('350 ml');
 expect(result.reasons[0]).toContain('source-reviewed-v1:');
});
it('leaves good content untouched without forcing a rewrite',async()=>{
 const f=vi.fn().mockResolvedValue(answer({...proposal,changed:false}));vi.stubGlobal('fetch',f);
 expect((await generateCopy('s',p,'product','seo',{})).after).toEqual(p.seo);
 expect(f).toHaveBeenCalledTimes(1);
});
it('handles an uncertain image without guessing',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(answer({alt:'',uncertain:true,reason:'Image is unreadable'})));
 await expect(generateAlts('s',{...p,images:[{id:'1',url:'https://cdn.shopify.com/a.jpg',alt:'',filename:'a.jpg'}]})).rejects.toThrow('unreadable');
});
it('retains existing alt text without a provider request',async()=>{
 const f=vi.fn();vi.stubGlobal('fetch',f);
 const value={...p,images:[{id:'1',url:'https://cdn.shopify.com/a.jpg',alt:'A white mug',filename:'a.jpg'}]};
 expect((await generateAlts('s',value)).after).toEqual([{id:'1',alt:'A white mug'}]);expect(f).not.toHaveBeenCalled();
});
it('changes only the selected inline image and escapes quotes',()=>{
 const html='<p>Keep this exact text</p><img src="https://cdn.shopify.com/a.jpg"><img src="https://cdn.shopify.com/b.jpg" alt="Keep me">';
 const images=inlineImages(html);
 const result=updateInlineAlts(html,[{id:images[0].id,alt:'A "mug"'}]);
 expect(result).toContain('<p>Keep this exact text</p>');
 expect(result).toContain('alt="Keep me"');
 expect(inlineImages(result)[0].alt).toBe('A "mug"');
});
it('imports article featured and inline images separately',()=>{
 const value=normalise({id:'gid://shopify/Article/1',title:'Story',handle:'story',body:'<img src="https://cdn.shopify.com/b.jpg">',image:{id:'featured',url:'https://cdn.shopify.com/a.jpg',altText:''}},'article');
 expect(value.images).toHaveLength(2);
 expect(value.images[1].id).toMatch(/^inline:/);
});
it('updates article featured alt through articleUpdate, not fileUpdate',async()=>{
 const calls:any[]=[];
 const client:any=async(query:string,options:any)=>{
 calls.push({query,options});
 return new Response(JSON.stringify({data:query.startsWith('query Resource')?{node:{id:'gid://shopify/Article/1',title:'Story',handle:'story',body:'<p>Keep</p>',image:{id:'featured',url:'https://cdn.shopify.com/a.jpg',altText:''}}}:{articleUpdate:{article:{id:'gid://shopify/Article/1'},userErrors:[]}}}));
 };
 await updateResource(client,'gid://shopify/Article/1','article','alt',[{id:'featured',alt:'A campervan'}]);
 expect(calls[1].query).toContain('articleUpdate');
 expect(calls[1].options.variables.input).toEqual({image:{altText:'A campervan'}});
});
it('rejects a description that removes an existing link',async()=>{
 vi.stubGlobal('fetch',vi.fn().mockResolvedValue(answer(proposal)));
 await expect(generateCopy('s',{...p,descriptionHtml:'<p>A compact camping mug. Capacity 350 ml.</p><a href="/pages/care">Care</a>'},'product','description',{})).rejects.toThrow('existing link');
});
it('binds inline image identities to the source URL',()=>{
 expect(inlineImages('<img src="https://cdn.shopify.com/a.jpg">')[0].id).not.toEqual(inlineImages('<img src="https://cdn.shopify.com/b.jpg">')[0].id);
});
it('refuses to draft an article without relevant catalogue evidence',async()=>{
 const {generateArticle}=await import('../app/core/generation.server');
 await expect(generateArticle('s','Kitchen guide',[])).rejects.toThrow('No relevant');
});
it('matches presentation-only whitespace and typographic quotes without weakening source checks',()=>{
 const output={...proposal,title:'Camper’s mug',description:'A mug with 350 ml capacity.',evidence:[{claim:"Camper's mug",quote:'Camper’s\u00a0mug'}]};
 expect(()=>validateCopy('Camper’s mug. Capacity 350 ml.',{},output,'seo')).not.toThrow();
});
it('identifies the missing source quote and rejects an empty claim',()=>{
 expect(()=>validateCopy('Camping mug',{}, {...proposal,evidence:[{claim:'350 ml',quote:'Capacity 350 ml.'}]},'seo')).toThrow('source evidence not found: “Capacity 350 ml.”');
 expect(()=>validateCopy('Capacity 350 ml.',{}, {...proposal,evidence:[{claim:'',quote:'Capacity 350 ml.'}]},'seo')).toThrow('does not quote the proposed text');
});
it('does not normalise away a changed specification or a negation',()=>{
 expect(()=>validateCopy('Not waterproof. Capacity 350 ml.',{}, {...proposal,evidence:[{claim:'350 ml',quote:'Waterproof. Capacity 350 ml.'}]},'seo')).toThrow('source evidence not found');
});
it('requires exact output excerpts in the generation instructions',async()=>{
 const f=vi.fn().mockResolvedValueOnce(answer(proposal)).mockResolvedValueOnce(answer({allowed:true,reason:'Supported.'}));vi.stubGlobal('fetch',f);
 await generateCopy('s',p,'product','seo',{});
 expect(JSON.parse(f.mock.calls[0][1].body).instructions).toContain('claim MUST be an exact non-empty excerpt');
 expect(f).toHaveBeenCalledTimes(2);
});
