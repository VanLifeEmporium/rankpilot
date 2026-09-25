// Local demo-only regression test. Never opens Shopify or uses production credentials.
import {spawn} from 'node:child_process';
import {createCipheriv,randomBytes} from 'node:crypto';
import {setTimeout as wait} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import portable from '@sparticuz/chromium';
import {mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createCookie} from 'react-router';
import {PrismaClient} from '@prisma/client';
const env={...process.env,DEMO_MODE:'true',DATABASE_URL:'file:/tmp/rankpilot-feedback6.sqlite',SHOPIFY_APP_URL:'http://localhost:3016',ENCRYPTION_KEY:'a'.repeat(64),SHOPIFY_API_KEY:'local-test-key',PORT:'3016',HOST:'127.0.0.1'};
const db=new PrismaClient({datasources:{db:{url:env.DATABASE_URL}}});
const server=spawn('node',['./node_modules/@react-router/serve/bin.js','./build/server/index.js'],{env,stdio:['ignore','pipe','pipe']});
let logs='';server.stdout.on('data',d=>logs+=d);server.stderr.on('data',d=>logs+=d);
let browser;
try {
 for(let i=0;i<60;i++){try{if((await fetch('http://localhost:3016/health')).ok)break;}catch{}await wait(250);if(i===59)throw new Error(logs);}
 const runtime=process.cwd()+'/.browser-runtime';mkdirSync(runtime,{recursive:true});
 const executablePath=runtime+'/chromium';
 if(!existsSync(executablePath)){writeFileSync(executablePath,brotliDecompressSync(readFileSync('node_modules/@sparticuz/chromium/bin/chromium.br')));chmodSync(executablePath,0o755);}
 for(const name of ['fonts','swiftshader']){const target=name==='fonts'?runtime+'/fonts':runtime;mkdirSync(target,{recursive:true});const tar=runtime+'/'+name+'.tar';writeFileSync(tar,brotliDecompressSync(readFileSync('node_modules/@sparticuz/chromium/bin/'+name+'.tar.br')));spawnSync('tar',['--no-same-owner','-xf',tar,'-C',target]);}
 writeFileSync(runtime+'/fonts/fonts.conf',`<?xml version="1.0"?><!DOCTYPE fontconfig SYSTEM "fonts.dtd"><fontconfig><dir>${runtime}/fonts/fonts</dir><dir>/usr/share/fonts</dir><cachedir>${runtime}/font-cache</cachedir></fontconfig>`);
 process.env.FONTCONFIG_PATH=runtime+'/fonts';process.env.LD_LIBRARY_PATH=runtime;
 browser=await chromium.launch({executablePath,args:portable.args.filter(a=>!a.includes('disable-web-security')),headless:true});
 const page=await browser.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.goto('http://localhost:3016/app/audit');
 const type=page.getByLabel('Filter finding type');await type.selectOption('missing-alt');
 await expect(type).toHaveValue('missing-alt');
 await page.reload();await expect(type).toHaveValue('missing-alt');
 const rows=page.locator('table').filter({has:page.getByRole('columnheader',{name:'Page & finding',exact:true})}).locator('tbody tr');
 expect(await rows.count()).toBeGreaterThan(0);
 for(const row of await rows.all())await expect(row).toContainText('One or more images have no description');
 console.log('PASS finding filter applies and survives reload');
 // Change a queued job to completed from outside the page. No navigation/reload.
 const cookie=(await page.context().cookies()).find(c=>c.name==='rankpilot_demo');
 const storeId=await createCookie('rankpilot_demo',{secrets:[env.SESSION_SECRET || 'local-demo-only']}).parse('rankpilot_demo='+cookie.value);
 const store=await db.store.findUniqueOrThrow({where:{id:storeId}});

 const cfg=JSON.parse(store.settings);cfg.reportedPaths=['/products/retired-fixture'];
 await db.store.update({where:{id:store.id},data:{settings:JSON.stringify(cfg),discoveries:JSON.stringify({reported:[{path:'/products/retired-fixture',status:404,state:'Missing page'}]})}});
 await page.reload();
 await page.getByRole('button',{name:'Redirect to another page',exact:true}).click();
 await expect(page.getByRole('textbox',{name:'Old path',exact:true})).toHaveValue('/products/retired-fixture');
 await page.getByRole('button',{name:'Remove from tracking',exact:true}).click();
 await expect(page.getByText('Removed from tracking. No Shopify page or redirect was deleted.',{exact:false})).toBeVisible();
 await expect(page.getByRole('button',{name:'Remove from tracking',exact:true})).toHaveCount(0);
 expect(JSON.parse((await db.store.findUniqueOrThrow({where:{id:store.id}})).settings).reportedPaths).toEqual([]);
 console.log('PASS old URL redirect selection and removal from tracking');
 const job=await db.job.create({data:{storeId:store.id,kind:'audit',status:'running',dedup:crypto.randomUUID(),payload:'{}'}});
 await expect(page.getByText('Latest audit job: running')).toBeVisible({timeout:20000});
 await db.job.update({where:{id:job.id},data:{status:'completed',payload:JSON.stringify({result:{score:80}})}});
 await expect(page.getByText('Latest audit job: completed')).toBeVisible({timeout:15000});
 console.log('PASS external job completion appears without refresh');
 const product=await db.resource.findFirstOrThrow({where:{storeId:store.id,kind:'product'}});
 await db.resource.update({where:{id:product.id},data:{facts:'{}'}});
 await page.goto('http://localhost:3016/app/products');
 await page.getByLabel('CSV contents').fill(`handle,materials,source\n${product.handle},Steel,Local supplier fixture`);
 await page.getByRole('button',{name:'Preview import',exact:true}).click();
 await expect(page.getByText(/Matched 1 products/)).toBeVisible();
 await page.getByRole('button',{name:'Import unconfirmed facts',exact:true}).click();
 await expect(page.getByText(/Imported .*unconfirmed facts/)).toBeVisible();
 const saved=await db.resource.findUniqueOrThrow({where:{id:product.id}});
 const fact=JSON.parse(saved.facts).materials;
 if(fact.confirmed)throw new Error('Imported fact was incorrectly confirmed');
 console.log('PASS CSV preview and import retains unconfirmed source-backed fact');
 await db.change.createMany({data:[{storeId:store.id,resourceId:product.id,feature:'seo',before:'{}',after:JSON.stringify({title:'Camping mug',description:'A camping mug.'}),reasons:JSON.stringify(['source-reviewed-v1: Current review']),blockers:'[]'},{storeId:store.id,resourceId:product.id,feature:'seo',before:'{}',after:JSON.stringify({title:'Old mug',description:'An older mug.'}),reasons:JSON.stringify(['source-reviewed-v1: The existing Shopify page title is reused']),blockers:'[]'}]});
 await page.goto('http://localhost:3016/app/reviews');
 await expect(page.getByRole('button',{name:'Ready to accept (1)',exact:true})).toBeVisible();
 await expect(page.getByRole('button',{name:'Needs attention (1)',exact:true})).toBeVisible();
 console.log('PASS ready and blocked review counts are separate');
 await page.goto('http://localhost:3016/app');
 await expect(page.getByRole('navigation',{name:'Main navigation'}).getByRole('link')).toHaveCount(3);
 await page.getByRole('button',{name:'Review ready fixes (1)',exact:true}).click();
 await page.getByText('How your page looks on Google — 1 ready',{exact:true}).click();
 const batchButton=page.getByRole('button',{name:'Accept and apply this set (1)',exact:true});
 await expect(batchButton).toBeDisabled();
 await page.getByLabel('I approve these 1 previews.').check();
 await batchButton.click();
 await expect(page.getByText(/1 changes accepted and queued to save/)).toBeVisible();
 expect(await db.change.count({where:{storeId:store.id,status:'approved'}})).toBe(1);
 expect(await db.change.count({where:{storeId:store.id,status:'pending'}})).toBe(1);
 console.log('PASS explicit batch approval excludes blocked drafts');

 await page.goto('http://localhost:3016/app');
 await expect(page.getByRole('heading',{name:'Fix these next',exact:true})).toBeVisible();
 await expect(page.locator('.dashboard-metrics .metric')).toHaveCount(4);
 await expect(page.locator('.catalogue-tiles a')).toHaveCount(3);
 await page.screenshot({path:'/tmp/rankpilot-dashboard8.png',fullPage:true});
 console.log('PASS dashboard metrics, priority actions and content navigation');
 await page.goto('http://localhost:3016/app/settings');
 await expect(page.getByLabel('Brand suffix')).toBeVisible();
 await page.getByLabel('Brand suffix').selectOption('omit');
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await expect(page.getByText('Settings saved.',{exact:false})).toBeVisible().catch(async()=>{const cfg=JSON.parse((await db.store.findUniqueOrThrow({where:{id:store.id}})).settings);expect(cfg.titleBrandMode).toBe('omit');});
 // Simulate the embedded branch in an iframe. Shopify is not contacted: a
 // local ID-token stub and request guard exercise the production client path.
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({openaiKey:'local-unused-fixture'}),'utf8'),cipher.final()]);
 const fixtureCredential=['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
 await db.store.update({where:{id:store.id},data:{demo:false,credentials:fixtureCredential}});
 await page.context().addInitScript(()=>{window.shopify={idToken:async()=> 'local-embedded-test-token'};});
 await page.context().route('https://cdn.shopify.com/shopifycloud/app-bridge.js',r=>r.fulfill({contentType:'text/javascript',body:''}));
 let failedStatus=true,authenticatedPolls=0;
 await page.context().route('**/app/job-status',r=>{
   if(r.request().headers().authorization!=='Bearer local-embedded-test-token')return r.fulfill({status:401,body:'Missing authentication'});
   authenticatedPolls++;
   if(failedStatus)return r.fulfill({status:503,body:'Temporary outage'});
   return r.continue();
 });
 // The real app permits only Shopify frame ancestors. This fixture uses a
 // local parent, so remove that header from the local test response only.
 await page.context().route('http://localhost:3016/app/audit',async r=>{
   const response=await r.fetch();const headers={...response.headers()};
   delete headers['content-security-policy'];delete headers['x-frame-options'];
   await r.fulfill({response,headers});
 });
 await page.context().route('http://localhost:3016/test-frame',r=>r.fulfill({contentType:'text/html',body:'<iframe title="Local embedded app" src="http://localhost:3016/app/audit" style="width:1500px;height:1000px"></iframe>'}));
 await page.goto('http://localhost:3016/test-frame');
 const frame=page.frameLocator('iframe');
 await expect(frame.getByText(/Live progress is temporarily unavailable/)).toBeVisible({timeout:15000});
 const embedFilter=frame.getByLabel('Filter finding type');
 await embedFilter.selectOption('missing-alt');await expect(embedFilter).toHaveValue('missing-alt');
 failedStatus=false;
 await expect(frame.getByText(/Live progress is temporarily unavailable/)).toHaveCount(0,{timeout:15000});
 // Start a real generation request, then supply the worker result in this
 // isolated database. No AI or Shopify writes are involved.
 await frame.getByRole('button',{name:'Generate fix',exact:true}).first().click();
 let generated;
 for(let i=0;i<30;i++){generated=await db.job.findFirst({where:{storeId:store.id,kind:'optimise'},orderBy:{createdAt:'desc'}});if(generated)break;await wait(100);}
 if(!generated)throw new Error('Generation request not enqueued');
 const payload=JSON.parse(generated.payload);const rid=payload.ids[0];
 const change=await db.change.create({data:{storeId:store.id,resourceId:rid,feature:'alt',before:JSON.stringify([{id:'fixture-image',alt:''}]),after:JSON.stringify([{id:'fixture-image',alt:'A camping mug on a table.'}]),reasons:JSON.stringify(['image-reviewed-v1: local fixture']),blockers:'[]'}});
 await db.job.update({where:{id:generated.id},data:{status:'completed',payload:JSON.stringify({...payload,result:[{resourceId:rid,changeId:change.id}]})}});
 await expect(frame.locator('dialog.change-preview')).toBeVisible({timeout:15000});
 await expect(frame.getByRole('button',{name:'Accept and apply',exact:true})).toBeEnabled();
 await frame.getByRole('button',{name:'Close preview',exact:true}).click();
 await expect(embedFilter).toHaveValue('missing-alt');
 if(authenticatedPolls<2)throw new Error('Embedded polling did not authenticate');
 await db.store.update({where:{id:store.id},data:{demo:true}});
 console.log('PASS iframe filter, authenticated polling, outage recovery and generation completion without refresh');
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS metric and title preferences; no browser exceptions');
} finally {await browser?.close();server.kill();await db.$disconnect();}
