import {useState} from 'react';
/** Release 19: inline confirmation instead of the browser's confirm() pop-up (blocked in some embedded admins). */
export function ConfirmButton({label,question,confirmLabel='Yes',onConfirm,disabled,primary=false}:{label:string;question:string;confirmLabel?:string;onConfirm:()=>void;disabled?:boolean;primary?:boolean}){
 const [asking,setAsking]=useState(false);
 if(asking)return <span className="confirm-inline" role="group" aria-label={question}><span>{question}</span> <button type="button" className="button primary" onClick={()=>{setAsking(false);onConfirm();}}>{confirmLabel}</button> <button type="button" className="button" onClick={()=>setAsking(false)}>Cancel</button></span>;
 return <button type="button" className={primary?'button primary':'button'} disabled={disabled} onClick={()=>setAsking(true)}>{label}</button>;
}
/** Bar shown inside a dialog when closing it would lose edits. */
export function DiscardBar({onDiscard,onKeep}:{onDiscard:()=>void;onKeep:()=>void}){
 return <div className="notice warning confirm-inline" role="alertdialog" aria-label="Discard your edits?"><span>Discard your edits?</span> <button type="button" className="button primary" onClick={onDiscard}>Discard</button> <button type="button" className="button" onClick={onKeep}>Keep editing</button></div>;
}
