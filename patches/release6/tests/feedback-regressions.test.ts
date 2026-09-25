import {it,expect} from 'vitest';
import {matchesField} from '../app/core/service.server';
import {percentage,changeStatus,reviewable} from '../app/core/workflow-ui';
import {supplierSignals,pageInstructions,titleBrandInstructions} from '../app/core/content-policy';
import {previewFactImport} from '../app/core/fact-import';
import {defaults,type Payload} from '../app/core/types';
it('compares display-equivalent metadata but never different specs or punctuation',()=>{
 expect(matchesField({title:'Mug &amp; Bowl',description:'40D nylon\u00a0with TPU'},{title:'Mug & Bowl',description:'40D nylon with TPU'},'seo')).toBe(true);
 expect(matchesField({title:'Camping mug',description:'400 ml'},{title:'Camping mug',description:'350 ml'},'seo')).toBe(false);
 expect(matchesField({title:'A–B',description:'x'},{title:'A-B',description:'x'},'seo')).toBe(false);
});
it('renders missing and invalid fact metrics without broken percentages',()=>{
 for(const value of [null,undefined,NaN,Infinity,''])expect(percentage(value)).toBe('—');
 expect(percentage(0)).toBe('0%');expect(percentage(33.33)).toBe('33%');
});
it('only counts actionable drafts and translates failure badges',()=>{
 expect(reviewable({status:'pending',blockers:'[]'})).toBe(true);
 expect(reviewable({status:'pending',blockers:'["Needs a new review"]'})).toBe(false);
 expect(changeStatus('verification_failed')).toBe('Saved value not confirmed');
});
it('protects the original brand story from supplier heuristics and product templates',()=>{
 const p={descriptionHtml:'We rejected wholesale prices and hot sale hype. Our faded yellow LDV has done two engines.'} as Payload;
 expect(supplierSignals('article',p)).toEqual([]);
 expect(pageInstructions('article','Why we started Van Life Emporium')).toContain('Preserve the personal narrative');
 expect(supplierSignals('product',{descriptionHtml:'Our best quality mug.'} as Payload)).toHaveLength(1);
 expect(titleBrandInstructions({...defaults,titleBrandMode:'append',titleBrand:'VLE'})).toContain('five words AND 60 characters');
});
it('previews quoted supplier CSV without confirming facts or replacing verified values',()=>{
 const rows=previewFactImport('handle,materials,included,source\r\nmug,"Steel, ceramic",Mug,"Spec sheet, page 2"',[{id:'r',title:'Mug',handle:'mug',facts:JSON.stringify({included:{value:'Mug and lid',source:'Verified sheet',confirmed:true}})}]);
 expect(rows[0].count).toBe(1);expect(rows[0].facts.materials).toEqual({value:'Steel, ceramic',source:'Spec sheet, page 2',confirmed:false});expect(rows[0].facts.included.value).toBe('Mug and lid');
});
it('rejects missing sources, unknown products and duplicate rows before any import',()=>{
 const r=[{id:'r',title:'Mug',handle:'mug',facts:'{}'}];
 expect(()=>previewFactImport('handle,materials\nmug,Steel',r)).toThrow('source reference');
 expect(()=>previewFactImport('handle,materials,source\nunknown,Steel,Sheet',r)).toThrow('match exactly');
 expect(()=>previewFactImport('handle,materials,source\nmug,Steel,Sheet\nmug,Steel,Sheet',r)).toThrow('Duplicate');
});
