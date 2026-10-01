import {useFetcher} from 'react-router';
/** Release 22 (R22-103, R22-106): saved FAQs that shoppers can't see, and answers to review first. */
export type FaqStatus={products:number;live:number;notLive:number;needReview:number;block:boolean|null;checkedAt?:string};
export function FaqBanner({status,link}:{status?:FaqStatus;link:string}){
 const f=useFetcher<{ok:boolean;message:string}>();
 if(!status||!status.products||status.notLive<=0)return null;
 const n=status.notLive;
 return <section className="card banner-warning" aria-label="FAQs not on your store">
  <h2>{n} {n===1?'product has':'products have'} FAQs that aren&apos;t on your store</h2>
  <p>{status.block===false?'The RankPilot FAQ block is not on your live product template, so shoppers and search engines can’t see these answers.':'These FAQs are saved in Shopify but were not found in the live product pages.'} Add the RankPilot FAQ block to the product template (Add block › Apps › RankPilot FAQ), preview, then publish.</p>
  {status.needReview>0&&<p><strong>{status.needReview} {status.needReview===1?'product needs':'products need'} FAQ answers reviewed before you add the block.</strong> Some saved answers don&apos;t fit their question (for example a weight given as a size).</p>}
  <p>
   {status.needReview>0&&<button type="button" className="button primary" disabled={f.state!=='idle'} onClick={()=>f.submit({intent:'reviewFaqs'},{method:'post'})}>Prepare corrected FAQs for review</button>}
   <a className="button" href={link} target="_top" rel="noreferrer">Open the theme editor at the product template ↗</a>
  </p>
  {f.data&&<p role="status">{f.data.message}</p>}
  {status.checkedAt&&<p><small>Last checked on the live store {new Date(status.checkedAt).toLocaleString('en-GB')}.</small></p>}
 </section>;
}
