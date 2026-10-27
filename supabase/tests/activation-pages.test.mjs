import {JSDOM} from 'jsdom';
import {readFileSync} from 'node:fs';
import assert from 'node:assert/strict';
const dom=new JSDOM('<html><body><div id="mkt-body"><div class="mkt-cell" data-state="owned" data-item="test-theme"></div><div class="mkt-cell" data-state="for-sale" data-item="test-theme"></div></div></body></html>',{url:'https://lightningeg.com/marketplace.html',runScripts:'outside-only'});
const w=dom.window;let session={user:{id:'test'}},notify,pending;
w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
w.FG={ready:Promise.resolve(),session:()=>session,onAuth:fn=>notify=fn,sb:{
 from:()=>({select:()=>({eq:async()=>({data:[{item_id:'test-theme',asset_version:1}],error:null})})}),
 rpc:name=>name==='my_theme_seats'?Promise.resolve({data:[{item_id:'test-theme',name:'Test theme',seats:1,used:1,next_price:25,can_buy:true}],error:null}):new Promise(resolve=>pending=resolve)
}};
w.eval(readFileSync(new URL('../../js/activation-codes.js',import.meta.url),'utf8'));
const tick=()=>new Promise(r=>w.setTimeout(r,0));await tick();await tick();
assert.equal(w.document.querySelectorAll('[data-activation-code]').length,1,'no code for unowned cell');
w.document.querySelector('[data-activation-code]').click();
pending({data:{code:'12345678-12345678-12345678-12345678'},error:null});await tick();
assert.ok(w.document.querySelector('dialog').open);assert.match(w.document.querySelector('dialog').textContent,/that profile’s other devices unlock by themselves, with no code/);assert.match(w.document.querySelector('dialog').textContent,/different profile needs its own unlock, at a quarter of the price/);
const input=w.document.querySelector('dialog input');assert.equal(input.value,'12345678-12345678-12345678-12345678');
session=null;notify();await tick();assert.equal(w.document.querySelector('dialog'),null);assert.equal(input.value,'');
assert.equal(w.document.querySelectorAll('[data-activation-code]').length,0);
w.close();console.log('Activation UI: owned-only controls, one-time delivery copy and sign-out clearing passed');
