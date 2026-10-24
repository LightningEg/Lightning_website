(function(){
 const FG=window.FG,$=id=>document.getElementById(id);let checkout=null,key=crypto.randomUUID(),activeUser=null,version=0;
 const msg=s=>{$('topup-status').textContent=s;};
 const el=(t,text)=>{const e=document.createElement(t);if(text!=null)e.textContent=text;return e;};
 async function call(n,p){const r=await FG.sb.rpc(n,p);if(r.error)throw r.error;return r.data;}
 function show(r){checkout=r;$('topup-payment').hidden=r.status!=='pending';$('topup-details').replaceChildren();
  const rows=[['Pay',((r.price_piastres||0)/100).toFixed(2)+' EGP'],['Receive',r.coins+' coins'],['Recipient',r.destination_name],['InstaPay address',r.destination_address],['Transfer note: your Lightning email',r.transfer_note_email],['Order reference',r.id]];
  for(const [label,value]of rows){const dt=el('dt',label),dd=el('dd',value||'Not configured');if(value){const copy=el('button','Copy');copy.type='button';copy.className='btn ghost';copy.onclick=async()=>{try{await navigator.clipboard.writeText(String(value));msg(label+' copied.');}catch{msg('Copy this value: '+value);}};dd.append(copy);}$('topup-details').append(dt,dd);}
  if(r.destination_qr_url&&/^https:\/\//.test(r.destination_qr_url))$('topup-qr').src=r.destination_qr_url;else $('topup-qr').removeAttribute('src');
 }
 async function history(){const uid=activeUser;if(!uid)return;const r=await FG.sb.from('topup_requests').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(30);if(uid!==activeUser)return;if(r.error)throw r.error;$('topup-history').replaceChildren();
  for(const row of r.data){const p=el('p',row.id+' · '+row.coins+' coins · '+row.status+(row.receipt_object_key?' · receipt received':''));if(row.status==='pending'&&row.destination_address){const b=el('button','Open request');b.type='button';b.className='btn ghost';b.onclick=()=>show(row);p.append(b);}$('topup-history').append(p);}
 }
 $('topup-start').onsubmit=async e=>{e.preventDefault();const user=activeUser;if(!user){msg('Sign in first.');return;}const b=e.currentTarget.querySelector('button');b.disabled=true;try{const r=await call('create_checkout',{p_package_id:$('topup-package').value,p_request_key:key,p_accept_terms:e.currentTarget.elements.terms.checked});if(user!==activeUser)return;show(r);await history();msg('Use the exact amount and include the email above in the InstaPay note.');}catch(e){msg(FG.say(e));}finally{b.disabled=false;}};
 $('topup-package').onchange=()=>{key=crypto.randomUUID();checkout=null;$('topup-payment').hidden=true;};
 $('topup-proof').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,file=f.elements.receipt.files[0],user=activeUser,request=checkout;if(!request||!user)return;
  if(!file||file.size>5242880||!['image/png','image/jpeg','image/webp'].includes(file.type)){msg('Choose a PNG, JPEG or WebP image up to 5 MB.');return;}
  const b=f.querySelector('button');b.disabled=true;try{
   const ext={'image/png':'png','image/jpeg':'jpg','image/webp':'webp'}[file.type],path=user+'/'+request.id+'/'+crypto.randomUUID()+'.'+ext;
   const out=await FG.sb.storage.from('topup-receipts').upload(path,file,{upsert:false,contentType:file.type});if(out.error)throw out.error;
   if(user!==activeUser)return;
   const r=await call('attach_topup_receipt',{p_request_id:request.id,p_payer_address:f.elements.payer.value,p_reference:f.elements.reference.value,p_object_key:path});
   if(user!==activeUser)return;checkout=r;f.reset();msg('Receipt received. Awaiting confirmation that the transfer reached our account.');await history();
  }catch(e){msg('Receipt not submitted. '+FG.say(e));}finally{b.disabled=false;}
 };
 async function load(){const run=++version;activeUser=FG.session()?.user.id||null;checkout=null;key=crypto.randomUUID();$('topup-payment').hidden=true;$('topup-history').replaceChildren();$('topup-details').replaceChildren();$('topup-proof').reset();$('topup-qr').removeAttribute('src');
  if(!activeUser){$('topup-start').hidden=true;msg('Sign in to top up your wallet.');return;}
  try{const r=await FG.sb.from('coin_packages').select('id,name,coins,price_piastres').eq('active',true).order('price_piastres');if(run!==version)return;if(r.error)throw r.error;$('topup-package').replaceChildren(...r.data.map(p=>{const o=el('option',p.name+' · '+p.coins+' coins · '+(p.price_piastres/100).toFixed(2)+' EGP');o.value=p.id;return o;}));$('topup-start').hidden=!r.data.length;msg(r.data.length?'':'Top-ups are not configured yet.');await history();}catch(e){$('topup-start').hidden=true;msg('Top-ups are not available yet. '+FG.say(e));}
 }
 FG.ready.then(()=>{if(FG.sb)load();else msg('Sign-in is unavailable.');});FG.onAuth(load);
})();
