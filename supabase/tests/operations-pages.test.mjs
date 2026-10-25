// Exercises the actual checkout and owner scripts; no external services or transfers.
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
const read=p=>readFileSync(new URL('../../'+p,import.meta.url),'utf8');
const tick=()=>new Promise(r=>setTimeout(r,25));
const uid='11111111-1111-4111-8111-111111111111';
const packageId='22222222-2222-4222-8222-222222222222';
const proof={id:'33333333-3333-4333-8333-333333333333',user_id:uid,status:'pending',price_piastres:10000,coins:500,destination_address:'project@instapay',destination_name:'Recipient',destination_qr_url:'https://example.test/qr.png',transfer_note_email:'member@example.test',receipt_object_key:null,receipt_revision:0};
async function boot({admin=false,closed=false,rpc:override=null,uploadError=false}={}){
 const dom=new JSDOM(read(admin?'forgeeks-admin.html':'topup.html'),{url:'https://lightningeg.com/'+(admin?'forgeeks-admin.html':'topup.html'),runScripts:'outside-only'}),w=dom.window;
 let session={user:{id:uid}},uploads=0;const listeners=[],calls=[],state={rows:[{...proof}],packages:[{id:packageId,name:'Test',coins:500,price_piastres:10000,active:true}]};
 const config={enabled:!closed,instapay_address:'project@instapay',recipient_name:'Recipient',qr_url:'https://example.test/qr.png'};
 const from=table=>{const builder={select(){return this;},eq(){return this;},order(){return this;},limit(){return this;},maybeSingle(){return Promise.resolve({data:config,error:null});},then(a,b){let data=table==='coin_packages'?state.packages:table==='topup_requests'?state.rows:[];return Promise.resolve({data,error:null}).then(a,b);}};return builder;};
 w.confirm=()=>true;
 w.FG={session:()=>session,ready:Promise.resolve(),onAuth:fn=>listeners.push(fn),say:e=>e.message||String(e),sb:{from,rpc:async(name,args)=>{
  calls.push({name,args});if(override){const r=override(name,args);if(r)return await r;}
  if(name==='is_admin')return {data:admin,error:null};
  if(name==='create_checkout')return {data:{...proof,request_key:args.p_request_key},error:null};
  if(name==='reserve_topup_receipt')return {data:uid+'/'+proof.id+'/reserved',error:null};
  if(name==='attach_topup_receipt')return {data:{...proof,receipt_object_key:args.p_object_key},error:null};
  return {data:{},error:null};
 },storage:{from:()=>({upload:async(path)=>{calls.push({name:'upload',path});uploads++;return {error:uploadError?(uploads===1?{message:'Failed to fetch'}:{statusCode:'409'}):null};},createSignedUrl:async path=>{calls.push({name:'signed',path});return {data:{signedUrl:'https://example.test/private-receipt'},error:null};},remove:async paths=>{calls.push({name:'remove',paths});return {error:null};}})}}};
 w.eval(read(admin?'js/admin-operations.js':'js/topup.js'));await tick();
 const $=id=>w.document.getElementById(id),submit=async id=>{$(id).dispatchEvent(new w.Event('submit',{bubbles:true,cancelable:true}));await tick();},click=async e=>{e.click();await tick();};
 return {w,$,submit,click,calls,state,async signOut(){session=null;listeners.forEach(fn=>fn(null));await tick();},close(){w.close();}};
}
let p=await boot();p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');await p.submit('topup-start');let keys=p.calls.filter(c=>c.name==='create_checkout').map(c=>c.args.p_request_key);assert.equal(keys[0],keys[1]);await p.click(p.$('topup-new'));assert.equal(p.$('topup-start').elements.terms.checked,false);p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');keys=p.calls.filter(c=>c.name==='create_checkout').map(c=>c.args.p_request_key);assert.notEqual(keys[2],keys[0]);p.close();
p=await boot({uploadError:true});p.$('topup-start').elements.terms.checked=true;await p.submit('topup-start');const form=p.$('topup-proof');form.elements.payer.value='sender@instapay';form.elements.reference.value='PAYMENT-123';const file=new p.w.File(['image'],'receipt.png',{type:'image/png'});Object.defineProperty(form.elements.receipt,'files',{value:[file]});await p.submit('topup-proof');await p.submit('topup-proof');assert.equal(p.calls.filter(c=>c.name==='reserve_topup_receipt').length,1);assert.equal(p.calls.filter(c=>c.name==='attach_topup_receipt').length,1);assert.equal(p.calls.some(c=>c.name==='admin_settle_topup'),false);p.close();
p=await boot({closed:true});assert.equal(p.$('topup-start').hidden,true);assert.match(p.$('topup-history').textContent,/Open request/);p.close();
let finish;const pending=new Promise(r=>finish=r);p=await boot({rpc:name=>name==='create_checkout'?pending:null});p.$('topup-start').elements.terms.checked=true;p.$('topup-start').dispatchEvent(new p.w.Event('submit',{cancelable:true}));await tick();await p.signOut();finish({data:proof,error:null});await tick();assert.equal(p.$('topup-payment').hidden,true);assert.equal(p.$('topup-details').textContent,'');p.close();
p=await boot({admin:true});p.state.rows=[{...proof,receipt_object_key:uid+'/'+proof.id+'/image',receipt_revision:7,customer_payment_reference:'PAYMENT-123'}];await p.click(p.$('admin-receipts-load'));let card=p.$('admin-receipts').querySelector('article');const buttons=[...card.querySelectorAll('button')];await p.click(buttons.find(b=>b.textContent==='View private receipt'));card.querySelector('img').dispatchEvent(new p.w.Event('load'));const checks=card.querySelectorAll('input[type=checkbox]');checks.forEach(c=>c.checked=true);card.querySelector('[aria-label="Actual EGP received"]').value='100.00';card.querySelector('[aria-label="Receiving bank transaction reference"]').value='BANK-123';card.querySelector('[aria-label="Reconciliation or rejection note"]').value='Verified actual incoming funds';await p.click(buttons.find(b=>b.textContent==='Approve and credit coins'));const settle=p.calls.find(c=>c.name==='admin_settle_topup');assert.equal(settle.args.p_receipt_revision,7);assert.equal(settle.args.p_received_piastres,10000);assert.equal(p.calls.some(c=>c.name==='admin_review_uploaded_receipt'),false);p.close();
console.log('Checkout/owner UI: fresh request keys, lost upload retries, paused history, sign-out privacy and atomic evidence approval passed');
