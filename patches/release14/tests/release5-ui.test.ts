import {it,expect} from 'vitest';
import {readFileSync} from 'node:fs';
import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {Guidance,SectionHeading} from '../app/components/SectionHeading';
import {ChangeValues} from '../app/components/ChangeValues';
import {subsectionGuide} from '../app/core/subsection-guide';
import {updateConnection} from '../app/core/connections';
import {displayResource,displayChange} from '../app/core/ui-data.server';
import type {Resource,Change} from '@prisma/client';
import {schemaNodes,validateSchema} from '../app/core/crawl.server';
import {jobLabel} from '../app/core/job-feedback';
it('renders a purpose and keyboard-accessible why/how accordion for every panel heading',()=>{
 const file=readFileSync('app/components/Workspace.tsx','utf8');
 for(const match of file.matchAll(/<SectionHeading title="([^"]+)"/g)){
  expect(subsectionGuide[match[1]],match[1]).toBeDefined();
  const html=renderToStaticMarkup(createElement(SectionHeading,{title:match[1]}));expect(html).toContain('<details>');expect(html).toContain('Why it matters.');expect(html).toContain('How to use it.');
 }
 expect(renderToStaticMarkup(createElement(Guidance,{title:'Product facts'}))).toContain('Auto-populate');
});
it('uses readable values and safely escapes unexpected preview content',()=>{
 const html=renderToStaticMarkup(createElement(ChangeValues,{feature:'seo',value:{title:'Camping mug',description:'<script>bad()</script>'}}));
 expect(html).toContain('Google title');expect(html).not.toContain('<script>');expect(html).not.toContain('"title":');
 expect(()=>renderToStaticMarkup(createElement(ChangeValues,{feature:'alt',value:{broken:true}}))).not.toThrow();
});
it('keeps blank saved keys, isolates disconnects and rejects invalid account uploads',()=>{
 const existing={openaiKey:'secret',openaiModel:'model',bingKey:'other'};
 expect(updateConnection(existing,'openai','','')).toEqual(existing);
 expect(updateConnection(existing,'openai','','',true)).toEqual({bingKey:'other'});
 expect(()=>updateConnection({},'google','{}','')).toThrow('not a Google');
 expect(()=>updateConnection({},'openai','bad key','')).toThrow('without spaces');
 expect(()=>updateConnection({},'arbitrary','value','')).toThrow('listed connection');
 expect(existing.openaiKey).toBe('secret');
});
it('keeps list payloads small and removes raw provider data',()=>{
 const r={id:'r',title:'Mug',handle:'mug',facts:'{}',payload:JSON.stringify({title:'Mug',descriptionHtml:'x'.repeat(50000),raw:{secret:'internal'},images:[],collections:[]})} as Resource;
 const list=displayResource(r);expect(list.payload.length).toBeLessThan(500);expect(list.payload).not.toContain('internal');expect(JSON.parse(displayResource(r,true).payload).descriptionHtml).toHaveLength(50000);
});
it('blocks malformed saved previews while keeping the review page renderable',()=>{
 const c={before:'{',after:'oops',blockers:'null',reasons:'{}'} as Change;
 const shown=displayChange(c);expect(JSON.parse(shown.blockers)).toHaveLength(1);expect(shown.before).toBe('null');expect(shown.reasons).toBe('[]');
});
it('checks nested offers without labelling distinct anonymous offers duplicates',()=>{
 const {nodes}=schemaNodes('<script type="application/ld+json">'+JSON.stringify({'@type':'Product',name:'Mug',image:'https://store.test/mug.jpg',offers:[{'@type':'Offer',price:'2',priceCurrency:'GBP',availability:'InStock'},{'@type':'Offer',price:'3'}]})+'</script>');
 expect(nodes).toHaveLength(3);expect(validateSchema(nodes)).toEqual(['Incomplete Offer']);
});
it('labels a completed analytics task containing errors as needing attention',()=>{
 expect(jobLabel({kind:'analytics',status:'completed',payload:JSON.stringify({result:[{error:'No access'}]})})).toBe('needs attention');
});
