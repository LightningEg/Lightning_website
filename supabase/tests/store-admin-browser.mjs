// Optional local Chromium acceptance; fake transport, no production access.
import {chromium} from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',args:['--no-sandbox'],headless:true});
const context=await browser.newContext();
await context.route('https://**',r=>r.abort());
await context.route('**/js/vendor/supabase-*.js',r=>r.fulfill({body:'',contentType:'application/javascript'}));
await context.route('**/js/forgeeks-auth.js*',r=>r.fulfill({contentType:'application/javascript',body:`
const testId='11111111-1111-4111-8111-111111111111';
const data={payment_settings:{qr_asset_id:testId,instapay_address:'test@instapay',recipient_name:'Test recipient',processing_message:'Manually reviewed. Do not pay twice.',enabled:true},coin_pricing:{coins_per_egp:5,minimum_egp:10,maximum_egp:10000,enabled:true},coin_bonus_tiers:[{minimum_egp:100,bonus_percent:5}],topup_requests:[{id:testId,user_id:testId,status:'pending',coins:525,price_piastres:10000,transfer_note_email:'member@example.test',payer_instapay_address:'sender@instapay',customer_payment_reference:'PAYMENT-123456789',receipt_object_key:testId+'/image',receipt_revision:3}],bank_transfers:[{reference:'BANK-123456789',amount_piastres:10000,received_at:'2026-10-25T09:00:00Z',request_id:testId,email_note:'member@example.test'}]};
window.FG={session:()=>({user:{id:testId}}),ready:Promise.resolve(),onAuth:()=>{},say:e=>e.message,sb:{from:table=>{const q={select(){return this},eq(){return this},is(){return this},order(){return this},range(){return this},single(){return Promise.resolve({data:data[table],error:null})},then(a,b){return Promise.resolve({data:data[table]||[],error:null}).then(a,b)}};return q},rpc:async name=>({data:name==='is_admin'?true:name==='admin_social_queue'?[]:{payments_enabled:true,pending_requests:1,unmatched_transfers:0,pending_social:0,wallet_mismatches:0},error:null})}};
` }));
const page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
for(const width of [390,1280]){await page.setViewportSize({width,height:900});await page.goto('http://127.0.0.1:8000/admin.html');await page.locator('#store-request-list article').waitFor();assert.equal(await page.locator('#store-tools').isDisabled(),false);assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'owner console has no horizontal overflow at '+width);await page.screenshot({path:'/workspace/work/owner-'+width+'.png'});await page.locator('#requests').screenshot({path:'/workspace/work/owner-requests-'+width+'.png'});}
assert.deepEqual(errors,[]);await browser.close();console.log('Owner Chromium: loaded private operator UI on phone and desktop without layout overflow or script errors');
