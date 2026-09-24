import {useEffect,useRef,useState} from 'react';
import {useFetcher} from 'react-router';
import {connectionOptions} from '../core/connections';
function ConnectionForm({option,names,demo}:{option:typeof connectionOptions[number];names:string[];demo:boolean}){
 const fetcher=useFetcher<{ok:boolean;message:string}>();const form=useRef<HTMLFormElement>(null);const [fileError,setFileError]=useState('');
 const saved=names.includes(option.key) || (option.id==='google' && names.includes('googleRefreshToken'));
 useEffect(()=>{if(fetcher.state==='idle' && fetcher.data?.ok)form.current?.reset();},[fetcher.state,fetcher.data]);
 return <details className="connection-card"><summary><strong>{option.name}</strong><span className="badge">{saved?'Saved':'Not connected'}</span></summary><p>{option.purpose}</p><p>{option.steps}</p>
 <fetcher.Form method="post" ref={form}>
 <input type="hidden" name="provider" value={option.id}/>
 {option.id==='google'?<><input type="hidden" name="key"/><label>Google account file<input type="file" accept=".json,application/json" disabled={demo} onChange={async e=>{setFileError('');const field=form.current?.elements.namedItem('key') as HTMLInputElement|null;if(field)field.value='';const file=e.target.files?.[0];if(!file)return;if(file.size>20000){setFileError('Choose a Google account JSON file smaller than 20 KB.');return;}try{if(field)field.value=await file.text();}catch{setFileError('Could not read that file. Choose it again.');}}}/></label></>:<label>{saved?'Replace API key (optional)':'API key'}<input type="password" name="key" autoComplete="new-password" spellCheck={false} disabled={demo} placeholder={saved?'Leave blank to keep the saved key':'Paste your API key'}/></label>}
 {option.model && <details><summary>Advanced: model choice</summary><p>Leave blank to keep the saved model or use the app default. Change this only if your account needs a particular supported model.</p><label>Model name<input name="model" disabled={demo} autoComplete="off"/></label></details>}
 <div className="connection-actions"><button className="button primary" name="intent" value="connectionSave" disabled={demo||fetcher.state!=='idle'||Boolean(fileError)}>{fetcher.state!=='idle'?'Working…':'Save connection'}</button>
 {saved && option.id==='openai' && <button className="button" name="intent" value="connectionTest" disabled={demo||fetcher.state!=='idle'}>Check saved key</button>}
 {saved && <button className="button" name="intent" value="connectionDisconnect" disabled={demo||fetcher.state!=='idle'}>Disconnect</button>}</div>
 <p className="muted">Saved keys stay private. Access is confirmed by a successful service request.</p>
 {(fileError||fetcher.data) && <p role={fileError||fetcher.data?.ok===false?'alert':'status'}>{fileError||fetcher.data?.message}</p>}
 </fetcher.Form></details>;
}
export function Connections({names,demo}:{names:string[];demo:boolean}){return <div className="connections-grid">{connectionOptions.map(option=><ConnectionForm key={option.id} option={option} names={names} demo={demo}/>)}</div>;}
