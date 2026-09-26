import {existsSync,readFileSync} from 'node:fs';
// Load the actual CDN SDK. Offline CI may supply these public scripts in SDK_FIXTURES_DIR.
// Missing scripts fail the test; an empty stub must never count as a Polaris test.
const cache=new Map();
export async function shopifyScript(name){
 if(cache.has(name))return cache.get(name);
 const file=(process.env.SDK_FIXTURES_DIR||'/tmp')+'/'+name+'.js';
 let body;
 if(existsSync(file))body=readFileSync(file,'utf8');
 else {const r=await fetch(`https://cdn.shopify.com/shopifycloud/${name}.js`,{signal:AbortSignal.timeout(20000)});if(!r.ok)throw new Error(`Shopify SDK download failed: ${r.status}`);body=await r.text();}
 if(body.length<10000)throw new Error('Real Shopify SDK is missing or truncated');
 cache.set(name,body);return body;
}
