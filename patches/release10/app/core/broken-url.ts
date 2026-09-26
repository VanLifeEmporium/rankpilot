import type {Issue} from './types';
/** Uses the destination, never the referring page, for legacy crawl findings. */
export function brokenAddress(issue:Issue, domain:string, resource?:{kind:string;handle:string;payload:string}) {
 let value=issue.code==='reported-404'?issue.resourceId.replace(/^reported:/,''):issue.code==='broken-link'?issue.detail.match(/ to (https?:\/\/\S+) returns (?:404|410)\./)?.[1]:'';
 if(!value && issue.code==='404' && resource){const p=JSON.parse(resource.payload);value=p.url || `/${resource.kind==='article'?`blogs/${p.blogHandle}`:resource.kind+'s'}/${resource.handle}`;}
 if(!value)return '';
 try {const u=new URL(value,domain);return u.origin===new URL(domain).origin?u.pathname+u.search:u.href;}catch{return '';}
}
export function validRedirectPath(value:string, target=false){
 return (target && value==='/') || (/^\/[a-zA-Z0-9][a-zA-Z0-9_./-]*$/.test(value) && !value.includes('..') && !/^\/(cart|checkout|account|admin|apps)(\/|$)/i.test(value));
}
