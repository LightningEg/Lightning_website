// Optional native Chromium acceptance: run a local HTTP server on :8000 first.
// Uses a fake auth transport; never calls the real Supabase project.
import { chromium } from 'playwright-core';
import assert from 'node:assert/strict';
const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
const stub=`window.supabase={createClient:()=>({auth:{onAuthStateChange:fn=>{setTimeout(()=>fn('INITIAL_SESSION',null),0);return {data:{subscription:{unsubscribe(){}}}}}},rpc:async()=>({data:[],error:null})})};`;
const context=await browser.newContext({viewport:{width:390,height:844}});
await context.route('**/js/vendor/supabase-*.js',r=>r.fulfill({contentType:'application/javascript',body:stub}));
await context.route('https://**',r=>r.abort());
const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
await page.goto('http://127.0.0.1:8000/index.html');
await page.locator('.site-invite[open]').waitFor();
assert.equal(await page.locator('.site-benefits img').count(),3);
assert.ok(await page.locator('.site-invite a').first().getAttribute('href')==='account.html?signup=1');
await page.screenshot({path:'/workspace/work/invite-phone.png'});
await page.keyboard.press('Escape');
assert.equal(await page.locator('.site-invite[open]').count(),0);
await page.reload();assert.equal(await page.locator('.site-invite[open]').count(),0);
for(const width of [390,1280]) {
 await page.setViewportSize({width,height:900});
 for(const name of ['account','marketplace']) {
  await page.goto('http://127.0.0.1:8000/'+name+'.html'+(name==='account'?'?signup=1':''));
  await page.waitForTimeout(100);
  assert.equal(await page.locator('.d-links a[href="marketplace.html"]').count(),1);
  await page.screenshot({path:'/workspace/work/'+name+'-'+width+'.png'});
  const overflow=await page.evaluate(()=>[...document.querySelectorAll('body *')].filter(e=>e.getBoundingClientRect().right>innerWidth+1).slice(0,8).map(e=>[e.tagName,e.className,e.getBoundingClientRect().width]));
  assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'no horizontal overflow '+name+' '+width+JSON.stringify(overflow));
  if(name==='account')assert.match(await page.locator('#auth-title').textContent(),/create|sign up/i);
  await page.screenshot({path:'/workspace/work/'+name+'-'+width+'.png'});
 }
}
await page.goto('http://127.0.0.1:8000/ar/index.html');
assert.equal(await page.locator('.d-links a[href="../account.html"]').count(),1);
assert.deepEqual(errors,[]);
await browser.close();console.log('Main site Chromium: invitation, dismissal, signup, links and phone/desktop layout passed');
