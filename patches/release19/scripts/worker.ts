// Release 19: Node's own .env loader (local development only; Render supplies the environment).
import {existsSync} from 'node:fs';
if(existsSync('.env'))process.loadEnvFile('.env');
import {writeFile} from 'node:fs/promises';
import {tick,schedule} from '../app/core/service.server';
import {recordMemory,readMemory,memoryWarning} from '../app/core/memory.server';
import prisma from '../app/db.server';
let stop=false;
process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
const heartbeat=()=>writeFile('/tmp/rankpilot-worker-heartbeat',String(Date.now())).catch(()=>{});
await heartbeat();const timer=setInterval(()=>void heartbeat(),2000);
// Release 19: report memory for /health and warn above 80% of the container limit.
const memory=setInterval(()=>void (async()=>{const worker=await recordMemory('worker');memoryWarning(await readMemory('web'),worker);})().catch(()=>{}),10000);
async function lane(kind:'apply'|'background'|'generation') {
 while(!stop){try{
  if(kind==='background')await schedule();
  if(!(await tick({lane:kind})))await new Promise(r=>setTimeout(r,kind==='apply'?150:1000));
 }catch(e){console.error('Worker:',e instanceof Error?e.message:'failed');await new Promise(r=>setTimeout(r,1000));}}
}
console.log('RankPilot worker ready: independent approval, preview generation and audit processing');
await Promise.all([lane('apply'),lane('generation'),lane('background')]);clearInterval(timer);clearInterval(memory);await prisma.$disconnect();
