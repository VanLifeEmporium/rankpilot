import type {Issue} from './types';
export const featureNames:Record<string,string>={title:'Product names',description:'Page descriptions',seo:'How your page looks on Google',alt:'Descriptions for images',filename:'Image file names',handle:'Page addresses',faq:'Answers to customer questions',links:'Links to related pages',redirect:'Forward an old page address',draft:'Blog draft'};
export const findingNames:Record<string,string>={
 'live-title-long':'Review a long Google title','live-description-long':'Review a long Google summary',
 'long-title':'Shorten a page title','duplicate-title':'Make page titles distinct','keyword-cannibalisation':'Check pages targeting the same search','possible-duplicate-product':'Check similar product listings','schema-error':'Check how search engines read your product details','canonical-missing':'Check the preferred page address','canonical-differs':'Check the preferred page address','heading-structure':'Check page headings','heading-level-skip':'Check page heading order','slow-response':'Check page loading speed','404':'Fix a missing page',
 'missing-meta-title':'Add a Google title','missing-meta-description':'Add a Google summary','long-meta-title':'Shorten a Google title','long-meta-description':'Shorten a Google summary',
 'duplicate-meta-description':'Make Google summaries distinct','duplicate-meta-title':'Make Google titles distinct','missing-alt':'Describe an image','thin-content':'Consider adding useful page details','supplier-language':'Optional wording suggestion',
 'reported-404':'Repair a reported missing page','live-alt-missing':'Describe storefront images','nofollow-review':'Review intentional nofollow links','image-loading-review':'Check image loading','live-title-missing':'Add the live page title','live-description-missing':'Add the live Google summary','sitemap-unavailable':'Restore the store sitemap','crawler-blocked':'Review crawler access',
 'missing-product-faq':'Answer customer questions','http-error':'Investigate unsuccessful page checks','broken-link':'Fix a broken link','missing-gtin':'Check the product barcode','large-image':'Check image loading size',
};
export function findingName(code:string){return findingNames[code] || 'Review this page check';}
export function findingExplanation(issue:Issue){
 if(['reported-404','404'].includes(issue.code))return 'Visitors using this address reach a missing page. A relevant replacement can help them find what they were looking for.';
 if(issue.code==='broken-link')return 'A link on this page sends visitors to a missing destination. Correct the link or redirect an old store address to a relevant working page.';
 if(issue.code==='missing-meta-title')return 'This page has no saved Google title. A clear title helps shoppers recognise what it offers; Google may otherwise choose one.';
 if(issue.code==='missing-meta-description')return 'This page has no saved Google summary. Suggest useful wording for shoppers; Google may still choose text from the page.';
 if(issue.code==='supplier-language')return 'Optional, low-confidence suggestion. Familiar phrases do not mean your writing is copied. Keep your own voice unless the replacement is genuinely better.';
 if(issue.code==='thin-content')return 'Optional: this page is short. Add details only if they help customers; a short contact or information page can be perfectly useful.';
 return issue.detail;
}
export function issuePriority(issue:Issue){
 if(['supplier-language','thin-content','missing-product-faq'].includes(issue.code))return 9;
 if(issue.severity==='critical'||['404','reported-404','broken-link'].includes(issue.code))return 0;
 if(['missing-meta-title','missing-meta-description','missing-alt'].includes(issue.code))return 1;
 return issue.severity==='warning'?2:3;
}
export function searchSummary(current?:{rows?:{clicks:number}[];start?:string;end?:string},previous?:{rows?:{clicks:number}[]}){
 if(!current?.rows)return 'Connect Google Search Console to see how often shoppers reach your shop from Google.';
 const sum=(rows:{clicks:number}[])=>rows.reduce((n,r)=>n+r.clicks,0);
 const now=sum(current.rows);
 if(!previous?.rows)return `${now} visits from Google search in the latest reporting period. We need an earlier period before showing a comparison.`;
 const delta=now-sum(previous.rows);
 return `${now} visits from Google search in the latest 28-day period — ${delta===0?'the same as':`${Math.abs(delta)} ${delta>0?'more':'fewer'} than`} the previous 28 days. These are clicks, not unique people. This comparison does not prove that your edits caused the change.`;
}

export function findingImpact(issue:Issue) {
 if(issue.code==='http-error')return {impact:'The crawler received an error response; this does not establish that shoppers cannot open the page',effort:'Review HTTP status and check time, then recheck the affected URL'};
 if(['404','broken-link','reported-404'].includes(issue.code))return {impact:'Helps visitors reach the right page',effort:'One shared destination; review before saving'};
 if(['missing-meta-title','missing-meta-description'].includes(issue.code))return {impact:'Makes your search listing clearer',effort:'Prepare and review a short preview'};
 if(['supplier-language','thin-content'].includes(issue.code))return {impact:'Optional editorial judgement; no ranking gain promised',effort:'Read the original first; keep it if it works'};
 return {impact:issue.severity==='critical'?'Restores access or essential page information':'A useful tidy-up; impact depends on the page',effort:issue.feature?'Review a generated preview':'Inspect the evidence and follow the steps'};
}
