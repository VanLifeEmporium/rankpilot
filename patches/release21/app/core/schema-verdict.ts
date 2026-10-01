export type SchemaEvidence={url?:string;types:unknown[];valid?:boolean;errors?:string[];checkedAt?:string};
/** One verdict for dashboards and inventories, including legacy scans. */
export function schemaVerdict(s:SchemaEvidence){
 const types=s.types.flat().filter((t):t is string=>typeof t==='string');
 let path='';try{path=new URL(s.url||'','https://store.invalid').pathname;}catch{/* unknown template */}
 // Release 21: a collection needs one of these, not all three (Google has no CollectionPage rich result and most themes add only breadcrumbs);
 // the home page needs Organization or WebSite so search and AI answers can identify the store.
 const isHome=path==='/'||path==='';
 const required=path.startsWith('/products/')?['Product']:path.startsWith('/blogs/')&&path.split('/').filter(Boolean).length>2?['BlogPosting|Article|NewsArticle']:path.startsWith('/collections/')?['BreadcrumbList|ItemList|CollectionPage']:isHome&&s.url?['Organization|WebSite|OnlineStore']:[];
 const missing=required.filter(t=>!t.split('|').some(x=>types.includes(x))).map(t=>t.split('|').join(' or '));
 const errors=[...(s.errors||[]),...missing.map(t=>`${t} is missing for this template`)];
 if(!types.length)errors.push('No JSON-LD was found');
 if(s.valid!==true&&!errors.length)errors.push('The saved scan did not confirm valid properties. Run a fresh scan for details.');
 return {pass:s.valid===true&&types.length>0&&!errors.length,errors:[...new Set(errors)],types};
}
