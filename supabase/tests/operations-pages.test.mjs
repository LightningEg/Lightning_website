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
 const from=table=>{const filters={};let max=Infinity;const builder={select(){return this;},eq(k,v){filters[k]=v;return this;},order(){return this;},limit(n){max=n;return this;},maybeSingle(){return Promise.resolve({data:table==='wallets'?{balance:0}:config,error:null});},then(a,b){let data=table==='coin_packages'?state.packages:table==='topup_requests'?state.rows:table==='wallets'?{balance:0}:[];if(table==='topup_requests')data=data.filter(r=>Object.entries(filters).every(([k,v])=>r[k]===v)).slice(0,max);return Promise.resolve({data,error:null}).then(a,b);}};return builder;};
 w.confirm=()=>true;
 w.FG={session:()=>session,ready:Promise.resolve(),onAuth:fn=>listeners.push(fn),say:e=>e.message||String(e),sb:{from,rpc:async(name,args)=>{
  calls.push({name,args});if(override){const r=override(name,args);if(r)return await r;}
  if(name==='is_admin')return {data:admin,error:null};
  if(name==='checkout_availability')return {data:{enabled:!closed},error:null};
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
let p=await boot();await p.price();assert.equal(p.$('topup-qr').hasAttribute('src'),false);assert.equal(p.$('topup-details').textContent,'');p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');await p.submit('topup-start');let keys=p.calls.filter(c=>c.name==='create_amount_checkout').map(c=>c.args.p_request_key);assert.equal(keys[0],keys[1]);await p.click(p.$('topup-new'));assert.equal(p.$('topup-start').elements.terms.checked,false);p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');keys=p.calls.filter(c=>c.name==='create_amount_checkout').map(c=>c.args.p_request_key);assert.notEqual(keys[2],keys[0]);p.close();
p=await boot({uploadError:true});await p.price();p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');const form=p.$('topup-proof');form.elements.payer.value='sender@instapay';form.elements.reference.value='PAYMENT-123';const file=new p.w.File(['image'],'receipt.png',{type:'image/png'});Object.defineProperty(form.elements.receipt,'files',{value:[file]});await p.submit('topup-proof');await p.submit('topup-proof');assert.equal(p.calls.filter(c=>c.name==='reserve_topup_receipt').length,1);assert.equal(p.calls.filter(c=>c.name==='attach_topup_receipt').length,1);assert.equal(p.calls.some(c=>c.name==='admin_settle_topup'),false);p.close();
p=await boot({closed:true});assert.equal(p.$('topup-start').hidden,true);assert.match(p.$('topup-history').textContent,/Open request/);p.close();
let finish;const pending=new Promise(r=>finish=r);p=await boot({rpc:name=>name==='create_amount_checkout'?pending:null});await p.price();p.$('topup-start').elements.terms.checked=true;p.$('topup-start').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await tick();await p.signOut();finish({data:proof,error:null});await tick();assert.equal(p.$('topup-payment').hidden,true);assert.equal(p.$('topup-details').textContent,'');p.close();
// An old quote must not become usable during the debounce for a newly typed amount.
let quoteDone;const oldQuote=new Promise(r=>quoteDone=r);
p=await boot({rpc:name=>name==='quote_topup_amount'?oldQuote:null});
p.$('topup-amount').value='100';p.$('topup-amount').dispatchEvent(new p.w.Event('input'));await new Promise(r=>setTimeout(r,275));
p.$('topup-amount').value='200';p.$('topup-amount').dispatchEvent(new p.w.Event('input'));
quoteDone({data:{amount_piastres:10000,coins:525,base_coins:500,bonus_coins:25,bonus_percent:5,minimum_egp:10,maximum_egp:10000,enabled:true},error:null});await tick();
assert.equal(p.$('topup-continue').disabled,true,'an old quote is invalid immediately when the amount changes');
await p.submit('topup-start');assert.equal(p.calls.some(c=>c.name==='create_amount_checkout'),false);p.close();
// An upload keeps its own reserved path even if the customer opens another request.
let uploadDone;const delayedUpload=new Promise(r=>uploadDone=r);
p=await boot({uploadOverride:()=>delayedUpload});await p.price();p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');
const uploadForm=p.$('topup-proof');uploadForm.elements.payer.value='sender@instapay';uploadForm.elements.reference.value='PAYMENT-456';Object.defineProperty(uploadForm.elements.receipt,'files',{value:[new p.w.File(['image'],'receipt.png',{type:'image/png'})]});
p.$('topup-proof').dispatchEvent(new p.w.Event('submit',{bubbles:true,cancelable:true}));await tick();await p.click(p.$('topup-new'));uploadDone({error:null});await tick();
assert.equal(p.calls.filter(c=>c.name==='attach_topup_receipt').length,1,'upload is attached to its original request');assert.equal(p.$('topup-payment').hidden,true,'the old receipt cannot replace the newly selected request');p.close();
p=await boot({rpc:(name,args)=>name==='create_amount_checkout'?{data:{...proof,request_key:args.p_request_key,reopened_at:new Date().toISOString()},error:null}:null});await p.price();p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');assert.equal(p.$('topup-instructions').hidden,true);assert.match(p.$('topup-payment-note').textContent,/Do not pay again/);assert.equal(p.calls.some(c=>c.name==='checkout_qr'),false);p.close();
p=await boot();const oldId='55555555-5555-4555-8555-555555555555';p.state.rows=Array.from({length:60},(_,i)=>({...proof,id:'approved-'+i,status:'approved'})).concat([{...proof,id:oldId}]);await p.click(p.$('topup-refresh'));assert.match(p.$('topup-history').textContent,new RegExp(oldId));assert.equal(p.$('topup-history-more').hidden,false);await p.click(p.$('topup-history-more'));assert.equal(p.$('topup-history').querySelectorAll('p').length,61);p.close();
console.log('Checkout UI: private QR, exact quotes, request retries, upload retries, paused history and sign-out privacy passed');
