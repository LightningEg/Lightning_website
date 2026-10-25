(function(){
 'use strict';
 const FG=window.FG,$=id=>document.getElementById(id);let checkout=null,key=crypto.randomUUID(),activeUser=null,version=0,pendingUpload=null;
 const msg=s=>{$('topup-status').textContent=s;};
 const el=(t,text)=>{const e=document.createElement(t);if(text!=null)e.textContent=text;return e;};
 async function call(n,p){const r=await FG.sb.rpc(n,p);if(r.error)throw r.error;return r.data;}
 function clear(){checkout=null;pendingUpload=null;$('topup-payment').hidden=true;$('topup-details').replaceChildren();$('topup-proof').reset();$('topup-qr').removeAttribute('src');}
 function fresh(){key=crypto.randomUUID();clear();$('topup-start').elements.terms.checked=false;msg('Choose a package and accept the terms for a new top-up. Do not pay twice for an existing request.');}
 function show(r){clear();checkout=r;$('topup-payment').hidden=r.status!=='pending';
  const rows=[['Pay',(r.price_piastres/100).toFixed(2)+' EGP'],['Receive',r.coins+' coins'],['Recipient',r.destination_name],['InstaPay address',r.destination_address],['Transfer note: your Lightning email',r.transfer_note_email],['Order reference',r.id]];
  for(const [label,value]of rows){const dt=el('dt',label),dd=el('dd',value||'Not configured');if(value){const copy=el('button','Copy');copy.type='button';copy.className='btn ghost';copy.onclick=async()=>{try{await navigator.clipboard.writeText(String(value));msg(label+' copied.');}catch{msg('Copy this value: '+value);}};dd.append(copy);}$('topup-details').append(dt,dd);}
  if(r.destination_qr_url&&/^https:\/\//.test(r.destination_qr_url))$('topup-qr').src=r.destination_qr_url;
  $('topup-proof').elements.payer.value=r.payer_instapay_address||'';$('topup-proof').elements.reference.value=r.customer_payment_reference||'';
 }
 async function history(){const run=version,uid=activeUser;if(!uid)return;const r=await FG.sb.from('topup_requests').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(30);if(run!==version)return;if(r.error)throw r.error;$('topup-history').replaceChildren();
  if(!r.data.length)$('topup-history').append(el('p','No top-ups yet.'));
  for(const row of r.data){const p=el('p',row.id+' · '+row.coins+' coins · '+row.status+(row.receipt_object_key?' · receipt received':''));
   if(row.status==='rejected'&&row.review_note)p.append(el('span',' · Review: '+row.review_note));
   if(row.status==='approved')p.append(el('span',' · Coins credited to your wallet.'));
   if(row.status==='pending'&&row.destination_address){const b=el('button','Open request');b.type='button';b.className='btn ghost';b.onclick=()=>show(row);p.append(b);}
   if(row.status==='pending'&&!row.receipt_object_key){const b=el('button','Cancel unpaid request');b.type='button';b.className='btn ghost';b.onclick=async()=>{
    if(!window.confirm('Cancel only if you have not sent money. If you already paid, keep this request and upload the receipt.'))return;
    const generation=version;b.disabled=true;try{await call('cancel_topup',{p_request_id:row.id});if(generation!==version)return;if(checkout?.id===row.id)clear();await history();msg('Unpaid request cancelled.');}catch(e){if(generation===version)msg(FG.say(e));}finally{b.disabled=false;}
   };p.append(b);}$('topup-history').append(p);
  }
 }
 $('topup-new').onclick=fresh;$('topup-package').onchange=fresh;
 $('topup-start').onsubmit=async e=>{e.preventDefault();const run=version;$('topup-new').hidden=!activeUser;
  if(!activeUser){msg('Sign in first.');return;}const b=e.currentTarget.querySelector('[type=submit]');b.disabled=true;try{const r=await call('create_checkout',{p_package_id:$('topup-package').value,p_request_key:key,p_accept_terms:e.currentTarget.elements.terms.checked});if(run!==version)return;show(r);await history();msg(r.status==='pending'?'Use the exact amount and include the email above in the InstaPay note. Pay once for this request.':'This request is '+r.status+'. Choose New top-up to make another purchase.');}catch(e){if(run===version)msg(FG.say(e));}finally{b.disabled=false;}};
 $('topup-proof').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,file=f.elements.receipt.files[0],run=version,request=checkout;if(!request||!activeUser)return;
  if(!file||file.size<1||file.size>5242880||!['image/png','image/jpeg','image/webp'].includes(file.type)){msg('Choose a PNG, JPEG or WebP image up to 5 MB.');return;}
  const payer=f.elements.payer.value.trim(),ref=f.elements.reference.value.trim();
  if(!/^[a-z0-9._+-]+@[a-z0-9.-]+$/i.test(payer)||!/^[a-z0-9-]{6,100}$/i.test(ref)){msg('Enter your sending InstaPay address and a reference of 6–100 letters, digits or hyphens.');return;}
  const b=f.querySelector('button');b.disabled=true;try{
   if(!pendingUpload||pendingUpload.file!==file||pendingUpload.request!==request.id){const path=await call('reserve_topup_receipt',{p_request_id:request.id});if(run!==version)return;pendingUpload={path,file,request:request.id};}
   const out=await FG.sb.storage.from('topup-receipts').upload(pendingUpload.path,file,{upsert:false,contentType:file.type});
   // Retrying a lost upload response may find this exact reserved object already stored.
   if(out.error&&!['409','Duplicate'].includes(String(out.error.statusCode||out.error.error)))throw out.error;
   if(run!==version)return;
   const r=await call('attach_topup_receipt',{p_request_id:request.id,p_payer_address:payer,p_reference:ref,p_object_key:pendingUpload.path});
   if(run!==version)return;checkout=r;pendingUpload=null;f.reset();msg('Receipt received. Awaiting bank confirmation. Do not send another payment.');await history();
  }catch(e){if(run===version)msg('Receipt not submitted. '+FG.say(e));}finally{b.disabled=false;}
 };
 async function load(){const run=++version;activeUser=FG.session()?.user.id||null;key=crypto.randomUUID();clear();$('topup-history').replaceChildren();$('topup-package').replaceChildren();$('topup-start').hidden=true;
  $('topup-new').hidden=!activeUser;
  if(!activeUser){msg('Sign in to top up your wallet.');return;}
  try{await history();const [r,cfg]=await Promise.all([FG.sb.from('coin_packages').select('id,name,coins,price_piastres').eq('active',true).order('price_piastres'),FG.sb.from('payment_settings').select('enabled').eq('id',1).maybeSingle()]);if(run!==version)return;if(r.error)throw r.error;if(cfg.error)throw cfg.error;
   $('topup-package').replaceChildren(...r.data.map(p=>{const o=el('option',p.name+' · '+p.coins+' coins · '+(p.price_piastres/100).toFixed(2)+' EGP');o.value=p.id;return o;}));const open=cfg.data?.enabled&&r.data.length>0;$('topup-start').hidden=!open;msg(open?'':'New top-ups are currently closed. Existing requests remain available below.');
  }catch(e){if(run===version)msg('Top-ups are not available. '+FG.say(e));}
 }
 FG.ready.then(()=>{if(FG.sb)load();else msg('Sign-in is unavailable.');});FG.onAuth(load);
})();
