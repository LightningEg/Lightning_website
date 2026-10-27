// Exercises the actual checkout and owner scripts; no external services or transfers.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
const uid='11111111-1111-4111-8111-111111111111';
const packageId='22222222-2222-4222-8222-222222222222';
const proof={id:'33333333-3333-4333-8333-333333333333',user_id:uid,status:'pending',price_piastres:10000,coins:500,destination_address:'project@instapay',destination_name:'Recipient',destination_qr_asset_id:'44444444-4444-4444-8444-444444444444',transfer_note_email:'member@example.test',receipt_object_key:null,receipt_revision:0};
async function boot({admin=false,closed=false,rpc:override=null,uploadError=false,uploadOverride=null}={}){
 const dom=new JSDOM(read(admin?'forgeeks-admin.html':'topup.html'),{url:'https://lightningeg.com/'+(admin?'forgeeks-admin.html':'topup.html'),runScripts:'outside-only'}),w=dom.window;
 let session={user:{id:uid}},uploads=0;const listeners=[],calls=[],state={rows:[{...proof}],packages:[{id:packageId,name:'Test',coins:500,price_piastres:10000,active:true}]};
 const config={enabled:!closed,instapay_address:'project@instapay',recipient_name:'Recipient',qr_url:'https://example.test/qr.png'};
 const from=table=>{const filters={};let max=Infinity;const builder={select(){return this;},in(){return this;},eq(k,v){filters[k]=v;return this;},order(){return this;},limit(n){max=n;return this;},maybeSingle(){return Promise.resolve({data:table==='wallets'?{balance:0}:config,error:null});},then(a,b){let data=table==='coin_packages'?state.packages:table==='topup_requests'?state.rows:table==='wallets'?{balance:0}:[];if(table==='topup_requests')data=data.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)).slice(0,max);return Promise.resolve({data,error:null}).then(a,b);}};return builder;};
 w.confirm=()=>true;
 w.FG={session:()=>session,ready:Promise.resolve(),onAuth:fn=>listeners.push(fn),say:e=>e.message||String(e),sb:{from,rpc:async(name,args)=>{
  calls.push({name,args});if(override){const r=override(name,args);if(r)return await r;}
  if(name==='is_admin')return {data:admin,error:null};
  if(name==='checkout_availability')return {data:{enabled:!closed},error:null};
  if(name==='topup_payment_details')return {data:closed?{enabled:false}:{enabled:true,instapay_address:'project@instapay',recipient_name:'Lightning Recipient',note_email:'member@example.test',coins_per_egp:5,minimum_egp:10,maximum_egp:10000,pricing_version:1,tiers:[{minimum_egp:100,bonus_percent:5}]},error:null};
  if(name==='submit_instapay_topup')return {data:{...proof,request_key:args.p_request_key,coins:525,details_submitted_at:'2026-10-26T10:00:00Z'},error:null};
  if(name==='quote_topup_amount')return {data:{amount_piastres:10000,coins:525,base_coins:500,bonus_coins:25,bonus_percent:5,coins_per_egp:5,minimum_egp:10,maximum_egp:10000,pricing_version:1,enabled:true},error:null};
  if(name==='topup_funding_status')return {data:{received_piastres:0,remaining_piastres:10000},error:null};
  if(name==='checkout_qr')return {data:{data_url:'data:image/png;base64,aGVsbG8='},error:null};
  if(name==='create_amount_checkout')return {data:{...proof,request_key:args.p_request_key},error:null};
  if(name==='reserve_topup_receipt')return {data:uid+'/'+proof.id+'/reserved',error:null};
  if(name==='attach_topup_receipt')return {data:{...proof,receipt_object_key:args.p_object_key},error:null};
  return {data:{},error:null};
 },storage:{from:()=>({upload:async(path)=>{calls.push({name:'upload',path});uploads++;if(uploadOverride)return await uploadOverride(path);return {error:uploadError?(uploads===1?{message:'Failed to fetch'}:{statusCode:'409'}):null};},createSignedUrl:async path=>{calls.push({name:'signed',path});return {data:{signedUrl:'https://example.test/private-receipt'},error:null};},remove:async paths=>{calls.push({name:'remove',paths});return {error:null};}})}}};
 w.eval(read(admin?'js/admin-operations.js':'js/topup.js'));await tick();
 const $=id=>w.document.getElementById(id),price=async()=>{$('topup-amount').value='100';$('topup-amount').dispatchEvent(new w.Event('input'));await new Promise(r=>setTimeout(r,300));},submit=async id=>{$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();},click=async e=>{e.click();await tick();};
 return {w,$,price,submit,click,calls,state,async signOut(){session=null;listeners.forEach(fn=>fn(null));await tick();},close(){w.close();}};
}
const today=(()=>{const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());})();
// step 1: what to copy, nothing to upload
let p=await boot();assert.equal(p.$('topup-pay').hidden,false);assert.equal(p.$('topup-confirm').hidden,true);
assert.deepEqual([...p.$('topup-details').querySelectorAll('dt')].map(x=>x.textContent),['InstaPay address','Receiver name','Transfer note: your email']);
assert.match(p.$('topup-details').textContent,/project@instapay.*Lightning Recipient.*member@example.test/);assert.equal(p.$('topup-details').querySelectorAll('button').length,3);
assert.equal(p.w.document.querySelector('input[type=file]'),null,'no receipt upload');assert.match(p.$('topup-rate').textContent,/1 EGP = 5 coins.*5% bonus from 100 EGP/);
// step 2: date, amount, where they paid from
await p.click(p.$('topup-sent'));assert.equal(p.$('topup-pay').hidden,true);assert.equal(p.$('topup-confirm').hidden,false);assert.equal(p.$('topup-confirm').elements.date.value,today);
assert.equal(p.$('topup-send').disabled,true,'nothing to send before the coins show');await p.price();assert.match(p.$('topup-quote').textContent,/You receive 525 Cotton \(500 \+ 25 bonus\)/);
const f=p.$('topup-confirm');f.elements.payer.value='1';f.elements.terms.checked=true;await p.submit('topup-confirm');
assert.equal(p.calls.some(c=>c.name==='submit_instapay_topup'),false);
assert.match(p.$('topup-status').textContent,/InstaPay address or wallet phone/);
assert.match(p.$('topup-form-error').textContent,/InstaPay address or wallet phone/,'the error is visible beside the form');
assert.equal(f.elements.payer.getAttribute('aria-invalid'),'true');
f.elements.payer.value='+20 100 123 4567';f.elements.payer.dispatchEvent(new p.w.Event('input'));
assert.equal(p.$('topup-form-error'),null,'correcting the field clears the error');
p.$('topup-confirm').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await p.submit('topup-confirm');
const sends=p.calls.filter(c=>c.name==='submit_instapay_topup');assert.equal(sends.length,1,'a double click sends once');
assert.deepEqual({...sends[0].args,p_request_key:undefined},{p_amount_piastres:10000,p_request_key:undefined,p_accept_terms:true,p_expected_coins:525,p_pricing_version:1,p_payer:'+20 100 123 4567',p_sent_on:today});
assert.equal(p.$('topup-confirm').hidden,true);assert.match(p.$('topup-status').textContent,/add 525 Cotton once your 100 EGP shows/);assert.equal(p.$('topup-new').hidden,false);
await p.click(p.$('topup-new'));assert.equal(p.$('topup-pay').hidden,false);
await p.click(p.$('topup-sent'));await p.click(p.$('topup-back'));assert.equal(p.$('topup-pay').hidden,false,'a way back to the details');p.close();
// A payment already sent above the former 10,000 EGP cap can be reported as one transfer.
p=await boot({rpc:(name,args)=>{
 if(name==='topup_payment_details')return {data:{enabled:true,instapay_address:'project@instapay',recipient_name:'Lightning Recipient',note_email:'member@example.test',coins_per_egp:5,minimum_egp:10,maximum_egp:null,pricing_version:2,tiers:[]},error:null};
 if(name==='quote_topup_amount')return {data:{amount_piastres:args.p_amount_piastres,coins:172500,base_coins:150000,bonus_coins:22500,pricing_version:2,enabled:true},error:null};
 return null;
}});
assert.match(p.$('topup-rate').textContent,/Send from 10 EGP/);assert.doesNotMatch(p.$('topup-rate').textContent,/10,000|100,000/);
await p.click(p.$('topup-sent'));assert.equal(p.$('topup-amount').hasAttribute('max'),false);
p.$('topup-amount').value='30000';p.$('topup-amount').dispatchEvent(new p.w.Event('input'));await new Promise(r=>setTimeout(r,300));
assert.equal(p.$('topup-send').disabled,false);p.$('topup-confirm').elements.payer.value='payer@instapay';p.$('topup-confirm').elements.terms.checked=true;
await p.submit('topup-confirm');assert.equal(p.calls.find(c=>c.name==='submit_instapay_topup').args.p_amount_piastres,3000000);p.close();
// a request opened earlier without details: "I've paid" confirms that one, at its amount
p=await boot();p.state.rows=[{...proof,request_key:'66666666-6666-4666-8666-666666666666',original_amount_piastres:10000,created_at:'2026-10-25T09:00:00Z'}];await p.click(p.$('topup-refresh'));
assert.match(p.$('topup-history').textContent,/Waiting for your details/);await p.click([...p.$('topup-history').querySelectorAll('button')].find(b=>b.textContent==='I’ve paid'));
assert.equal(p.$('topup-amount').value,'100');assert.equal(p.$('topup-amount').readOnly,true);assert.equal(p.$('topup-send').disabled,false);
p.$('topup-confirm').elements.payer.value='me@instapay';p.$('topup-confirm').elements.terms.checked=true;await p.submit('topup-confirm');
assert.equal(p.calls.find(c=>c.name==='submit_instapay_topup').args.p_request_key,'66666666-6666-4666-8666-666666666666');p.close();
// sent details show as being checked, with no actions
p=await boot();p.state.rows=[{...proof,details_submitted_at:'2026-10-26T10:00:00Z',member_sent_on:'2026-10-26'}];await p.click(p.$('topup-refresh'));assert.match(p.$('topup-history').textContent,/Being checked.*paid 2026-10-26/);assert.equal(p.$('topup-history').querySelectorAll('button').length,0);p.close();
// closed: no details to copy, history stays
p=await boot({closed:true});assert.equal(p.$('topup-pay').hidden,true);assert.match(p.$('topup-status').textContent,/closed/);assert.match(p.$('topup-history').textContent,/Cotton/);p.close();
// signing out while sending shows nothing of the old account
let finish;const pending=new Promise(r=>finish=r);p=await boot({rpc:name=>name==='submit_instapay_topup'?pending:null});await p.click(p.$('topup-sent'));await p.price();p.$('topup-confirm').elements.payer.value='me@instapay';p.$('topup-confirm').elements.terms.checked=true;
p.$('topup-confirm').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await tick();await p.signOut();finish({data:{...proof,coins:525},error:null});await tick();
assert.doesNotMatch(p.$('topup-status').textContent,/525 Cotton/);assert.equal(p.$('topup-history').textContent,'');assert.equal(p.$('topup-details').textContent,'');p.close();
console.log('Checkout UI: copy details, confirm date, amount and sender, one send per click, paused history and sign-out privacy passed');
