import 'dotenv/config';
import {writeFile} from 'node:fs/promises';
import {tick,schedule} from '../app/core/service.server';
import prisma from '../app/db.server';
let stop=false;
process.on('SIGTERM',()=>{stop=true;});process.on('SIGINT',()=>{stop=true;});
const heartbeat=()=>writeFile('/tmp/rankpilot-worker-heartbeat',String(Date.now())).catch(()=>{});
await heartbeat();const timer=setInterval(()=>void heartbeat(),2000);
async function lane(kind:'apply'|'background') {
 while(!stop){try{
  if(kind==='background')await schedule();
  if(!(await tick({lane:kind})))await new Promise(r=>setTimeout(r,kind==='apply'?150:1000));
 }catch(e){console.error('Worker:',e instanceof Error?e.message:'failed');await new Promise(r=>setTimeout(r,1000));}}
}
console.log('RankPilot worker ready: independent approval and background processing');
await Promise.all([lane('apply'),lane('background')]);clearInterval(timer);await prisma.$disconnect();
