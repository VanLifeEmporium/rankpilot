import {describe,it,expect} from 'vitest';
import {clickRate} from '../app/core/analytics';
describe('Search Console click rate is honest about zeros and missing data',()=>{
 it('uses observed clicks and impressions rather than a default CTR',()=>{
  expect(clickRate(2,19)).toBe('10.5%');expect(clickRate(1,14)).toBe('7.1%');expect(clickRate(0,9)).toBe('0%');
 });
 it('does not round a real click down to zero',()=>expect(clickRate(1,10000)).toBe('<0.1%'));
 it('does not invent a zero for missing or invalid data',()=>{
  for(const [clicks,views] of [[null,9],[undefined,9],[0,0],[2,0],[NaN,10],[-1,4],[2,1],[1,Infinity]])expect(clickRate(clicks,views)).toBe('—');
 });
});
