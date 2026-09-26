import {z} from 'zod';
const image=z.object({id:z.string().min(1),alt:z.string().max(250)});
export function validateProposalValue(feature:string,value:unknown) {
 const shape= feature==='seo'?z.object({title:z.string().trim().min(1).max(255),description:z.string().max(500)}):
 feature==='alt'?z.array(image).min(1):
 feature==='filename'?z.array(z.object({id:z.string().min(1),filename:z.string().min(1).max(255)})).min(1):
 feature==='faq'?z.array(z.object({question:z.string().min(1),answer:z.string().min(1)})).min(1):
 feature==='redirect'?z.object({path:z.string().min(1),target:z.string().min(1)}):
 feature==='draft'?z.object({title:z.string().min(1),handle:z.string().min(1),descriptionHtml:z.string().min(1),published:z.literal(false)}):z.string().min(1);
 const result=shape.safeParse(value);
 if(!result.success)return 'This saved preview contains invalid or missing values. Reject it and generate a replacement.';
 if(['title','seo'].includes(feature)){
  const title=feature==='seo'?(value as {title:string}).title:String(value);
  if(!title.trim() || title.length>255)return 'Regenerate this proposal: the title must be present and under 256 characters.';
 }
 return null;
}
