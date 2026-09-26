import {describe,it,expect} from 'vitest';
import {brokenAddress,validRedirectPath} from '../app/core/broken-url';
import {removeBrokenLink} from '../app/core/remove-link';
import {auditCatalogue} from '../app/core/catalogue';
describe('guided missing address fixes',()=>{
 it('uses the broken destination rather than the page containing it',()=>{expect(brokenAddress({resourceId:'p',title:'P',code:'broken-link',severity:'warning',detail:'Link from https://shop.test/products/source to https://shop.test/pages/old returns 404.'},'https://shop.test')).toBe('/pages/old');});
 it('keeps external links identifiable instead of redirecting an unrelated store path',()=>{expect(brokenAddress({resourceId:'p',title:'P',code:'broken-link',severity:'warning',detail:'Link from https://shop.test/a to https://other.test/old returns 410.'},'https://shop.test')).toBe('https://other.test/old');});
 it('allows the homepage only as a destination',()=>{expect(validRedirectPath('/',true)).toBe(true);expect(validRedirectPath('/')).toBe(false);for(const p of ['//evil.test','/../admin','/cart/a','https://evil.test','/checkout'])expect(validRedirectPath(p,true)).toBe(false);});
 it('removes matching links but keeps their text and unrelated links',()=>{const r=removeBrokenLink('<p><a href="/old"><strong>Old product</strong></a> <a href="/other">Other</a></p>','/old','https://shop.test/products/p');expect(r.removed).toBe(1);expect(r.html).toContain('<strong>Old product</strong>');expect(r.html).toContain('href="/other"');expect(r.html).not.toContain('href="/old"');});
 it('refuses to invent a deletion when the link is in the theme',()=>expect(()=>removeBrokenLink('<p>Original copy</p>','/old','https://shop.test')).toThrow('no content was changed'));
});
describe('catalogue health score',()=>{
 it('counts checks rather than discarding every page with a finding',()=>{
 const rows=Array.from({length:100},(_,n)=>({id:String(n),title:'Page '+n,kind:'page',keyword:'unique '+n,facts:'{}',payload:JSON.stringify({title:'Page '+n,descriptionHtml:'<p>'+('Specific original detail. '.repeat(40))+'</p>',seo:{title:'Page '+n,description:''},images:[]})}));
 const result=auditCatalogue(rows);expect(result.issues.length).toBeGreaterThanOrEqual(100);expect(result.score).toBeGreaterThan(50);expect(result.score).toBe(Math.round(100*(result.checks-result.failed)/result.checks));
 });
});
