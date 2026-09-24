import { it, expect, vi, beforeEach } from 'vitest';
const mocks = vi.hoisted(() => ({ rows: vi.fn(), propose: vi.fn(), enqueue: vi.fn(), generation: vi.fn(), keys: vi.fn() }));
vi.mock('../app/db.server', () => ({default: {session: {}, resource: {findMany: mocks.rows}}}));
vi.mock('../app/core/context.server', () => ({context: async () => ({store:{id:'store'},actor:'owner'})}));
vi.mock('../app/core/service.server', () => ({propose:mocks.propose,enqueue:mocks.enqueue,enqueueGeneration:mocks.generation,refreshCatalogueAudit:vi.fn(),approve:vi.fn(),log:vi.fn(),proposeRedirect:vi.fn(),audit:vi.fn()}));
vi.mock('../app/core/security.server',()=>({credentials:mocks.keys,requireSameOrigin:vi.fn(),encrypt:vi.fn()}));
import {actionUI} from '../app/core/ui.server';
beforeEach(() => {
 vi.clearAllMocks();
 mocks.keys.mockResolvedValue({openaiKey:"test"});
 mocks.enqueue.mockResolvedValue({id:"generation-1"});
 mocks.generation.mockResolvedValue({id:"generation-1",status:"queued"});
 process.env.SHOPIFY_APP_URL='https://app.example';
 mocks.rows.mockResolvedValue([{id:'resource',kind:'product'}]);
});
function request(feature='seo') { return new Request('https://app.example/app/audit', {method:'POST',headers:{Origin:'https://app.example'},body:new URLSearchParams({intent:'optimise',ids:'["resource"]',feature})}); }
it('queues deterministic fixes through the same review lifecycle', async () => {
 const result:any = await actionUI(request("title"));
 expect(result.data.jobId).toBe('generation-1');
 expect(mocks.propose).not.toHaveBeenCalled();
 expect(mocks.generation).toHaveBeenCalledWith('store',['resource'],'title',false);
});
it('retrieves a completed generation rather than charging again implicitly', async () => {
 mocks.generation.mockResolvedValue({id:'existing',status:'completed'});
 const result:any = await actionUI(request("title"));
 expect(result.data.message).toContain('Existing generation result');
});
it('queues article image generation for background processing', async () => {
 mocks.rows.mockResolvedValue([{id:'resource',kind:'article'}]);
 const result:any = await actionUI(request('alt'));
 expect(result.data.ok).toBe(true);
 expect(result.data.jobId).toBe('generation-1');
 expect(mocks.propose).not.toHaveBeenCalled();
 expect(mocks.generation).toHaveBeenCalledWith('store',['resource'],'alt',false);
});

it('returns an audit job identifier instead of an ambiguous recorded message', async () => {
 mocks.enqueue.mockResolvedValue({id:'audit-1'});
 const req = new Request('https://app.example/app/audit',{method:'POST',headers:{Origin:'https://app.example'},body:new URLSearchParams({intent:'audit'})});
 const result:any = await actionUI(req);
 expect(result.data.jobId).toBe('audit-1');
 expect(result.data.message).toContain('Audit queued');
 expect(mocks.enqueue).toHaveBeenCalledWith('store','audit');
});

it('fails clearly when generation credentials are absent',async()=>{
 mocks.keys.mockResolvedValue({});
 const result:any=await actionUI(request('description'));
 expect(result.data.ok).toBe(false);expect(result.data.message).toContain('API key');
 expect(mocks.enqueue).not.toHaveBeenCalled();
});
