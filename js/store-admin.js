(function(){
 'use strict';
 const FG=window.FG,$=id=>document.getElementById(id),el=(tag,text)=>{const e=document.createElement(tag);if(text!=null)e.textContent=text;return e;};
 let generation=0,uid=null,asset=null,bankOffset=0,requestOffset=0,socialOffset=0,bankRun=0,requestRun=0,socialRun=0,unlockRun=0;
 const say=(id,text)=>{$(id).textContent=text;};
 const egp=n=>{const v=Number(n)/100;return(Number.isInteger(v)?v.toLocaleString('en-US'):v.toFixed(2))+' EGP';};
 const when=ts=>{const d=new Date(ts),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+' '+z(d.getHours())+':'+z(d.getMinutes());};
 function cents(text){if(!/^\d+(\.\d{1,2})?$/.test(String(text)))throw Error('Enter an EGP amount with up to two decimal places.');const [w,f='']=String(text).split('.');const n=Number(w)*100+Number(f.padEnd(2,'0'));if(!Number.isSafeInteger(n)||n<1||n>2147483647)throw Error('Invalid EGP amount.');return n;}
 async function rpc(name,args={}){const r=await FG.sb.rpc(name,args);if(r.error)throw r.error;return r.data;}
 function message(error){return /MFA|session/i.test(error?.message||'')?FG.say(error):String(error?.message||'Could not complete this action.');}
 function action(text,fn,status){const b=el('button',text);b.type='button';b.className='btn ghost';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){status.textContent=message(e);}finally{b.disabled=false;}};return b;}
 function input(label,type='text',value=''){const i=el('input');i.type=type;i.value=value;i.setAttribute('aria-label',label);const l=el('label',label);l.append(i);return {label:l,input:i};}
 function check(label){const c=input(label,'checkbox');c.input.checked=false;c.label.className='chk';c.label.prepend(c.input);return c;}
 function details(title){const d=el('details');d.append(el('summary',title));return d;}
 async function overview(expectedUnlock=null){const run=generation;const s=await rpc('admin_store_overview');if(run!==generation||(expectedUnlock!==null&&expectedUnlock!==unlockRun))return;$('store-overview').replaceChildren();
  // the header's status chips: is the store taking money, and do the books agree (owner console, 2026-10-26)
  for(const [text,tone]of[[s.payments_enabled?'Checkout open':'Checkout closed',s.payments_enabled?'good':'bad'],[s.wallet_mismatches?s.wallet_mismatches+' ledger mismatch'+(s.wallet_mismatches===1?'':'es'):'Ledger balanced',s.wallet_mismatches?'bad':'good'],['Verified owner','']]){const c=el('span',text);c.className='oc-chip '+tone;$('store-overview').append(c);}
  window.dispatchEvent(new CustomEvent('lightning:owner-changed',{detail:s})); // the Today view (js/owner-dashboard.js) refreshes
 }
 async function settings(){const run=generation;const [cfg,pricing,tiers]=await Promise.all([FG.sb.from('payment_settings').select('*').eq('id',1).single(),FG.sb.from('coin_pricing').select('*').eq('id',1).single(),FG.sb.from('coin_bonus_tiers').select('*').order('minimum_egp')]);if(run!==generation)return;for(const r of[cfg,pricing,tiers])if(r.error)throw r.error;
  const f=$('store-settings'),p=$('store-pricing'),c=cfg.data,r=pricing.data;asset=c.qr_asset_id;f.elements.address.value=c.instapay_address||'';f.elements.recipient.value=c.recipient_name||'';f.elements.processing.value=c.processing_message;f.elements.enabled.checked=c.enabled;say('store-qr-status',asset?'A private checkout QR is configured.':'Upload the receiving QR before opening checkout.');
  p.elements.rate.value=r.coins_per_egp;p.elements.minimum.value=r.minimum_egp;p.elements.maximum.value=r.maximum_egp;p.elements.enabled.checked=r.enabled;p.elements.tiers.value=tiers.data.map(t=>t.minimum_egp+':'+t.bonus_percent).join('\n');example();
 }
 // What a member gets, worked out live while the owner types: one top-up at each bonus step.
 function example(){const p=$('store-pricing'),out=$('store-pricing-example');if(!p||!out)return;const rate=Number(p.elements.rate.value)||0,steps=p.elements.tiers.value.split(/\n/).map(x=>x.match(/^\s*(\d+)\s*:\s*(\d+)\s*$/)).filter(Boolean).map(m=>[Number(m[1]),Number(m[2])]).sort((a,b)=>a[0]-b[0]);
  const coins=egp=>{let bonus=0;for(const [min,pc]of steps)if(egp>=min)bonus=pc;return Math.floor(egp*rate*(100+bonus)/100);};
  const amounts=[...new Set([Number(p.elements.minimum.value)||0,...steps.map(x=>x[0])])].filter(n=>n>0).slice(0,4);
  out.textContent=rate?'A member gets '+amounts.map(a=>coins(a).toLocaleString('en-US')+' coins for '+a.toLocaleString('en-US')+' EGP').join(' · ')+'.':'';}
 for(const n of['rate','minimum','tiers'])$('store-pricing').elements[n].addEventListener('input',example);
 async function bank(append=false){if(!append)bankOffset=0;const run=generation,view=++bankRun;let q=FG.sb.from('bank_transfers').select('*').order('received_at',{ascending:false});if($('store-bank-filter').value==='unmatched')q=q.is('request_id',null).eq('voided',false).is('returned_at',null);const r=await q.range(bankOffset,bankOffset+24);if(run!==generation||view!==bankRun)return;if(r.error)throw r.error;if(!append)$('store-bank-list').replaceChildren();
  if(!append&&!r.data.length)$('store-bank-list').append(el('p','No transfers in this view.'));
  for(const t of r.data){const c=el('article');c.className='ops-record';c.append(el('h3',t.reference+' · '+egp(t.amount_piastres)),el('p',new Date(t.received_at).toLocaleString()+' · '+(t.returned_at?'Returned':t.credit_entry_id?'Credited':t.voided?'Voided':t.request_id?'Matched, uncredited':'Unmatched')),el('p',(t.request_id||'No request assigned')+' · '+(t.email_note||'No email note')+' · '+(t.sender_address||'No sender recorded')));
   if(!t.credit_entry_id&&!t.returned_at){const d=details('Match or correct this uncredited transfer'),amount=input('Actual EGP amount','number',(t.amount_piastres/100).toFixed(2)),request=input('Request ID, or leave empty to unmatch','text',t.request_id||''),note=input('Correction reason'),voided=check('Void an incorrect entry; the reference stays in the audit history');amount.input.step='.01';voided.input.checked=t.voided;const status=el('p');status.setAttribute('role','status');d.append(amount.label,request.label,note.label,voided.label,action('Save journal correction',async()=>{await rpc('admin_correct_bank_transfer',{p_reference:t.reference,p_amount_piastres:cents(amount.input.value),p_request_id:request.input.value.trim()||null,p_voided:voided.input.checked,p_note:note.input.value});await Promise.all([bank(),requests(),overview()]);},status),status);c.append(d);}const alias=details('Correct a mistyped bank reference without changing history'),actual=input('Actual bank reference'),aliasReason=input('Reference correction reason'),verified=check('I checked this actual reference in the receiving bank account.'),aliasStatus=el('p');alias.append(el('p','The original reference remains in the journal. The corrected reference is reserved too, so the same money cannot be credited again.'),actual.label,aliasReason.label,verified.label,action('Reserve corrected reference',async()=>{await rpc('admin_add_bank_reference_alias',{p_reference:t.reference,p_alias:actual.input.value,p_kind:'incoming',p_note:aliasReason.input.value,p_confirmed:verified.input.checked});aliasStatus.textContent='Corrected reference linked and protected from reuse.';},aliasStatus),aliasStatus);c.append(alias);if(!t.request_id&&!t.voided&&!t.credit_entry_id&&!t.returned_at){const d=details('Record a completed return of unmatched funds'),ref=input('Outgoing return reference'),note=input('Reason for returning unmatched funds'),confirmed=check('I already returned this full incoming amount outside the website.'),status=el('p');d.append(ref.label,note.label,confirmed.label,action('Record completed unmatched return',async()=>{await rpc('admin_record_unmatched_payment_return',{p_incoming_reference:t.reference,p_outgoing_reference:ref.input.value,p_note:note.input.value,p_confirmed:confirmed.input.checked});await Promise.all([bank(),overview()]);},status),status);c.append(d);}if(t.return_reference)c.append(el('p','Outgoing return: '+t.return_reference));$('store-bank-list').append(c);
  }bankOffset+=r.data.length;$('store-bank-more').hidden=r.data.length<25;
 }
 // Top-ups on one screen (owner, 2026-10-26: "For my own reconciliation, just make it better. I want to do it on one
