import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {load} from 'cheerio';
import {it,expect,vi} from 'vitest';
import type {Change} from '@prisma/client';
import {displayChange} from '../app/core/ui-data.server';
import {ReviewActions} from '../app/components/ReviewActions';

const legacy='source-reviewed-v1: The existing Shopify page title is reused verbatim. The proposed meta description is unchanged.';
function change(reasons=[legacy],title='Wild & Free Wood Print') {
  return displayChange({status:'pending',feature:'seo',before:JSON.stringify({title:'Old title',description:'Old summary'}),after:JSON.stringify({title,description:'Birch wood print with natural grain.'}),reasons:JSON.stringify(reasons),blockers:'[]'} as Change);
}
function render(c:Change,busy=false,accepting=false) {
  return load(renderToStaticMarkup(createElement(ReviewActions,{blockers:JSON.parse(c.blockers),busy,accepting,demo:false,onAccept:vi.fn(),onReject:vi.fn(),onReplace:vi.fn()})));
}
it('puts the legacy repair blocker and enabled replacement action beside acceptance',()=>{
  const $=render(change());
  const accept=$('button').filter((_,e)=>$(e).text()==='Accept and apply');
  expect(accept.is('[disabled]')).toBe(true);
  const description=$('[id]').filter((_,e)=>$(e).attr('id')===accept.attr('aria-describedby'));
  expect(description.text()).toContain('older preview needs a new content review');
  expect(description.text()).toContain('has not been published');
  expect($('button').filter((_,e)=>$(e).text()==='Generate reviewed replacement').is('[disabled]')).toBe(false);
  expect($('button').filter((_,e)=>$(e).text()==='Reject').is('[disabled]')).toBe(false);
});
it('enables acceptance for a valid source-reviewed replacement',()=>{
  const $=render(change(['source-reviewed-v1: Checked against the product source.']));
  expect($('button').filter((_,e)=>$(e).text()==='Accept and apply').is('[disabled]')).toBe(false);
  expect($.text()).not.toContain('Generate reviewed replacement');
});
it('allows a reviewed title with more than five words',()=>{
  const $=render(change(['source-reviewed-v1: Checked against the source.'],'Wild and Free Wood Print for Your Home'));
  expect($('button').filter((_,e)=>$(e).text()==='Accept and apply').is('[disabled]')).toBe(false);
  expect($.text()).not.toContain('five words');
});
it('explains a pending request and prevents conflicting decisions',()=>{
  const $=render(change(['source-reviewed-v1: Checked.']),true,true);
  expect($('[role="status"]').text()).toContain('checking the saved change in Shopify');
  expect($('button:not([disabled])')).toHaveLength(0);
  expect($.text()).toContain('Applying…');
});
