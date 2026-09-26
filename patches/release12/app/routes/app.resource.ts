import {pageSuggestions} from '../core/suggestions.server';
import type {LoaderFunctionArgs} from 'react-router';
import prisma from '../db.server';
import {context} from '../core/context.server';
import {displayResource} from '../core/ui-data.server';
export async function loader({request}:LoaderFunctionArgs){
 const {store}=await context(request);const id=new URL(request.url).searchParams.get('id');
 if(!id)return new Response('Select a product',{status:400});
 const resource=await prisma.resource.findFirst({where:{id,storeId:store.id}});
 if(!resource)return new Response('Product unavailable',{status:404});
 return Response.json({...displayResource(resource,true),plan:await pageSuggestions(store.id,resource.id)},{headers:{'Cache-Control':'no-store'}});
}