// screen"). Every open ticket is one row, oldest first: what to look for in your InstaPay or bank app (amount, sender,
// date, the email in the note), then one button. Money already in the journal that looks like it comes first, so the
// same transfer is never recorded twice; the amount field starts at what is still owed. Less used actions sit under
// "More". The server records the money and credits only when what is on the ticket equals the quote.
 const STATUS={pending:'Open',approved:'Credited',rejected:'Rejected',cancelled:'Cancelled'};
 const count=n=>Number(n).toLocaleString('en-US');
 // Search by the member's email, the sender (InstaPay address or wallet phone, written any common way) or the amount.
 function searchFilter(q,text){const raw=String(text||'').trim().toLowerCase();if(!raw)return q;
  if(/^\d{1,6}(\.\d{1,2})?$/.test(raw))return q.eq('price_piastres',cents(raw));
  let digits=raw.replace(/[^0-9]/g,'');if(!/[a-z@]/.test(raw)&&digits.length>=10){if(/^0020\d{10}$/.test(digits))digits='0'+digits.slice(4);else if(/^20\d{10}$/.test(digits))digits='0'+digits.slice(2);else if(/^1\d{9}$/.test(digits))digits='0'+digits;return q.ilike('payer_instapay_address','%'+digits+'%');}
  const term=raw.replace(/[^a-z0-9@._+-]/g,'');if(!term)return q;return q.or('transfer_note_email.ilike.%'+term+'%,payer_instapay_address.ilike.%'+term+'%');}
 const ready=row=>row.status==='pending'&&!!(row.receipt_object_key||row.details_submitted_at);
 async function requests(append=false){if(!append)requestOffset=0;const run=generation,view=++requestRun,open=$('store-request-filter').value==='pending';let q=FG.sb.from('topup_requests').select('*').eq('status',$('store-request-filter').value).order('created_at',{ascending:open});try{q=searchFilter(q,$('store-request-search').value);}catch(e){say('store-request-status',message(e));return;}const r=await q.range(requestOffset,requestOffset+14);if(run!==generation||view!==requestRun)return;if(r.error)throw r.error;if(!append){$('store-request-list').replaceChildren();say('store-request-status','');}
  if(!append&&!r.data.length)$('store-request-list').append(el('p',$('store-request-search').value.trim()?'No top-ups match that search.':open?'Nothing to confirm. New tickets show here, oldest first.':'No top-ups in this view.'));
  let ul=$('store-request-list').querySelector('ul');if(!ul&&r.data.length){ul=el('ul');ul.className='ops-recs';$('store-request-list').append(ul);}
  // tickets the member has confirmed come first; ones still waiting for their details follow, quieter
  const rows=open?[...r.data.filter(ready),...r.data.filter(x=>!ready(x))]:r.data;
  for(const row of rows)ul.append(ticket(row,run));
  requestOffset+=r.data.length;$('store-request-more').hidden=r.data.length<15;
 }
 let searchTimer=null;$('store-request-search').addEventListener('input',()=>{clearTimeout(searchTimer);searchTimer=setTimeout(()=>requests().catch(e=>say('store-overview-status',message(e))),300);});
 async function settled(row,text,mail){await Promise.all([requests(),overview()]);say('store-request-status',text||'Credited '+count(row.coins)+' coins to '+(row.transfer_note_email||'the member')+'.');if(mail)$('store-request-status').append(' ',mail);}
 function localNow(){const d=new Date(),z=n=>String(n).padStart(2,'0');return d.getFullYear()+'-'+z(d.getMonth()+1)+'-'+z(d.getDate())+'T'+z(d.getHours())+':'+z(d.getMinutes());}
 function waited(ts){if(!ts)return '';const h=Math.max(0,(Date.now()-new Date(ts).getTime())/36e5);return h<1?'under 1 h':h<48?Math.round(h)+' h':Math.round(h/24)+' days';}
 // one key per payment typed on a ticket: Record pressed twice after a dropped connection records it once
 const entryKey=()=>window.crypto?.randomUUID?window.crypto.randomUUID():'10000000-1000-4000-8000-100000000000'.replace(/[018]/g,c=>(c^Math.random()*16>>c/4).toString(16));
 const isOwn=ref=>/^TKT-/.test(String(ref||''));
 const paidLines=on=>on.filter(t=>!t.returned).map(t=>'- '+egp(t.amount_piastres)+', arrived '+when(t.received_at)).join('\n');
 // The email that closes a ticket (owner, 2026-10-26: "send a message to the user that this is it, I will do so
 // through email"): a draft in the owner's own mail app. The site sends nothing; the member also reads the message in
 // their wallet history.
 function mailLink(row,body){const to=String(row.transfer_note_email||'').replace(/[?&#\s]/g,'');if(!to)return null;const a=el('a','Email '+to);a.className='ops-mail';a.dir='auto';
  a.href='mailto:'+to+'?subject='+encodeURIComponent('Your Lightning top-up')+'&body='+encodeURIComponent('Hello,\n\n'+body.trim()+'\n\nLightning\nhello@lightningeg.com');return a;}
 function closedNote(row){if(row.status==='approved')return 'Your top-up is done: '+count(row.coins)+' coins for '+egp(row.price_piastres)+' are in your Lightning wallet.'+(row.original_amount_piastres&&row.original_amount_piastres!==row.price_piastres&&row.review_note?'\n\n'+row.review_note:'');
  return 'Your top-up of '+egp(row.price_piastres)+' is closed and no coins were added.'+(row.review_note?'\n\n'+row.review_note:'');}
 // The money side of a ticket (admin_ticket_money): every payment on it, when it arrived and when you recorded it, the
 // total against the quote, and unmatched money in the journal that looks like it (admin_attach_transfer). Reconciling
 // happens here, not in a second place.
 function ticketMoney(row,run,status,{seen=()=>true,onMoney=()=>{},readOnly=false,always=false}={}){
  const box=el('section');box.className='ops-money';box.setAttribute('aria-label','Money for this ticket');
  const load=async()=>{const r=(await rpc('admin_ticket_money',{p_request_id:row.id}))||{};if(run!==generation)return;box.replaceChildren();
   const on=r.on_ticket||[],cand=readOnly?[]:r.candidates||[],quote=Number(r.quote_piastres??row.price_piastres);
   const line=(t,extra)=>{const li=el('li');const main=el('span',egp(t.amount_piastres));
    const sub=el('small',['Arrived '+when(t.received_at),t.sender&&'from '+t.sender,isOwn(t.reference)?'no reference':'ref '+t.reference,extra].filter(Boolean).join(' · '));sub.dir='auto';main.append(sub);
    if(t.recorded_at)main.append(el('small','Recorded '+when(t.recorded_at)));li.append(main);return li;};
   const got=on.filter(t=>!t.returned).reduce((a,t)=>a+Number(t.amount_piastres),0),open=on.filter(t=>!t.credited&&!t.returned).reduce((a,t)=>a+Number(t.amount_piastres),0),d=got-quote;
   if(on.length||always){const tally=el('div');tally.className='ops-tally';
    tally.append(el('h4',on.length?'Received '+egp(got)+' of '+egp(quote):'Nothing recorded yet'));
    if(on.length&&!readOnly){const chip=el('span',d===0?'Paid in full':d<0?egp(-d)+' to go':egp(d)+' over');chip.className='ops-chip '+(d===0?'good':d<0?'':'bad');tally.append(chip);}
    const bar=el('div');bar.className='ops-bar';bar.setAttribute('aria-hidden','true');const fill=el('i');fill.style.width=Math.min(100,quote?got*100/quote:0)+'%';if(d>0)bar.classList.add('over');bar.append(fill);tally.append(bar);box.append(tally);}
   if(on.length){const ul=el('ul');on.forEach(t=>{const li=line(t,t.returned?'sent back':t.credited?'credited':'');
     // a payment you typed is voided; money from the journal goes back to it, unmatched
     if(!readOnly&&!t.credited&&!t.returned)li.append(action('Remove',async()=>{await rpc('admin_correct_bank_transfer',{p_reference:t.reference,p_amount_piastres:t.amount_piastres,p_request_id:isOwn(t.reference)?row.id:null,p_voided:isOwn(t.reference),p_note:'Taken off ticket '+String(row.id).slice(0,8)+' on the owner dashboard'});status.textContent='Removed '+egp(t.amount_piastres)+' from this ticket.';await load();},status));ul.append(li);});box.append(ul);}
   let completes=false;
   if(cand.length){box.append(el('h4','In your money journal: is it this payment?'));const ul=el('ul');cand.forEach(t=>{const li=line(t,(t.why||[]).join(', ')),fits=Number(t.amount_piastres)===quote-open;completes=completes||fits;
     const use=action(fits?'Use it · credit '+count(row.coins)+' coins':'Use for this ticket',async()=>{if(row.receipt_object_key&&!seen())throw Error('Show the receipt first.');const res=await rpc('admin_attach_transfer',{p_request_id:row.id,p_reference:t.reference,p_note:null,p_receipt_key:row.receipt_object_key,p_receipt_revision:row.receipt_revision});if(run!==generation)return;
      if(res.status==='approved'){await settled(row,null,mailLink(row,closedNote({...row,...res.request,status:'approved'})));return;}
      await load();status.textContent=res.status==='waiting_receipt'?'The money matches. It credits once the member uploads the receipt.':'Now '+egp(res.received_piastres)+' of '+egp(res.quote_piastres)+'. Nothing was credited yet.';},status);if(fits)use.className='btn';li.append(use);ul.append(li);});box.append(ul);}
   box.hidden=!on.length&&!cand.length&&!always;onMoney({on,got,open,quote,completes});};
  box.hidden=!always;box.reload=()=>load().catch(e=>{if(run===generation){box.hidden=false;box.replaceChildren(el('p','The money for this ticket did not load: '+message(e)));}});box.reload();
  return box;
 }
 function textarea(label,value=''){const t=el('textarea');t.value=value;t.rows=3;t.maxLength=500;t.setAttribute('aria-label',label);const l=el('label',label);l.append(t);return {label:l,input:t};}
 // Use cases, and the one click for each (owner, 2026-10-26: "think where I would click in each case"):
 //  - all of it arrived: the amount is already filled in, add the reference, "Record · credit N coins";
 //  - it is already in the money journal: "Use it · credit N coins" on that line;
 //  - part arrived and more is coming: "Record 15,000 EGP", the payment is listed with when it arrived and when you
 //    recorded it, and the field starts at what is still to go for the next one;
 //  - part arrived and that is all: Close the ticket › Credit what arrived (coins at the quote's rate, a message);
 //  - more arrived than quoted: the same, or I sent the money back;
 //  - nothing arrived: Close the ticket › Reject, with a message;
 //  - a payment was typed wrong: Remove on its line, then record it again.
 // Every close ends with "Email <member>": a draft with the message and the payments.
 function ticket(row,run){
  const li=el('li');li.className='ops-rec';li.dataset.status=row.status;
  const open=row.status==='pending',isReady=ready(row);
  const head=el('div');head.className='ops-rec-head';
  const who=el('b',(row.transfer_note_email||'Deleted account')+' · '+egp(row.price_piastres)+' · '+count(row.coins)+' coins');who.dir='auto';head.append(who);
  // in the Open list every row is open: the chip says what differs, how long it has waited or that it is not paid yet
  const st=el('span',!open?STATUS[row.status]||row.status:isReady?waited(row.details_submitted_at||row.receipt_uploaded_at||row.created_at)+' waiting':'Waiting for details');st.className='ops-st ops-st-'+(open&&!isReady?'idle':row.status);if(open&&isReady)st.title='Since the member confirmed paying';head.append(st);
  const said=el('small',!open?[row.payer_instapay_address&&'from '+row.payer_instapay_address,row.payment_reference&&!isOwn(row.payment_reference)&&row.payment_reference,row.reviewed_at&&'closed '+when(row.reviewed_at),row.review_note].filter(Boolean).join(' · '):row.details_submitted_at?'Look for '+egp(row.original_amount_piastres||row.price_piastres)+' from '+(row.payer_instapay_address||'?')+(row.member_sent_on?', sent '+row.member_sent_on:'')+(row.transfer_note_email?', note '+row.transfer_note_email:''):row.receipt_object_key?'Receipt uploaded'+(row.payer_instapay_address?', paid from '+row.payer_instapay_address:''):'Opened '+(row.created_at?when(row.created_at):'')+'; has not confirmed paying yet');said.dir='auto';
  li.append(head,said);
  const status=el('p');status.className='ops-ticket-status';status.setAttribute('role','status');
  if(!open){
   // a closed ticket: its payments on demand, the email that tells the member, and reopening
   const pays=details('Payments');let loaded=false;pays.addEventListener('toggle',()=>{if(pays.open&&!loaded){loaded=true;pays.append(ticketMoney(row,run,status,{readOnly:true,always:true}));}});li.append(pays);
   if(row.status!=='cancelled'){const mail=mailLink(row,closedNote(row));if(mail)li.append(mail);}
   if(['cancelled','rejected'].includes(row.status)&&row.user_id){const d=details('Reopen: the member paid after all'),reason=input('Why you are reopening it');d.append(reason.label,action('Reopen ticket',async()=>{await rpc('admin_reopen_topup',{p_request_id:row.id,p_note:reason.input.value});await settled(row,'Reopened. Find it under Open.');},status));li.append(d);}
   li.append(status);return li;}
  if(!isReady){li.classList.add('ops-rec-idle');li.append(ticketMoney(row,run,status),status);return li;}
  // the receipt, only for tickets opened before receipts were dropped
  let viewed=!row.receipt_object_key,money={on:[],got:0,open:0,quote:row.price_piastres},touched=false,entry=entryKey();const shot=el('div');shot.className='ops-receipt';
  const show=action('Show receipt',async()=>{const image=await FG.sb.storage.from('topup-receipts').createSignedUrl(row.receipt_object_key,300);if(run!==generation)return;if(image.error)throw image.error;const img=el('img');img.alt='Member payment receipt';img.referrerPolicy='no-referrer';img.onload=()=>{viewed=true;};img.onerror=()=>{viewed=false;shot.replaceChildren(show);status.textContent='The receipt did not load. Show it again before confirming.';};img.src=image.data.signedUrl;shot.replaceChildren(img);},status);
  // ---- record a payment
  const record=el('div');record.className='ops-step';record.append(el('h4','Record a payment'));
  const amount=input('Amount (EGP)','number',String(row.price_piastres/100)),ref=input('Reference (optional)'),at=input('When it arrived','datetime-local',localNow()),from=input('Sent from','text',row.payer_instapay_address||'');
  amount.input.step='0.01';amount.input.min='0.01';ref.input.maxLength=100;ref.input.autocomplete='off';at.input.max=localNow();from.input.maxLength=200;
  const doRow=el('div');doRow.className='ops-rec-do';const compare=el('p');compare.className='ops-compare';compare.setAttribute('aria-live','polite');
  let ok=null;
  const draw=()=>{compare.replaceChildren();let typed;try{typed=cents(amount.input.value);}catch{compare.append(el('span','Type the amount that arrived.'));ok.textContent='Record payment';return;}
   const b=money.open,total=b+typed,d=total-row.price_piastres;
   ok.textContent=d===0?'Record · credit '+count(row.coins)+' coins':'Record '+egp(typed);
   // a match needs no words (the button says it); anything else says what happens
   if(d===0&&!b)return;
   const chip=el('span',d===0?'Completes it':d<0?egp(-d)+' to go after this':egp(d)+' over');chip.className='ops-chip '+(d===0?'good':d<0?'':'bad');
   compare.append(chip,el('span',' '+(b?egp(b)+' recorded + '+egp(typed)+' = '+egp(total):egp(total))+' of '+egp(row.price_piastres)+(d===0?'. Credits '+count(row.coins)+' coins.':d<0?'. Credits nothing yet.':'. Credits nothing: close it for what arrived, or send the extra back.')));};
  amount.input.addEventListener('input',()=>{touched=true;draw();});
  ok=action('Record payment',async()=>{if(!viewed)throw Error('Show the receipt first.');if(!at.input.value)throw Error('Enter when the money arrived.');const value=cents(amount.input.value),arrived=new Date(at.input.value);
   const res=await rpc('admin_record_ticket_payment',{p_request_id:row.id,p_amount_piastres:value,p_received_at:arrived.toISOString(),p_sender:from.input.value,p_reference:ref.input.value.trim()||null,p_entry_key:entry,p_receipt_key:row.receipt_object_key||null,p_receipt_revision:row.receipt_revision});if(run!==generation)return;
   entry=entryKey();
   if(res.status==='approved'){await settled(row,null,mailLink(row,closedNote({...row,...res.request,status:'approved'})));return;}
   const left=Number(res.quote_piastres)-Number(res.received_piastres);
   status.textContent='Recorded '+egp(value)+', arrived '+when(arrived)+'. '+(left>0?egp(left)+' still to go; nothing credited yet.':egp(-left)+' more than the quote; nothing credited. Close it below.');
   ref.input.value='';touched=false;box.reload();},status);ok.className='btn';
  const other=el('button','A different transfer? Type what arrived');other.type='button';other.className='ops-link';other.hidden=true;other.onclick=()=>{doRow.hidden=false;compare.hidden=false;other.hidden=true;amount.input.focus();};
  doRow.append(amount.label,at.label,from.label,ref.label,ok);record.append(other,doRow,compare);
  // ---- close the ticket: credit what arrived, send it back, or reject
  const close=el('div');close.className='ops-step ops-close';close.append(el('h4','Close the ticket'));
  const choices=el('div');choices.className='ops-choices';choices.setAttribute('role','group');choices.setAttribute('aria-label','Close the ticket');const panes=[];close.append(choices);
  const choice=label=>{const b=el('button',label);b.type='button';b.className='ops-choice';b.setAttribute('aria-pressed','false');const pane=el('div');pane.className='ops-pane';pane.hidden=true;
   b.onclick=()=>{const show=pane.hidden;panes.forEach(x=>{x.b.setAttribute('aria-pressed','false');x.pane.hidden=true;});if(show){b.setAttribute('aria-pressed','true');pane.hidden=false;}};const c={b,pane};panes.push(c);choices.append(b);close.append(pane);return c;};
  const part=choice('Credit what arrived'),back=choice('I sent the money back'),no=choice('Reject');
  // credit what arrived: coins at the quote's rate, a message the member reads; closes at once, no acceptance needed
  const coins=input('Coins to credit','number'),partMsg=textarea('Message to the member');coins.input.min='1';coins.input.max='1000000';coins.label.className='ops-narrow';let coinsEdited=false,partEdited=false;
  const partText=()=>'We received '+egp(money.open)+(money.open===row.price_piastres?'':' of the '+egp(row.price_piastres)+' you planned to send')+' and added '+count(Number(coins.input.value)||0)+' coins to your wallet for it. This top-up is now closed.';
  const partGo=action('Close and credit',async()=>{const n=Number(coins.input.value);if(!Number.isInteger(n)||n<1)throw Error('Enter the coins to credit.');const msg=partMsg.input.value.trim();if(msg.length<5)throw Error('Write the member a short message.');
   const res=await rpc('admin_close_ticket_for_received',{p_request_id:row.id,p_coins:n,p_message:msg,p_receipt_key:row.receipt_object_key||null,p_receipt_revision:row.receipt_revision});if(run!==generation)return;
   await settled(row,'Closed. Credited '+count(n)+' coins to '+(row.transfer_note_email||'the member')+' for '+egp(res.received_piastres??money.got)+'.',mailLink(row,msg+'\n\nWhat we received:\n'+paidLines(money.on)));},status);partGo.className='btn';
  const partDraw=()=>{partGo.textContent='Close and credit '+count(Number(coins.input.value)||0)+' coins';if(!partEdited)partMsg.input.value=partText();};
  coins.input.addEventListener('input',()=>{coinsEdited=true;partDraw();});partMsg.input.addEventListener('input',()=>{partEdited=true;});
  part.pane.append(el('p','Credits the coins below for the money on this ticket and closes it. The member reads your message in their wallet history.'),coins.label,partMsg.label,partGo);
  // sent back: the money left your account outside the website; this only records it and closes the ticket
  const rref=input('Your outgoing transfer reference'),backMsg=textarea('Message to the member'),done=check('I already returned the full amount outside this website.');let backEdited=false;backMsg.input.addEventListener('input',()=>{backEdited=true;});
  const backText=()=>'We sent your '+egp(money.open)+' back'+(row.payer_instapay_address?' to '+row.payer_instapay_address:'')+'. This top-up is now closed and no coins were added.';
  back.pane.append(rref.label,backMsg.label,done.label,action('Record the return',async()=>{const msg=backMsg.input.value.trim();await rpc('admin_record_payment_return',{p_request_id:row.id,p_reference:rref.input.value,p_note:msg,p_confirmed:done.input.checked});await settled(row,'Return recorded. Nothing was credited.',mailLink(row,msg));},status));
  // reject: nothing arrived, so there is nothing to send back
  const noMsg=textarea('Message to the member','We could not find a transfer of '+egp(row.price_piastres)+(row.payer_instapay_address?' from '+row.payer_instapay_address:'')+'. If you sent it, reply with the date, the amount and the reference, and we will look again.');
  const noGo=action('Reject ticket',async()=>{const msg=noMsg.input.value.trim();if(msg.length<5)throw Error('Write the member why.');await rpc('admin_review_topup',{p_request_id:row.id,p_decision:'rejected',p_received_piastres:null,p_payment_reference:null,p_note:msg});await settled(row,'Rejected. Nothing was credited.',mailLink(row,msg));},status);
  no.pane.append(el('p','Nothing arrived. Closes the ticket without coins.'),noMsg.label,noGo);
  // ---- the money decides what shows
  const box=ticketMoney(row,run,status,{seen:()=>viewed,always:true,onMoney:m=>{money=m;
   // start the field at what is still to go, unless the owner already typed
   if(!touched){const owed=row.price_piastres-m.open;amount.input.value=owed>0?String(owed/100):'';}
   // money already in the journal pays it: that is the one button, so the same transfer is not recorded twice
   if(m.completes&&!doRow.hidden&&!touched){doRow.hidden=true;compare.hidden=true;other.hidden=false;}
   const some=m.open>0;part.b.hidden=!some;back.b.hidden=!some;no.b.hidden=some;
   panes.forEach(x=>{if(x.b.hidden){x.pane.hidden=true;x.b.setAttribute('aria-pressed','false');}});
   if(!coinsEdited)coins.input.value=String(m.open===row.price_piastres?row.coins:Math.max(1,Math.floor(row.coins*m.open/row.price_piastres)));
   if(!backEdited)backMsg.input.value=backText();
   partDraw();draw();}});
  if(row.receipt_object_key){shot.append(show);li.append(shot);}
  li.append(box,record,close,status);draw();return li;
 }
 async function social(append=false){if(!append)socialOffset=0;const run=generation,view=++socialRun;const rows=await rpc('admin_social_queue',{p_status:$('store-social-filter').value,p_offset:socialOffset});if(run!==generation||view!==socialRun)return;if(!append)$('store-social-list').replaceChildren();if(!append&&!rows.length)$('store-social-list').append(el('p','No posts in this view.'));for(const s of rows)$('store-social-list').append(window.FGStoryModeration.card(s,async()=>{await Promise.all([social(),overview()]);}));socialOffset+=rows.length;$('store-social-more').hidden=rows.length<50;}
 function verification(verified){window.dispatchEvent(new CustomEvent('lightning:owner-access',{detail:{verified}}));}
 // One owner account (owner, 2026-10-26): the console and its menu link follow admin_roles; any other account still
 // listed there is named here and removed with one click, from the account the owner keeps.
 async function owners(){const run=generation;const o=await rpc('admin_owner_accounts');if(run!==generation)return;const others=o.others||[],extra=$('owner-extra');
  say('owner-accounts-status',others.length?'Also an owner: '+others.map(x=>x.email).join(', ')+'. Each can open this console.':'This is the only owner account.');
  $('owner-keep-me').hidden=!others.length;extra.hidden=!others.length;extra.replaceChildren();
  if(others.length){const a=el('a','Keep only this one');a.href='#settings';extra.append(el('span',others.length+(others.length===1?' other account':' other accounts')+' can open this console. '),a);}
 }
 $('owner-keep-me').onclick=async()=>{const b=$('owner-keep-me');if(!window.confirm('Remove owner access from every other account? Only the account you are signed in with will open this console.'))return;b.disabled=true;try{const n=await rpc('admin_keep_only_me');await owners();say('owner-accounts-status','Done. '+n+(n===1?' account':' accounts')+' no longer open this console. This is the only owner account.');}catch(e){say('owner-accounts-status',message(e));}finally{b.disabled=false;}};
 async function unlock(){const run=generation,attempt=++unlockRun;try{await overview(attempt);if(run!==generation||attempt!==unlockRun)return;verification(true);$('store-tools').disabled=false;say('store-overview-status','Verified owner session. Every credit and decision is checked by the server.');const results=await Promise.allSettled([settings(),bank(),requests(),social(),owners()]);for(const r of results)if(r.status==='rejected')say('store-overview-status',message(r.reason));}catch(e){if(run!==generation||attempt!==unlockRun)return;$('store-tools').disabled=true;const needsMfa=/MFA|session|sign in|administrator/i.test(e?.message||'');if(needsMfa)verification(false);say('store-overview-status',needsMfa?'Verify your authenticator code above to open owner tools. '+FG.say(e):'Could not load owner tools. Use Refresh verified session to retry. '+FG.say(e));}}
 async function access(){const next=FG.session()?.user.id||null;if(next!==uid){uid=next;generation++;unlockRun++;verification(false);$('store-owner').hidden=true;$('store-tools').disabled=true;asset=null;$('store-settings').reset();$('store-pricing').reset();$('store-bank-record').reset();for(const id of['store-bank-list','store-request-list','store-social-list','store-overview'])$(id).replaceChildren();$('owner-extra').hidden=true;$('owner-keep-me').hidden=true;say('owner-accounts-status','');}const run=generation;$('store-signin').hidden=!!uid;if(!uid){say('store-access','Sign in with the owner account.');return;}try{const allowed=await rpc('is_admin');if(run!==generation)return;if(!allowed){$('store-owner').hidden=true;$('store-tools').disabled=true;asset=null;$('store-settings').reset();$('store-bank-record').reset();for(const id of['store-bank-list','store-request-list','store-social-list','store-overview'])$(id).replaceChildren();$('owner-extra').hidden=true;say('store-access','This console is only for an authorized owner.');return;}$('store-owner').hidden=false;say('store-access','Owner account recognized.');await unlock();}catch(e){say('store-access',FG.say(e));}}
 $('store-unlock').onclick=unlock;window.addEventListener('lightning:mfa-verified',unlock);
 $('store-settings').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{const file=f.elements.qr.files[0];if(file){if(!['image/png','image/jpeg','image/webp'].includes(file.type)||file.size>5242880)throw Error('Choose a PNG, JPEG or WebP up to 5 MB.');const data=await new Promise((resolve,reject)=>{const r=new FileReader();r.onload=()=>resolve(r.result);r.onerror=reject;r.readAsDataURL(file);});asset=await rpc('admin_upload_payment_qr',{p_image:String(data).split(',')[1],p_mime:file.type});}await rpc('admin_configure_checkout',{p_address:f.elements.address.value,p_name:f.elements.recipient.value,p_asset_id:asset,p_enabled:f.elements.enabled.checked,p_processing:f.elements.processing.value});say('store-settings-status','Checkout configuration saved.');await Promise.all([settings(),overview()]);}catch(e){say('store-settings-status',message(e));}finally{b.disabled=false;}};
 $('store-pricing').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;try{const tiers=f.elements.tiers.value.split(/\n/).map(s=>s.trim()).filter(Boolean).map(s=>{const m=s.match(/^(\d+)\s*:\s*(\d+)$/);if(!m)throw Error('Use one EGP:percent threshold per line.');return {minimum_egp:Number(m[1]),bonus_percent:Number(m[2])};});await rpc('admin_set_coin_pricing',{p_rate:Number(f.elements.rate.value),p_minimum_egp:Number(f.elements.minimum.value),p_maximum_egp:Number(f.elements.maximum.value),p_enabled:f.elements.enabled.checked,p_tiers:tiers});say('store-pricing-status','Pricing saved. Existing checkout quotes keep their agreed value.');await settings();}catch(e){say('store-pricing-status',message(e));}};
 $('store-bank-record').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('button');b.disabled=true;try{await rpc('admin_record_bank_transfer',{p_reference:f.elements.reference.value,p_amount_piastres:cents(f.elements.amount.value),p_received_at:new Date(f.elements.received.value).toISOString(),p_request_id:f.elements.request.value.trim()||null,p_sender_address:f.elements.sender.value,p_email_note:f.elements.email.value,p_note:f.elements.note.value,p_confirmed:f.elements.confirmed.checked});say('store-bank-status','Transfer recorded once. Match it to a request, then review the receipt before crediting.');f.reset();await Promise.all([bank(),requests(),overview()]);}catch(e){say('store-bank-status',message(e));}finally{b.disabled=false;}};
 for(const [id,fn]of[['store-bank-refresh',()=>bank()],['store-request-refresh',()=>requests()],['store-social-refresh',()=>social()],['store-bank-more',()=>bank(true)],['store-request-more',()=>requests(true)],['store-social-more',()=>social(true)]])$(id).onclick=()=>fn().catch(e=>say('store-overview-status',message(e)));
 for(const [id,fn]of[['store-bank-filter',bank],['store-request-filter',requests],['store-social-filter',social]])$(id).onchange=()=>fn().catch(e=>say('store-overview-status',message(e)));
 $('store-retention').onclick=async()=>{try{const rows=await rpc('admin_receipt_cleanup_candidates');if(!rows.length){say('store-retention-status','No expired receipt images to remove.');return;}if(!window.confirm('Permanently remove '+rows.length+' eligible receipt images older than 90 days? Pending evidence is protected.'))return;const out=await FG.sb.storage.from('topup-receipts').remove(rows.map(r=>r.object_key));if(out.error)throw out.error;say('store-retention-status','Expired files removed through Storage. Financial records were retained.');}catch(e){say('store-retention-status',message(e));}};
 FG.ready.then(access);FG.onAuth(access);
})();
