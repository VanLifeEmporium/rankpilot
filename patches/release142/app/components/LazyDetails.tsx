import {useState,type ReactNode} from 'react';
// Closed on every fresh mount. Closed evidence does no DOM work, including on polls.
export function LazyDetails({summary,children}:{summary:string;children:ReactNode}) {
 const [open,setOpen]=useState(false);
 return <details onToggle={e=>setOpen(e.currentTarget.open)}><summary>{summary}</summary>{open?children:null}</details>;
}
