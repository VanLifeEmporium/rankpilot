import {it,expect} from 'vitest';
import {findingAction,findingKey,findingProgress,hasFaqSources} from '../app/core/finding-workflow';
import {defaults,type Issue} from '../app/core/types';
import {auditCatalogue} from '../app/core/catalogue';
const issue:Issue={resourceId:'r',title:'Mug',code:'missing-product-faq',severity:'notice',detail:'FAQ needed',feature:'faq'};
it('offers facts confirmation before unsupported FAQ generation',()=>{
 expect(findingAction(issue,{kind:'product',facts:'{}'},defaults).kind).toBe('facts');
 expect(hasFaqSources({included:{value:'A mug',source:'Supplier listing',confirmed:false}},defaults)).toBe(false);
 expect(findingAction(issue,{kind:'product',facts:JSON.stringify({included:{value:'A mug',source:'Supplier listing',confirmed:true}})},defaults).kind).toBe('generate');
});
it('uses stable finding identity across sorting and filtering',()=>{
 expect(findingKey(issue)).toBe(findingKey({...issue}));expect(findingKey({...issue,code:'missing-alt'})).not.toBe(findingKey(issue));
});
it('recovers job progress after leaving and returning to the audit',()=>{
 const job={id:'j',kind:'optimise',status:'running',payload:JSON.stringify({ids:['r'],feature:'faq'})};
 expect(findingProgress(issue,[],[job])).toMatchObject({busy:true,canGenerate:false});
 expect(findingProgress(issue,[{id:'c',resourceId:'r',feature:'faq',status:'pending'}],[{...job,status:'completed'}])).toMatchObject({changeId:'c',canGenerate:false,message:'Ready for review; nothing published'});
});
it('keeps failed application visible instead of offering another paid generation',()=>{
 expect(findingProgress(issue,[{id:'c',resourceId:'r',feature:'faq',status:'verification_failed',error:'Read-back mismatch'}],[])).toMatchObject({changeId:'c',canGenerate:false,message:'Read-back mismatch'});
});
it('gives specific guidance for GTIN, image size and schema findings',()=>{
 for(const code of ['missing-gtin','large-image','schema-error']){
  const action=findingAction({...issue,feature:undefined,code},undefined,defaults);
  expect(action.kind).toBe('manual');expect(action.detail).not.toContain('No supported automatic write');
 }
});
it('does not force contact-page filler to meet a word target',()=>{
 const result=auditCatalogue([{id:'r',title:'Contact',kind:'page',keyword:'',facts:'{}',payload:JSON.stringify({title:'Contact',handle:'contact',descriptionHtml:'<p>Contact our team.</p>',seo:{title:'Contact',description:'Contact Van Life Emporium.'},images:[],collections:[]})}]);
 expect(result.issues.some(i=>i.code==='thin-content')).toBe(false);
});
