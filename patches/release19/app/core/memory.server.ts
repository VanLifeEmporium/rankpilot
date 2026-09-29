import {readFile,writeFile} from 'node:fs/promises';
/** Release 19: per-process memory, shared through small files so /health can report web and worker. */
export type ProcessMemory={rss:number;heapUsed:number;heapLimit:number;at:number};
const MB=1024*1024;
const file=(name:string)=>`${process.env.MEMORY_STATS_DIR||'/tmp'}/rankpilot-memory-${name}.json`;
export const memoryLimitMb=()=>Number(process.env.MEMORY_LIMIT_MB)||512;
export async function heapLimitMb(){const v8=await import('node:v8');return Math.round(v8.getHeapStatistics().heap_size_limit/MB);}
export async function currentMemory():Promise<ProcessMemory>{const m=process.memoryUsage();return {rss:Math.round(m.rss/MB),heapUsed:Math.round(m.heapUsed/MB),heapLimit:await heapLimitMb(),at:Date.now()};}
export async function recordMemory(name:'web'|'worker'){const m=await currentMemory();await writeFile(file(name),JSON.stringify(m)).catch(()=>{});return m;}
export async function readMemory(name:'web'|'worker'):Promise<ProcessMemory|null>{try{const m=JSON.parse(await readFile(file(name),'utf8'));return Date.now()-m.at<120000?m:null;}catch{return null;}}
let lastWarning=0;
/** Logs a warning when the processes together use more than 80% of the container limit (at most every 5 minutes). */
export function memoryWarning(web:ProcessMemory|null,worker:ProcessMemory|null,now=Date.now()){
 const total=(web?.rss||0)+(worker?.rss||0);const limit=memoryLimitMb();
 if(total>0.8*limit&&now-lastWarning>300000){lastWarning=now;const message=`RankPilot memory warning: ${total} MB of ${limit} MB in use (web ${web?.rss??'?'} MB, worker ${worker?.rss??'?'} MB).`;console.warn(message);return message;}
 return null;
}
export function resetMemoryWarning(){lastWarning=0;}
