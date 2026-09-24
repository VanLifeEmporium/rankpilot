import { it, expect } from 'vitest';
import { optimise } from '../app/core/catalogue';
import { defaults, type Payload } from '../app/core/types';
const p: Payload = {
 title: 'Winter Van Life Essentials', handle: 'winter-van-life-essentials',
 descriptionHtml: '<p>Cosy blankets, camping mugs, food flasks and warm lighting for quieter roads and snug campervan evenings.</p>',
 seo: { title: 'Winter Van Life Essentials | Van Life Emporium', description: 'Shop winter van life essentials: cosy blankets, camping mugs, food flasks and warm lighting for quieter roads, slow mornings and snug campervan evenings.' },
 images: [], collections: []
};
it('preserves winter collection metadata, including an overlong description', () => {
 const result = optimise(p, 'collection', 'seo', {}, '', defaults);
 expect(result.after).toEqual(p.seo);
});
it('fills only a missing title without deleting the existing description', () => {
 const input = {...p, seo: {...p.seo, title: ''}};
 const result = optimise(input, 'collection', 'seo', {}, '', defaults).after as Payload["seo"];
 expect(result.title).toContain(p.title);
 expect(result.description).toBe(p.seo.description);
});
it('extracts missing summaries from page content without generic filler', () => {
 const input = {...p, seo: {title: '', description: ''}};
 const result = optimise(input, 'collection', 'seo', {}, '', defaults).after as Payload["seo"];
 expect(result.description).toContain('food flasks');
 expect(result.description).not.toContain('Explore the collection');
});
it('protects existing descriptions from template replacement', () => {
 const result = optimise(p, 'collection', 'description', {}, '', defaults);
 expect(result.after).toBe(p.descriptionHtml);
 expect(result.blockers.join(' ')).toContain('paused');
});
