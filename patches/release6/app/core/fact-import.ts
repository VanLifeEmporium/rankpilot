import type {Facts} from './types';
export const factKeys=['dimensions','weight','materials','power','compatibility','included','care'];
// RFC-style quoted cells, including commas/newlines and escaped quotes.
export function readCsv(input:string):string[][] {
 if(input.length>500000)throw new Error('CSV must be smaller than 500 KB.');
 const rows:string[][]=[];let row:string[]=[],cell='',quoted=false,closed=false;
 const push=()=>{row.push(cell.trim());cell='';closed=false;};
 for(let i=0;i<input.length;i++){
  const c=input[i];
  if(quoted){if(c==='"'){if(input[i+1]==='"'){cell+='"';i++;}else{quoted=false;closed=true;}}else cell+=c;continue;}
  if(c==='"'){if(cell.trim() || closed)throw new Error('Invalid CSV quoting.');quoted=true;}
  else if(c===',')push();
  else if(c==='\n' || c==='\r'){if(c==='\r' && input[i+1]==='\n')i++;push();if(row.some(Boolean))rows.push(row);row=[];}
  else if(closed && c.trim())throw new Error('Unexpected text after a quoted CSV cell.');
  else cell+=c;
 }
 if(quoted)throw new Error('A quoted CSV cell is not closed.');
 push();if(row.some(Boolean))rows.push(row);
 if(rows.length<2 || rows.length>501)throw new Error('Include a header and 1–500 product rows.');
 return rows;
}
export type FactImportItem={id:string;title:string;handle:string;facts:Facts;count:number};
export function previewFactImport(csv:string,resources:{id:string;title:string;handle:string;facts:string}[]):FactImportItem[]{
 const [raw,...rows]=readCsv(csv.replace(/^\uFEFF/,''));const headers=raw.map(h=>h.trim().toLowerCase());
 if(new Set(headers).size!==headers.length || !headers.includes('handle'))throw new Error('Use unique column headings including handle.');
 const allowed=new Set(['handle','source',...factKeys,...factKeys.map(k=>k+'_source')]);
 if(headers.some(h=>!allowed.has(h)))throw new Error('Unknown column. Map supplier columns to the supported headings shown below.');
 const seen=new Set<string>();
 return rows.map((cells,index)=>{
  if(cells.length!==headers.length)throw new Error(`Row ${index+2}: column count differs from the header.`);
  const entry=Object.fromEntries(headers.map((h,i)=>[h,cells[i]]));
  const matches=resources.filter(r=>r.handle===entry.handle);
  if(matches.length!==1)throw new Error(`Row ${index+2}: product handle does not match exactly one product.`);
  if(seen.has(entry.handle))throw new Error(`Duplicate product handle: ${entry.handle}`);seen.add(entry.handle);
  const resource=matches[0],facts:Facts=JSON.parse(resource.facts);let count=0;
  for(const key of factKeys){
   if(!entry[key])continue;
   const source=entry[key+'_source'] || entry.source;
   if(!source || source.length<3 || source.length>2000 || entry[key].length>1000)throw new Error(`Row ${index+2}: ${key} requires a value under 1,000 characters and a source reference (3–2,000 characters).`);
   // Never replace a verified fact. Imports are suggestions, even with a supplier source.
   if(facts[key]?.confirmed)continue;
   facts[key]={value:entry[key],source,confirmed:false};count++;
  }
  return {id:resource.id,title:resource.title,handle:resource.handle,facts,count};
 });
}
