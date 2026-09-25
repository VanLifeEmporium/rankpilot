import type {LoaderFunctionArgs} from 'react-router';
import {loadUI} from '../core/ui.server';
export async function loader({request}:LoaderFunctionArgs) {
 const url=new URL(request.url);
 const section=url.searchParams.get('section') || 'dashboard';
 if(!['dashboard','audit','reviews','products','collections','content','aeo','reports','settings'].includes(section))return Response.json({error:'Unknown section'},{status:400});
 // Keep authentication headers and query context. loadUI uses the path only to
 // choose the appropriate presentation; its normal store authentication applies.
 url.pathname=section==='dashboard'?'/app':`/app/${section}`;
 return Response.json(await loadUI(new Request(url,request)),{headers:{'Cache-Control':'no-store'}});
}
