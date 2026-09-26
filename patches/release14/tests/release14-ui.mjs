import {shopifyScript} from './shopify-sdk.mjs';
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
const migration=spawnSync('node',['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8'});
if(migration.status!==0)throw new Error(migration.stderr||migration.stdout);
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
 const context=await browser.newContext();const page=await context.newPage();page.setDefaultTimeout(10000);const errors=[];page.on('pageerror',e=>errors.push(e.message));


 await context.route('https://cdn.shopify.com/shopifycloud/polaris.js',async r=>r.fulfill({contentType:'text/javascript',body:await shopifyScript('polaris')}));
 await context.route('https://cdn.shopify.com/shopifycloud/app-bridge.js',async r=>r.fulfill({contentType:'text/javascript',body:await shopifyScript('app-bridge')}));
 await context.route('https://cdn.shopify.com/static/fonts/**',r=>r.fulfill({contentType:'text/css',body:''}));
 await page.goto('http://localhost:3016/app');
 const cookie=(await context.cookies()).find(c=>c.name==='rankpilot_demo');
 const storeId=await createCookie('rankpilot_demo',{secrets:[env.SESSION_SECRET || 'local-demo-only']}).parse('rankpilot_demo='+cookie.value);
 const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',Buffer.from(env.ENCRYPTION_KEY,'hex'),iv);
 const encrypted=Buffer.concat([cipher.update(JSON.stringify({openaiKey:'local-unused-fixture'}),'utf8'),cipher.final()]);
 const fixtureCredential=['v1',iv.toString('base64'),cipher.getAuthTag().toString('base64'),encrypted.toString('base64')].join('.');
 await db.store.update({where:{id:storeId},data:{credentials:fixtureCredential}});
 // Main action fetcher: a finished background draft opens its review without refresh.
 await page.goto('http://localhost:3016/app/content');
 await page.getByRole('button',{name:'Create draft',exact:true}).first().click();
 await expect.poll(()=>db.job.count({where:{storeId,kind:'draft',status:'queued'}})).toBeGreaterThan(0);
 const draftJob=await db.job.findFirstOrThrow({where:{storeId,kind:'draft',status:'queued'},orderBy:{createdAt:'desc'}});
 const source=await db.resource.findFirstOrThrow({where:{storeId,kind:'product'}});
 const resource=await db.resource.create({data:{storeId,remoteId:'draft-'+draftJob.id,kind:'article',title:'Fixture draft review',handle:'fixture-draft-review',payload:JSON.stringify({...JSON.parse(source.payload),title:'Fixture draft review',published:false,descriptionHtml:'<p>A locally generated test draft.</p>'})}});
 const preview=await db.change.create({data:{storeId,resourceId:resource.id,feature:'draft',before:'null',after:resource.payload,reasons:JSON.stringify(['Reviewed against catalogue sources. Accept to create an unpublished Shopify article.']),blockers:'[]'}});
 await db.job.update({where:{id:draftJob.id},data:{status:'completed',payload:JSON.stringify({...JSON.parse(draftJob.payload),result:[{changeId:preview.id,message:'Article preview ready.'}]})}});
 await expect(page.locator('dialog[open]').filter({has:page.getByRole('button',{name:'Approve demo change',exact:true})})).toBeVisible({timeout:15000});
 expect((await db.change.findUniqueOrThrow({where:{id:preview.id}})).status).toBe('pending');
 console.log('PASS background draft completion automatically opens approval review without publishing');
 // Exercise real external SDK code in a constrained iframe. Store remains demo:
 // no Shopify, Google or AI account is contacted or impersonated.
 await context.route('http://localhost:3016/app**',async r=>{const response=await r.fetch();const headers={...response.headers()};delete headers['content-security-policy'];delete headers['x-frame-options'];await r.fulfill({response,headers});});
 await context.route('http://localhost:3016/release14-frame',r=>r.fulfill({contentType:'text/html',body:'<html><body style="margin:0"><iframe title="Embedded app" src="/app/products" style="border:0;width:910px;max-width:100vw;height:713px"></iframe></body></html>'}));
 for(const [width,height] of [[1024,768],[1280,800],[1440,900]]){
  await page.setViewportSize({width,height});await page.goto('http://localhost:3016/release14-frame');
  const app=page.frameLocator('iframe'),frame=page.frames().find(f=>f.url().includes('/app/products'));
  await expect.poll(()=>frame.evaluate(()=>!!customElements.get('s-section'))).toBe(true);
  await expect.poll(()=>frame.evaluate(()=>document.documentElement.dataset.rankpilotReady)).toBe('true');
  for(const [section,button] of [['products','Product details'],['collections','Collection plan']]){
   await frame.goto('http://localhost:3016/app/'+section);
   const search=app.getByRole('textbox',{name:'Search pages'});await search.fill(section==='products'?'power':'off');await expect(search).toHaveValue(section==='products'?'power':'off');await search.fill('');
   const checkbox=app.locator('tbody input[type=checkbox]').first();await checkbox.check();await expect(checkbox).toBeChecked();await expect(app.getByText('1 selected',{exact:true})).toBeVisible();await expect(app.getByRole('button',{name:'Generate previews',exact:true})).toBeEnabled();
   const details=app.getByRole('button',{name:button,exact:true}).first();await details.click();const modal=app.locator('dialog.facts-dialog');await expect(modal).toBeVisible();
   await expect(modal.getByRole('button',{name:/Save (product details|collection plan|blog plan)/})).toBeInViewport();
   const input=modal.getByLabel('Main phrase shoppers search for',{exact:true});await input.fill('edited test phrase');
   page.once('dialog',d=>d.dismiss());await page.keyboard.press('Escape');await expect(modal).toBeVisible();
   page.once('dialog',d=>d.accept());await modal.getByRole('button',{name:'Close facts',exact:true}).click();await expect(modal).not.toBeVisible();await search.fill('power');await expect(search).toHaveValue('power');await search.fill('');
  }
  await frame.goto('http://localhost:3016/app');await app.getByRole('heading',{name:'Store Score',exact:true}).click();await page.mouse.move(800,500);await page.mouse.wheel(0,900);await expect.poll(()=>frame.evaluate(()=>document.scrollingElement.scrollTop)).toBeGreaterThan(100);
  await page.keyboard.press('Control+End');await expect.poll(()=>frame.evaluate(()=>{const e=document.scrollingElement;return e.scrollTop+e.clientHeight>=e.scrollHeight-4;})).toBe(true);
  const index=app.getByRole('button',{name:'Check next 20 URLs',exact:true});await index.click();await expect(app.getByText('Checking the next 20 sitemap URLs against Google’s index. Progress is saved between runs.',{exact:true})).toBeVisible();
  expect(await db.job.count({where:{storeId,kind:'indexation',status:'queued'}})).toBe(1);
  await db.job.updateMany({where:{storeId,kind:'indexation'},data:{status:'completed',payload:JSON.stringify({result:[{message:'Fixture inspection completed'}]})}});
  await expect(app.getByRole('heading',{name:'Store Score',exact:true})).toBeVisible();expect((await frame.locator('body').innerText()).includes('405 Method Not Allowed')).toBe(false);
  console.log('PASS 910×713 iframe at',width,height,'products, collections, dirty-modal close, selection, document scroll, first-click indexation');
 }
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS real Polaris components loaded; no browser exceptions');
} finally {await browser?.close();server.kill('SIGTERM');await db.$disconnect();}
