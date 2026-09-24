import {readFile} from 'node:fs/promises';
export async function workerHealthy(){try{return Date.now()-Number(await readFile('/tmp/rankpilot-worker-heartbeat','utf8'))<15000;}catch{return false;}}
