// Local demo-only regression test. Never opens Shopify or uses production credentials.
import {spawn} from 'node:child_process';
import {setTimeout as wait} from 'node:timers/promises';
import {chromium,expect} from '@playwright/test';
import portable from '@sparticuz/chromium';
import {mkdirSync,writeFileSync,readFileSync,chmodSync,existsSync} from 'node:fs';
import {brotliDecompressSync} from 'node:zlib';
import {spawnSync} from 'node:child_process';
import {createCookie} from 'react-router';
import {PrismaClient} from '@prisma/client';
const env={...process.env,DEMO_MODE:'true',DATABASE_URL:'file:/tmp/rankpilot-feedback6.sqlite',SHOPIFY_APP_URL:'http://localhost:3016',ENCRYPTION_KEY:'a'.repeat(64),PORT:'3016',HOST:'127.0.0.1'};
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
 const rows=page.locator('table').first().locator('tbody tr');
 for(const row of await rows.all())await expect(row).toContainText('One or more images have no description');
 console.log('PASS finding filter applies and survives reload');
 // Change a queued job to completed from outside the page. No navigation/reload.
 const cookie=(await page.context().cookies()).find(c=>c.name==='rankpilot_demo');
 const storeId=await createCookie('rankpilot_demo',{secrets:[env.SESSION_SECRET || 'local-demo-only']}).parse('rankpilot_demo='+cookie.value);
 const store=await db.store.findUniqueOrThrow({where:{id:storeId}});

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
 await expect(page.locator('.metric').filter({hasText:'Answer-ready facts'}).locator('strong')).toHaveText(/^\d+%$/);
 await page.goto('http://localhost:3016/app/settings');
 await expect(page.getByLabel('Brand suffix')).toBeVisible();
 await page.getByLabel('Brand suffix').selectOption('omit');
 await page.getByRole('button',{name:'Save settings',exact:true}).click();
 await expect(page.getByText('Settings saved.',{exact:false})).toBeVisible().catch(async()=>{const cfg=JSON.parse((await db.store.findUniqueOrThrow({where:{id:store.id}})).settings);expect(cfg.titleBrandMode).toBe('omit');});
 if(errors.length)throw new Error(errors.join('\n'));
 console.log('PASS metric and title preferences; no browser exceptions');
} finally {await browser?.close();server.kill();await db.$disconnect();}
