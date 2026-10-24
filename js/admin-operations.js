(function(){
 const FG=window.FG,$=id=>document.getElementById(id);let factor=null,lastPayload='',requestKey=crypto.randomUUID();
 const status=(id,text)=>{$(id).textContent=text;};
 const error=e=>FG.say(e);
 async function call(name,params){const r=await FG.sb.rpc(name,params);if(r.error)throw r.error;return r.data;}
 function reset(){$('admin-credit-form').reset();lastPayload='';requestKey=crypto.randomUUID();status('admin-credit-status','');}
 async function init(){if(!FG.sb||!FG.session())return;try{if(!await call('is_admin',{}))return;}catch{return;}
 $('admin-mfa-start').onclick=async()=>{try{
  const r=await FG.sb.auth.mfa.listFactors();if(r.error)throw r.error;
  const current=r.data.totp.find(f=>f.status==='verified');
  if(current){factor=current.id;status('admin-mfa-status','Enter a current authenticator code.');return;}
  const out=await FG.sb.auth.mfa.enroll({factorType:'totp',friendlyName:'Lightning admin'});if(out.error)throw out.error;factor=out.data.id;
  const img=document.createElement('img');img.alt='Scan this private QR code with your authenticator';img.width=200;img.height=200;img.src=out.data.totp.qr_code.startsWith('data:')?out.data.totp.qr_code:'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(out.data.totp.qr_code);$('admin-mfa-setup').replaceChildren(img);status('admin-mfa-status','Scan the QR code, then enter the six-digit code.');
 }catch(e){status('admin-mfa-status',error(e));}};
 $('admin-mfa-form').onsubmit=async e=>{e.preventDefault();if(!factor){status('admin-mfa-status','Choose set up or verify first.');return;}const b=e.currentTarget.querySelector('button');b.disabled=true;try{const r=await FG.sb.auth.mfa.challengeAndVerify({factorId:factor,code:e.currentTarget.elements.code.value});if(r.error)throw r.error;$('admin-mfa-setup').replaceChildren();e.currentTarget.reset();status('admin-mfa-status','Administrator session verified.');}catch(e){status('admin-mfa-status',error(e));}finally{b.disabled=false;}};
 $('admin-credit-new').onclick=reset;
 $('admin-credit-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,p={p_email:f.elements.email.value,p_coins:Number(f.elements.coins.value),p_points:Number(f.elements.points.value),p_reason:f.elements.reason.value};const text=JSON.stringify(p);if(text!==lastPayload){requestKey=crypto.randomUUID();lastPayload=text;}const b=f.querySelector('[type=submit]');b.disabled=true;try{const w=await call('admin_credit_account',{...p,p_key:requestKey});status('admin-credit-status','Saved. Wallet: '+w.balance+' coins. Recognition: '+w.contribution_score+' points. Repeating this request will not credit twice.');}catch(e){status('admin-credit-status',error(e));}finally{b.disabled=false;}};
 $('admin-price-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await call('admin_set_palette_price',{p_item_id:f.elements.item.value,p_price:Number(f.elements.price.value)});status('admin-price-status','Price saved.');}catch(e){status('admin-price-status',error(e));}};
 }
 FG.ready.then(init);FG.onAuth(()=>{$('admin-mfa-setup').replaceChildren();factor=null;reset();init();});
})();
// Payment configuration and private receipt review use the same authenticated admin session.
(function(){
 const FG=window.FG,$=id=>document.getElementById(id);const say=(id,s)=>$(id).textContent=s;
 const el=(t,s)=>{const e=document.createElement(t);if(s)e.textContent=s;return e;};
 async function rpc(n,p){const r=await FG.sb.rpc(n,p);if(r.error)throw r.error;return r.data;}
 function cents(text){if(!/^\d+(\.\d{1,2})?$/.test(text))throw Error('Enter an EGP price with at most two decimal places');const [w,f='']=text.split('.');const value=Number(w)*100+Number(f.padEnd(2,'0'));if(!Number.isSafeInteger(value)||value<1||value>2147483647)throw Error('Invalid price');return value;}
 async function init(){if(!FG.session()||!FG.sb)return;try{if(!await rpc('is_admin',{}))return;}catch{return;}
 $('admin-payments-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{await rpc('admin_configure_payments',{p_address:f.elements.address.value,p_name:f.elements.recipient.value,p_qr_url:f.elements.qr.value,p_enabled:f.elements.enabled.checked});say('admin-payments-status','Checkout settings saved.');}catch(e){say('admin-payments-status',FG.say(e));}};
 let packageKey=null,packageBusy=false;
 $('admin-package-form').onsubmit=async e=>{e.preventDefault();if(packageBusy)return;packageBusy=true;const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await rpc('admin_create_coin_package',{p_name:f.elements.name.value,p_coins:Number(f.elements.coins.value),p_price_piastres:cents(f.elements.price.value),p_active:f.elements.active.checked});say('admin-package-status','Package created.');f.reset();}catch(e){say('admin-package-status',FG.say(e));}finally{packageBusy=false;b.disabled=false;}};
 $('admin-receipts-load').onclick=async()=>{try{const r=await FG.sb.from('topup_requests').select('*').eq('status','pending').order('created_at').limit(50);if(r.error)throw r.error;$('admin-receipts').replaceChildren();
  for(const row of r.data){const card=el('article');card.className='panel';card.append(el('h3',row.id),el('p',(row.transfer_note_email||'No checkout email')+' · '+(row.payer_instapay_address||'No payer address')+' · reference '+(row.customer_payment_reference||'not submitted')),el('p',row.coins+' coins · expected '+(row.price_piastres/100).toFixed(2)+' EGP'));
   if(!row.receipt_object_key){card.append(el('p','Waiting for receipt upload.'));$('admin-receipts').append(card);continue;}
   const view=el('button','View private receipt');view.type='button';view.className='btn';view.onclick=async()=>{try{const r=await FG.sb.storage.from('topup-receipts').createSignedUrl(row.receipt_object_key,300);if(r.error)throw r.error;const img=el('img');img.alt='Customer receipt; verify against actual incoming transfer';img.src=r.data.signedUrl;img.style.maxWidth='100%';img.referrerPolicy='no-referrer';view.after(img);view.disabled=true;}catch(e){say('admin-receipts-status',FG.say(e));}};card.append(view);
   const image=el('input');image.type='checkbox';const imageLabel=el('label');imageLabel.append(image,document.createTextNode(' I reviewed this receipt.'));const bank=el('input');bank.type='checkbox';const bankLabel=el('label');bankLabel.append(bank,document.createTextNode(' I confirmed the transfer reached our account.'));
   const received=el('input');received.placeholder='Actual EGP received';received.setAttribute('aria-label','Actual EGP received');const ref=el('input');ref.placeholder='Receiving bank transaction reference';ref.setAttribute('aria-label','Receiving bank transaction reference');const note=el('input');note.placeholder='Reconciliation note';note.setAttribute('aria-label','Reconciliation note');card.append(imageLabel,bankLabel,received,ref,note);
   const approve=el('button','Approve and credit coins');approve.type='button';approve.className='btn';approve.onclick=async()=>{if(!image.checked||!bank.checked){say('admin-receipts-status','Review the image and confirm actual receipt of funds first.');return;}approve.disabled=true;try{await rpc('admin_review_uploaded_receipt',{p_request_id:row.id,p_note:note.value,p_object_key:row.receipt_object_key});await rpc('admin_review_topup',{p_request_id:row.id,p_decision:'approved',p_received_piastres:cents(received.value),p_payment_reference:ref.value,p_note:note.value});card.remove();say('admin-receipts-status','Payment approved and credited once.');}catch(e){say('admin-receipts-status',FG.say(e));approve.disabled=false;}};card.append(approve);$('admin-receipts').append(card);
  }
 }catch(e){say('admin-receipts-status',FG.say(e));}};
 }
 FG.ready.then(init);FG.onAuth(()=>{$('admin-receipts').replaceChildren();init();});
})();
