import {useState} from 'react';
export function Download({url,children,className,demo=false}:{url:string;children:React.ReactNode;className?:string;demo?:boolean}){
 const [busy,setBusy]=useState(false);const [error,setError]=useState('');
 async function download(){setBusy(true);setError('');try{
  const headers:Record<string,string>={};
  if(!demo){const bridge=(window as unknown as {shopify?:{idToken:()=>Promise<string>}}).shopify;if(!bridge?.idToken)throw new Error('Shopify connection is not ready. Reopen RankPilot in Shopify and try again.');headers.Authorization=`Bearer ${await bridge.idToken()}`;}
  const response=await fetch(url,{headers});if(!response.ok || response.headers.get('content-type')?.includes('text/html'))throw new Error('Download could not be authenticated. Reopen RankPilot in Shopify and try again.');
  const blob=await response.blob();const object=URL.createObjectURL(blob);const a=document.createElement('a');a.href=object;a.download=response.headers.get('content-disposition')?.match(/filename="?([^";]+)/)?.[1]||'rankpilot-export.txt';a.click();setTimeout(()=>URL.revokeObjectURL(object),1000);
 }catch(e){setError(e instanceof Error?e.message:'Download failed. Try again.');}finally{setBusy(false);}}
 return <span><button type="button" className={className} disabled={busy} onClick={()=>void download()}>{busy?'Preparing download…':children}</button>{error&&<span role="alert">{error}</span>}</span>;
}
