// Wallet top-up (owner, 2026-10-26): copy our InstaPay details and your email for the transfer note, pay, then confirm
// with the date, the amount and the InstaPay address you paid from. No receipt image. The owner checks the money in
// their own app and credits the Cotton Plants (supabase/migrations/20261026100000_instapay_details_checkout.sql).
(function(){
 'use strict';
 const FG=window.FG,$=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
 let user=null,version=0,quoteRun=0,quote=null,pay=null,existing=null,key=crypto.randomUUID(),timer=null,amountTimer=null,pollBusy=false,sendBusy=false,historyLimit=50,refreshRun=0,proposalSignature='';
 const msg=s=>{$('topup-status').textContent=s;},count=n=>Number(n).toLocaleString('en-US'),egp=n=>{const v=Number(n)/100;return(Number.isInteger(v)?v.toLocaleString('en-US'):v.toFixed(2))+' EGP';};
 async function rpc(name,args={}){const r=await FG.sb.rpc(name,args);if(r.error)throw r.error;return r.data;}
 const error=e=>String(e?.message||'Could not complete this request. Please retry or contact support.');
 const today=()=>{const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate());};
 const form=$('topup-confirm');
 // Keep failed submissions visible next to the button, not only in the wallet panel above.
 const formError=el('p');formError.id='topup-form-error';formError.className='wal-st wal-rejected';formError.setAttribute('role','alert');
 const clearFormError=()=>{formError.remove();form.elements.payer.removeAttribute('aria-invalid');form.elements.payer.removeAttribute('aria-describedby');};
 const formMsg=s=>{formError.textContent=s;$('topup-send').before(formError);msg(s);};

 /* ---------- step 1: what to copy ---------- */
 function copyRow(label,value,key){const dt=el('dt',label),dd=el('dd',value||'Not set yet');dd.dir='auto';if(value){const b=el('button','Copy');b.type='button';b.className='btn ghost';b.setAttribute('aria-label','Copy '+label.toLowerCase());b.onclick=async()=>{try{await navigator.clipboard.writeText(String(value));msg(label+' copied.');}catch{msg('Copy this: '+value);}};dd.append(b);}if(key){dt.className='wal-key';dd.className='wal-key';}$('topup-details').append(dt,dd);}
 function showPay(){if(!pay)return;existing=null;clearFormError();$('topup-details').replaceChildren();
  copyRow('InstaPay address',pay.instapay_address);copyRow('Receiver name',pay.recipient_name);copyRow('Transfer note: your email',pay.note_email,true);
  $('topup-rate').textContent='1 EGP = '+pay.coins_per_egp+' coins. Send from '+pay.minimum_egp+(pay.maximum_egp==null?'':' to '+Number(pay.maximum_egp).toLocaleString('en-US'))+' EGP. '+(pay.tiers||[]).map(t=>t.bonus_percent+'% bonus from '+t.minimum_egp+' EGP').join('; ')+((pay.tiers||[]).length?'.':'');
  $('topup-pay').hidden=false;form.hidden=true;}

 /* ---------- step 2: confirm the payment ---------- */
 function showConfirm(request=null){clearFormError();existing=request;key=request?request.request_key:crypto.randomUUID();quote=null;form.reset();
  form.elements.date.value=today();form.elements.date.max=today();
  const a=$('topup-amount');a.readOnly=!!request;if(pay){a.min=pay.minimum_egp;if(pay.maximum_egp==null)a.removeAttribute('max');else a.max=pay.maximum_egp;}
  $('topup-for').textContent=request?'For the top-up you opened on '+String(request.created_at||'').slice(0,10)+'.':'';
  if(request){a.value=String((request.original_amount_piastres||request.price_piastres)/100);$('topup-quote').textContent='You receive '+count(request.coins)+' coins.';}
  else $('topup-quote').textContent='Enter the amount to see your Cotton Plants.';
  $('topup-send').disabled=!request;$('topup-pay').hidden=true;form.hidden=false;form.elements.date.focus();}
 async function price(){const run=++quoteRun,uid=user;quote=null;$('topup-send').disabled=true;const amount=Number($('topup-amount').value);if(!Number.isSafeInteger(amount)||amount<1){$('topup-quote').textContent='Enter a whole EGP amount.';return;}if(amount*100>2147483647){$('topup-quote').textContent='This amount is too large to process online. Contact support.';return;}
  try{const r=await rpc('quote_topup_amount',{p_amount_piastres:amount*100});if(run!==quoteRun||uid!==user||Number($('topup-amount').value)*100!==r.amount_piastres)return;quote=r;$('topup-quote').textContent='You receive '+count(r.coins)+' Cotton Plants'+(r.bonus_coins?' ('+count(r.base_coins)+' + '+count(r.bonus_coins)+' bonus)':'')+'.';$('topup-send').disabled=!r.enabled;}
  catch(e){if(run===quoteRun)$('topup-quote').textContent=error(e);}}
 $('topup-amount').oninput=()=>{clearFormError();if(existing)return;quoteRun++;key=crypto.randomUUID();quote=null;$('topup-send').disabled=true;clearTimeout(amountTimer);amountTimer=setTimeout(price,250);};
 form.elements.payer.addEventListener('input',clearFormError);
 $('topup-sent').onclick=()=>showConfirm();
 $('topup-back').onclick=()=>{msg('');showPay();};
 form.onsubmit=async e=>{e.preventDefault();if(sendBusy||!user)return;const run=version,f=form,payer=f.elements.payer.value.trim(),requestKey=key;
  if(!existing&&(!quote||Number($('topup-amount').value)*100!==quote.amount_piastres)){formMsg('Wait for your Cotton Plants to show first.');return;}
  if(!/^[a-z0-9._+-]+@[a-z0-9.-]+$/i.test(payer)&&!/^\+?[0-9][0-9 ()-]{8,18}$/.test(payer)){form.elements.payer.setAttribute('aria-invalid','true');form.elements.payer.setAttribute('aria-describedby','topup-form-error');formMsg('Enter the InstaPay address or wallet phone number you paid from.');form.elements.payer.focus();return;}
  if(!f.elements.terms.checked){formMsg('Accept the payment terms first.');return;}
  const b=$('topup-send');sendBusy=true;b.disabled=true;
  try{const r=await rpc('submit_instapay_topup',{p_amount_piastres:existing?(existing.original_amount_piastres||existing.price_piastres):quote.amount_piastres,p_request_key:requestKey,p_accept_terms:true,p_expected_coins:existing?existing.coins:quote.coins,p_pricing_version:existing?(existing.pricing_version||0):quote.pricing_version,p_payer:payer,p_sent_on:f.elements.date.value});
   if(run!==version)return;form.reset();form.hidden=true;existing=null;key=crypto.randomUUID();$('topup-new').hidden=false;
   msg('Thank you. We’ll add '+count(r.coins)+' Cotton Plants once your '+egp(r.price_piastres)+' shows in our account, usually within one working day.');$('topup-status').scrollIntoView?.({block:'center'});await refresh();}
  catch(e){if(run===version){formMsg(error(e));if(/quote changed/i.test(error(e)))await price();}}
  finally{sendBusy=false;b.disabled=!existing&&!quote;}};
 $('topup-new').onclick=()=>{msg('');$('topup-new').hidden=true;showPay();};

 /* ---------- revised offers from the owner ---------- */
 async function offers(rows){const pending=rows.filter(r=>r.status==='pending').map(r=>r.id);if(!pending.length){$('topup-adjustments')?.replaceChildren();proposalSignature='';return;}
  const run=version,res=await FG.sb.from('topup_adjustments').select('*').in('request_id',pending).eq('status','pending').order('created_at',{ascending:false});if(run!==version)return;if(res.error)throw res.error;
  const signature=JSON.stringify(res.data);if(signature===proposalSignature)return;proposalSignature=signature;const box=$('topup-adjustments');box.replaceChildren();
  for(const p of res.data){const a=el('article');a.className='panel';a.append(el('h3','A revised amount for your payment'),el('p','You sent a different amount than you confirmed. Original: '+count(p.original_coins)+' Cotton Plants for '+egp(p.original_piastres)+'. Revised: '+count(p.proposed_coins)+' Cotton Plants for '+egp(p.proposed_piastres)+'.'),el('p',p.note));const status=el('p');status.setAttribute('role','status');
   for(const [label,choice]of[['Accept',true],['Decline',false]]){const b=el('button',label);b.type='button';b.className=choice?'btn':'btn ghost';b.onclick=async()=>{b.disabled=true;try{await rpc('accept_topup_adjustment',{p_adjustment_id:p.id,p_accept:choice});if(run!==version)return;await refresh();msg(choice?'Accepted. We add your Cotton Plants once we confirm the payment.':'Declined. Write to hello@lightningeg.com and we’ll sort it out.');}catch(e){status.textContent=error(e);}finally{b.disabled=false;}};a.append(b);}
   a.append(status);box.append(a);}}

 /* ---------- your top-ups ---------- */
 async function refresh(){if(!user)return;const run=version,requestRun=++refreshRun,uid=user;
  const [hist,wallet]=await Promise.all([FG.sb.from('topup_requests').select('*').eq('user_id',uid).order('created_at',{ascending:false}).limit(historyLimit),FG.sb.from('wallets').select('balance').eq('user_id',uid).maybeSingle()]);
  if(run!==version||requestRun!==refreshRun)return;if(hist.error)throw hist.error;if(wallet.error)throw wallet.error;
  const rows=[...hist.data].sort((a,b)=>Number(b.status==='pending')-Number(a.status==='pending')||String(b.created_at||'').localeCompare(String(a.created_at||'')));
  $('topup-history-more').hidden=hist.data.length<historyLimit;$('topup-balance').textContent=count(wallet.data?.balance??0);$('topup-history').replaceChildren();if(!rows.length)$('topup-history').append(el('p','No top-ups yet.'));
  for(const r of rows){const p=el('p');p.className='wal-row';const sent=r.details_submitted_at||r.receipt_object_key;
   const st=el('span',{pending:sent?'Being checked':'Waiting for your details',approved:'Credited',rejected:'Rejected',cancelled:'Cancelled'}[r.status]||r.status);st.className='wal-st wal-'+String(r.status).replace(/[^a-z]/g,'');
   p.append(el('b',count(r.coins)+' Cotton Plants'),el('span',egp(r.price_piastres)),st);if(r.member_sent_on)p.append(el('span','paid '+r.member_sent_on));if(r.review_note&&r.status!=='pending')p.append(el('span',r.review_note));
   if(r.status==='pending'&&!sent){const b=el('button','I’ve paid');b.type='button';b.className='btn ghost';b.onclick=()=>showConfirm(r);p.append(b);
    const c=el('button','Cancel');c.type='button';c.className='btn ghost';c.onclick=async()=>{if(!window.confirm('Cancel only if you have not sent money.'))return;c.disabled=true;try{await rpc('cancel_topup',{p_request_id:r.id});if(run!==version)return;await refresh();}catch(e){msg(error(e));}finally{c.disabled=false;}};p.append(c);}
   $('topup-history').append(p);}
  await offers(rows);
 }
 $('topup-history-more').onclick=()=>{historyLimit+=50;refresh().catch(e=>msg(error(e)));};
 $('topup-refresh').onclick=()=>refresh().catch(e=>msg(error(e)));

 async function load(){clearFormError();const run=++version;user=FG.session()?.user.id||null;historyLimit=50;quoteRun++;quote=null;pay=null;existing=null;key=crypto.randomUUID();
  form.reset();form.hidden=true;$('topup-pay').hidden=true;$('topup-details').replaceChildren();$('topup-history').replaceChildren();$('topup-adjustments')?.replaceChildren();proposalSignature='';$('topup-balance').textContent='—';$('topup-processing').textContent='';$('topup-new').hidden=true;$('topup-history-more').hidden=true;clearInterval(timer);msg('');
  if(!user){msg('Sign in to top up your wallet. ');const a=el('a','Sign in or create an account');a.href='account.html?next=topup.html';$('topup-status').append(a);return;}
  try{const [, details]=await Promise.all([refresh(),rpc('topup_payment_details')]);if(run!==version)return;
   if(!details?.enabled){msg('New payments are closed for now. Your top-ups and wallet stay available.');}
   else{pay=details;showPay();}
   timer=setInterval(async()=>{if(document.hidden||pollBusy||!user)return;pollBusy=true;try{await refresh();}catch{/* Refresh shows an error when asked. */}finally{pollBusy=false;}},20000);}
  catch(e){if(run===version)msg(error(e));}}
 FG.ready.then(()=>{if(FG.sb)load();else msg('Sign-in is unavailable.');});FG.onAuth(load);
})();
