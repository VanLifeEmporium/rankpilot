export type SchemaEvidence={url?:string;types:unknown[];valid?:boolean;errors?:string[];checkedAt?:string};
/** One verdict for dashboards and inventories, including legacy scans. */
export function schemaVerdict(s:SchemaEvidence){
 const types=s.types.flat().filter((t):t is string=>typeof t==='string');
 let path='';try{path=new URL(s.url||'','https://store.invalid').pathname;}catch{/* unknown template */}
 const required=path.startsWith('/products/')?['Product']:path.startsWith('/collections/')?['CollectionPage','ItemList','BreadcrumbList']:path.startsWith('/blogs/')&&path.split('/').length>3?['Article']:[];
 const missing=required.filter(t=>!types.includes(t));
 const errors=[...(s.errors||[]),...missing.map(t=>`${t} is missing for this template`)];
 if(!types.length)errors.push('No JSON-LD was found');
 if(s.valid!==true&&!errors.length)errors.push('The saved scan did not confirm valid properties. Run a fresh scan for details.');
 return {pass:s.valid===true&&types.length>0&&!errors.length,errors:[...new Set(errors)],types};
}
