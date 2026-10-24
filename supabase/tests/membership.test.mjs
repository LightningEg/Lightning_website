import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {JSDOM} from 'jsdom';
const script=readFileSync(new URL('../../js/site-membership.js',import.meta.url),'utf8');
async function page({signedIn=false,ar=false,dismissed=false,blocked=false}={}) {
 const dom=new JSDOM(`<html lang="${ar?'ar-EG':'en'}"><body><a data-site-account>Account</a></body></html>`,{url:'https://lightningeg.com/'+(ar?'ar/':'')+'index.html',runScripts:'outside-only'});
 const w=dom.window;
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;};
 if(dismissed)w.localStorage.setItem('lightning-account-invite-dismissed-v1',String(Date.now()));
 if(blocked)Object.defineProperty(w,'localStorage',{get(){throw new Error('Storage blocked');}});
 w.FG={available:true,ready:Promise.resolve({session:signedIn?{user:{id:'test'}}:null}),onAuth:()=>{}};
 w.eval(script);await new Promise(r=>w.setTimeout(r,0));return w;
}
let w=await page();assert.ok(w.document.querySelector('dialog').open);assert.equal(w.document.querySelectorAll('figure img').length,3);
w.document.querySelector('[data-later]').click();assert.equal(w.document.querySelector('dialog').open,false);assert.ok(w.localStorage.getItem('lightning-account-invite-dismissed-v1'));w.close();
w=await page({signedIn:true});assert.equal(w.document.querySelector('dialog'),null);assert.equal(w.document.querySelector('a').textContent,'My account');w.close();
w=await page({dismissed:true});assert.equal(w.document.querySelector('dialog'),null);w.close();
w=await page({blocked:true});assert.ok(w.document.querySelector('dialog').open);w.document.querySelector('[data-later]').click();w.close();
w=await page({ar:true});assert.equal(w.document.querySelector('dialog a').getAttribute('href'),'../account.html?signup=1');assert.match(w.document.querySelector('h2').textContent,/Lightning/);w.close();
console.log('Membership invitation: images, account links, dismissal, signed-in suppression, blocked storage and Arabic passed');
