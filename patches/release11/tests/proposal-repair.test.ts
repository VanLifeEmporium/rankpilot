import {it,expect,vi} from 'vitest';
const mocks=vi.hoisted(()=>({rows:vi.fn(),resources:vi.fn(),update:vi.fn().mockResolvedValue({count:1}),event:vi.fn()}));
vi.mock('../app/db.server',()=>({default:{change:{findMany:mocks.rows,updateMany:mocks.update},resource:{findMany:mocks.resources},event:{create:mocks.event}}}));
import {repairedTitle,repairPendingTitles} from '../app/core/proposal-repair.server';
it('preserves the reported tent title now that the word cap is removed',()=>{
 expect(repairedTitle({title:'Wolfwise Pop-up Privacy Tent – Changing or Washing Shelter',description:'Existing reviewed summary'},'Wolfwise Pop-Up Privacy Tent')).toBeNull();
});
it('does not truncate a source title or change an already valid proposal',()=>{
 expect(repairedTitle({title:'Too many words in this proposed title'},'Too many words in this source title')).toBeNull();
 expect(repairedTitle({title:'Camping Mug'},'Another Mug')).toBeNull();
});
it('repairs only still-pending drafts and preserves the description',async()=>{
 const after=JSON.stringify({title:'x'.repeat(256),description:'Summary'});
 mocks.rows.mockResolvedValue([{id:'c',resourceId:'r',after}]);mocks.resources.mockResolvedValue([{id:'r',payload:JSON.stringify({title:'Wolfwise Pop-Up Privacy Tent'})}]);
 await repairPendingTitles('store');
 expect(mocks.rows).toHaveBeenCalledWith({where:{storeId:'store',feature:'seo',status:'pending'}});
 expect(mocks.update.mock.calls[0][0].where).toEqual({id:'c',storeId:'store',status:'pending',after});
 expect(JSON.parse(mocks.update.mock.calls[0][0].data.after).description).toBe('Summary');
});
