import {it,expect} from 'vitest';
import {metadataQuality,legacyWordCap} from '../app/core/metadata-quality';
import {schemaVerdict} from '../app/core/schema-verdict';
import {topicProfile,relevance} from '../app/core/topic-relevance';
import {defaults,type Payload} from '../app/core/types';
const description='A camping mug with a 350 ml capacity. Review the product details before choosing this camping mug, and check the listed capacity suits your requirements.';
const p={title:'The Camper Van Cookbook',seo:{title:'The Camper Van Cookbook | Van Life Emporium',description}} as Payload;
it('preserves a good title and summary against brand loss, shortened identity and shorter summaries',()=>{
 const result=metadataQuality(p,{title:'Camper Van Cookbook',description:'Useful recipes for the road.'},{...defaults,titleBrand:'Van Life Emporium',titleBrandMode:'preserve'});expect(result.after).toEqual(p.seo);expect(result.delta).toBe(0);
});
it('preserves punctuation in the original product name',()=>{
 const page={...p,title:'Sweet Dreams Art Print',seo:{title:'Sweet Dreams Art Print | Van Life Emporium',description:''}};
 const result=metadataQuality(page,{title:'Sweet-Dreams Print Van Life Emporium',description},defaults);expect(result.after.title).toBe(page.seo.title);expect(result.after.description).toBe(description);expect(result.delta).toBeGreaterThan(0);
});
it('filters cosmetic rewrites with no rubric improvement and flags old word-cap reviews',()=>{
 expect(metadataQuality(p,{...p.seo,description:description.replace('camping','outdoor')},defaults).delta).toBe(0);
 expect(legacyWordCap(['Checked against both limits: five words and 60 characters'])).toBe(true);expect(legacyWordCap(['50–60 characters; no word limit'])).toBe(false);
});
it('uses one schema verdict for missing collection coverage and property errors',()=>{
 expect(schemaVerdict({url:'https://s.test/collections/camping',types:['Organization','ContactPoint'],valid:true}).pass).toBe(false);
 expect(schemaVerdict({url:'https://s.test/collections/camping',types:['CollectionPage','ItemList','BreadcrumbList'],valid:true}).pass).toBe(true);
 expect(schemaVerdict({url:'https://s.test/products/mug',types:['Product'],valid:false,errors:['Product offers missing']}).pass).toBe(false);
});
it('does not propose storage baskets because they are merely mentioned in a campsite article body',()=>{
 expect(relevance(topicProfile('Winter campsites in Northern England','<p>Pack seagrass storage baskets.</p>'),topicProfile('Nesting Seagrass Storage Baskets'))).toBeNull();
});
