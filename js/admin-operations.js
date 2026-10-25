(function(){
 const FG=window.FG,$=id=>document.getElementById(id);let factor=null,lastPayload='',requestKey=crypto.randomUUID(),adminUser=null;
 const status=(id,text)=>{$(id).textContent=text;};
 const error=e=>FG.say(e);
 async function call(name,params){const r=await FG.sb.rpc(name,params);if(r.error)throw r.error;return r.data;}
 function reset(){$('admin-credit-form').reset();lastPayload='';requestKey=crypto.randomUUID();status('admin-credit-status','');}
 async function init(){if(!FG.sb||!FG.session())return;try{if(!await call('is_admin',{}))return;}catch{return;}
 $('admin-mfa-start').onclick=async()=>{try{
  if(factor&&$('admin-mfa-setup').childElementCount){status('admin-mfa-status','Scan the displayed QR code, then enter the authenticator code.');return;}
  const r=await FG.sb.auth.mfa.listFactors();if(r.error)throw r.error;
  const current=r.data.totp.find(f=>f.status==='verified');
  if(current){factor=current.id;status('admin-mfa-status','Enter a current authenticator code.');return;}
  for(const pending of (r.data.all||[]).filter(f=>f.factor_type==='totp'&&f.status==='unverified')){const removed=await FG.sb.auth.mfa.unenroll({factorId:pending.id});if(removed.error)throw removed.error;}
  const out=await FG.sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Lightning admin'});if(out.error)throw out.error;factor=out.data.id;
  const img=document.createElement('img');img.alt='Scan this private QR code with your authenticator';img.width=200;img.height=200;img.src=out.data.totp.qr_code.startsWith('data:')?out.data.totp.qr_code:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(out.data.totp.qr_code);$('admin-mfa-setup').replaceChildren(img);status('admin-mfa-status','Scan the QR code, then enter the six-digit code.');
 }catch(e){status('admin-mfa-status',error(e));}};
 $('admin-mfa-form').onsubmit=async e=>{e.preventDefault();if(!factor){status('admin-mfa-status','Choose set up or verify first.');return;}const b=e.currentTarget.querySelector('button');b.disabled=true;try{const r=await FG.sb.auth.mfa.challengeAndVerify({factorId:factor,code:e.currentTarget.elements.code.value});if(r.error)throw r.error;$('admin-mfa-setup').replaceChildren();e.currentTarget.reset();status('admin-mfa-status','Administrator session verified.');}catch(e){status('admin-mfa-status',error(e));}finally{b.disabled=false;}};
 $('admin-credit-new').onclick=reset;
 $('admin-credit-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,p={p_email:f.elements.email.value,p_coins:Number(f.elements.coins.value),p_points:Number(f.elements.points.value),p_reason:f.elements.reason.value};const text=JSON.stringify(p);if(text!==lastPayload){requestKey=crypto.randomUUID();lastPayload=text;}const b=f.querySelector('[type=submit]');b.disabled=true;try{const w=await call('admin_credit_account',{...p,p_key:requestKey});status('admin-credit-status','Saved. Wallet: '+w.balance+' coins. Recognition: '+w.contribution_score+' points. Repeating this request will not credit twice.');}catch(e){status('admin-credit-status',error(e));}finally{b.disabled=false;}};
 $('admin-price-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await call('admin_set_palette_price',{p_item_id:f.elements.item.value,p_price:Number(f.elements.price.value)});status('admin-price-status','Price saved.');}catch(e){status('admin-price-status',error(e));}};
 }
 FG.ready.then(init);FG.onAuth(()=>{const uid=FG.session()?.user.id||null;if(uid!==adminUser){adminUser=uid;$('admin-mfa-setup').replaceChildren();factor=null;reset();}init();});
})();
// All receipt actions bind to the exact evidence revision displayed in this queue.
(function(){
 'use strict';
 const FG=window.FG,$=id=>document.getElementById(id),say=(id,s)=>$(id).textContent=s;
 const el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 let generation=0,owner=null,packageKey=crypto.randomUUID(),packagePayload='',packageBusy=false;
 async function rpc(name,args){const r=await FG.sb.rpc(name,args);if(r.error)throw r.error;return r.data;}
 function button(text,fn,statusId='admin-payments-status'){const b=el('button',text);b.type='button';b.className='btn ghost';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){say(statusId,FG.say(e));}finally{b.disabled=false;}};return b;}
 function cents(text){if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('Enter an EGP price with at most two decimal places');const [w,f='']=text.split('.');const n=Number(w)*100+Number(f.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw Error('Invalid price');return n;}
 async function packages(){const run=generation;const r=await FG.sb.from('coin_packages').select('*').order('created_at',{ascending:false});if(run!==generation)return;if(r.error)throw r.error;$('admin-packages').replaceChildren();
  for(const p of r.data){const row=el('p',p.name+' · '+p.coins+' coins · '+(p.price_piastres/100).toFixed(2)+' EGP · '+(p.active?'active':'retired'));row.append(button(p.active?'Retire package':'Offer package',async()=>{await rpc('admin_set_coin_package_active',{p_id:p.id,p_active:!p.active});await packages();}));$('admin-packages').append(row);}
 }
 async function settings(){const run=generation;const r=await FG.sb.from('payment_settings').select('*').eq('id',1).maybeSingle();if(run!==generation)return;if(r.error)throw r.error;const f=$('admin-payments-form'),c=r.data||{};f.elements.address.value=c.instapay_address||'';f.elements.recipient.value=c.recipient_name||'';f.elements.qr.value=c.qr_url||'';f.elements.enabled.checked=!!c.enabled;}
 async function receipts(){const run=generation;$('admin-receipts').replaceChildren();const r=await FG.sb.from('topup_requests').select('*').eq('status','pending').order('created_at').limit(50);if(run!==generation)return;if(r.error)throw r.error;
  if(!r.data.length)$('admin-receipts').append(el('p','No pending top-ups.'));
  for(const row of r.data){const card=el('article');card.className='panel';card.append(el('h3',row.id),el('p',(row.transfer_note_email||'No checkout email')+' · '+(row.payer_instapay_address||'No payer address')+' · reference '+(row.customer_payment_reference||'not submitted')),el('p',row.coins+' coins · expected '+(row.price_piastres/100).toFixed(2)+' EGP'));
   const note=el('input');note.placeholder='Reconciliation or rejection note';note.maxLength=500;note.setAttribute('aria-label','Reconciliation or rejection note');
   if(row.receipt_object_key){
    let viewed=false;const view=button('View private receipt',async()=>{const out=await FG.sb.storage.from('topup-receipts').createSignedUrl(row.receipt_object_key,300);if(run!==generation)return;if(out.error)throw out.error;const img=el('img');img.alt='Customer receipt; compare against actual incoming transfer';img.src=out.data.signedUrl;img.style.maxWidth='100%';img.referrerPolicy='no-referrer';img.onload=()=>{viewed=true;};img.onerror=()=>{viewed=false;view.hidden=false;img.remove();say('admin-receipts-status','The receipt image could not load. Open it again before approving.');};view.after(img);view.hidden=true;},'admin-receipts-status');card.append(view);
    const image=el('input');image.type='checkbox';const il=el('label');il.append(image,document.createTextNode(' I reviewed this receipt.'));
    const bank=el('input');bank.type='checkbox';const bl=el('label');bl.append(bank,document.createTextNode(' I confirmed the transfer reached our account.'));
    const received=el('input');received.inputMode='decimal';received.placeholder='Actual EGP received';received.setAttribute('aria-label','Actual EGP received');
    const ref=el('input');ref.placeholder='Receiving bank transaction reference';ref.setAttribute('aria-label','Receiving bank transaction reference');card.append(il,bl,received,ref);
    card.append(button('Approve and credit coins',async()=>{if(!viewed||!image.checked||!bank.checked)throw Error('Open the receipt, review it and confirm actual bank settlement first.');if(!note.value.trim())throw Error('Add a reconciliation note.');await rpc('admin_settle_topup',{p_request_id:row.id,p_receipt_key:row.receipt_object_key,p_receipt_revision:row.receipt_revision,p_received_piastres:cents(received.value),p_payment_reference:ref.value,p_note:note.value});if(run!==generation)return;card.remove();say('admin-receipts-status','Payment approved and credited once. Refresh the queue if evidence changed.');},'admin-receipts-status'));
   }else card.append(el('p','Waiting for receipt upload.'));
   card.append(note,button('Reject request',async()=>{if(!note.value.trim())throw Error('Give the member a clear rejection reason.');await rpc('admin_review_topup',{p_request_id:row.id,p_decision:'rejected',p_received_piastres:null,p_payment_reference:null,p_note:note.value});if(run!==generation)return;card.remove();say('admin-receipts-status','Request rejected without a coin credit.');},'admin-receipts-status'));$('admin-receipts').append(card);
  }
 }
 async function init(){const uid=FG.session()?.user.id||null;if(uid!==owner){owner=uid;generation++;$('admin-receipts').replaceChildren();$('admin-packages').replaceChildren();$('admin-payments-form').reset();packageKey=crypto.randomUUID();packagePayload='';}
  const run=generation;if(!uid||!FG.sb)return;try{if(!await rpc('is_admin',{})||run!==generation)return;await Promise.all([settings(),packages()]);}catch(e){if(run===generation)say('admin-payments-status',FG.say(e));}
 }
 $('admin-payments-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await rpc('admin_configure_payments',{p_address:f.elements.address.value,p_name:f.elements.recipient.value,p_qr_url:f.elements.qr.value,p_enabled:f.elements.enabled.checked});say('admin-payments-status','Checkout settings saved.');}catch(e){say('admin-payments-status',FG.say(e));}finally{b.disabled=false;}};
 $('admin-package-form').onsubmit=async e=>{e.preventDefault();if(packageBusy)return;const f=e.currentTarget,b=f.querySelector('button');packageBusy=true;b.disabled=true;try{const p={p_name:f.elements.name.value,p_coins:Number(f.elements.coins.value),p_price_piastres:cents(f.elements.price.value),p_active:f.elements.active.checked};const payload=JSON.stringify(p);if(payload!==packagePayload){packagePayload=payload;packageKey=crypto.randomUUID();}await rpc('admin_save_coin_package',{...p,p_key:packageKey});say('admin-package-status','Package saved. Create a new package to change its price; existing checkouts keep their quoted amount.');f.reset();packagePayload='';packageKey=crypto.randomUUID();await packages();}catch(e){say('admin-package-status',FG.say(e));}finally{packageBusy=false;b.disabled=false;}};
 $('admin-receipts-load').onclick=()=>receipts().catch(e=>say('admin-receipts-status',FG.say(e)));
 $('admin-reconcile').onclick=async()=>{try{const rows=await rpc('admin_wallet_reconciliation',{});say('admin-reconcile-status',rows.every(r=>Number(r.difference)===0)?'All wallet balances match their ledger totals.':'Balance mismatch found. Contact support before issuing corrections.');}catch(e){say('admin-reconcile-status',FG.say(e));}};
 $('admin-receipt-cleanup').onclick=async()=>{const b=$('admin-receipt-cleanup');b.disabled=true;try{const rows=await rpc('admin_receipt_cleanup_candidates',{});if(!rows.length){say('admin-receipt-cleanup-status','No expired receipts to remove.');return;}if(!window.confirm('Permanently remove '+rows.length+' receipt images older than 90 days? Pending payment evidence is protected.'))return;const out=await FG.sb.storage.from('topup-receipts').remove(rows.map(r=>r.object_key));if(out.error)throw out.error;say('admin-receipt-cleanup-status','Expired image files removed. Financial ledger entries were retained.');}catch(e){say('admin-receipt-cleanup-status',FG.say(e));}finally{b.disabled=false;}};
 FG.ready.then(init);FG.onAuth(init);
})();
