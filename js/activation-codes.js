// Owned, shipped app themes. A one-time code claims the theme's seat for ONE Lightning profile and is then burned; the
// app shares the unlock through the profile itself, so the profile's other devices unlock by themselves with no further
// code. Another profile needs another seat, which the
// owner of the theme can add for a quarter of its price (supabase/migrations/20261027130000_profile_seats.sql).
(function(){
 const FG=window.FG;if(!FG)return;
 let enabled=[],seats={},run=0,dialog;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 // a price is the cotton icon and the number (the same mark as the market's prices), never the word
 const price=n=>{const e=make('span');e.className='mkt-price';e.setAttribute('aria-label',n+' Cotton');const i=make('img');i.className='coin-i';i.src='assets/brand/cotton-coin.svg';i.alt='';i.width=16;i.height=16;e.append(i,make('span',String(n)));return e;};
 const withPrice=(tag,before,n,after)=>{const e=make(tag);e.append(before,price(n));if(after)e.append(after);return e;};
 const key=()=>(crypto.randomUUID?crypto.randomUUID():String(Date.now())+Math.random().toString(16).slice(2));
 const shut=()=>{if(dialog){dialog.close();dialog.remove();dialog=null;}};
 function clear(keepDialog){if(!keepDialog)shut();document.querySelectorAll('[data-activation-extra]').forEach(b=>b.remove());}
 function open(title,...nodes){
  shut();dialog=make('dialog');dialog.className='site-invite';dialog.setAttribute('aria-label',title);
  dialog.append(make('h2',title),...nodes);document.body.append(dialog);dialog.showModal();return dialog;
 }
 async function show(item,version,button){
  const generation=run;button.disabled=true;
  try{
   const r=await FG.sb.rpc('issue_activation_code',{p_item_id:item,p_asset_version:version});
   if(generation!==run)return;
   if(r.error)throw Error('Cannot create an activation code. Please try again.');
   const data=r.data;
   if(!data || typeof data.code!=='string' || !/^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/.test(data.code))throw Error('Invalid activation response');
   const input=make('input');input.value=data.code;input.readOnly=true;input.setAttribute('aria-label','One-time activation code');input.style.width='100%';
   const status=make('p');status.setAttribute('role','status');
   const copy=make('button','Copy code');copy.type='button';copy.className='btn';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);status.textContent='Copied.';}catch{input.focus();input.select();status.textContent='Press Ctrl+C or long-press to copy.';}};
   const close=make('button','Close');close.type='button';close.className='btn';close.onclick=shut;
   const d=open('Unlock in Lightning',
    make('p','In Lightning, open Settings, then Appearance, then Unlock a theme you bought, and paste this code while connected to the internet. It works once and expires in ten minutes.'),
    make('p','One code unlocks the theme for one profile. Do this once: that profile’s other devices unlock by themselves, with no code. A different profile needs its own unlock, at a quarter of the price.'),
    input,copy,close,status);
   d.addEventListener('close',()=>{input.value='';});
  }catch{button.textContent='Try getting a code again';}finally{button.disabled=false;}
 }
 // Another profile: confirm the price first, then buy once (one key per dialog, so a retry never charges twice).
 function addSeat(item,info,button){
  const attempt=key();
  const status=make('p');status.setAttribute('role','status');
  const ok=withPrice('button','Add a profile for ',info.next_price);ok.type='button';ok.className='btn';
  const cancel=make('button','Cancel');cancel.type='button';cancel.className='btn ghost';cancel.onclick=shut;
  ok.onclick=async()=>{
   ok.disabled=true;status.textContent='';
   try{
    const r=await FG.sb.rpc('purchase_theme_seat',{p_item_id:item,p_expected_price:info.next_price,p_idempotency_key:attempt});
    if(r.error)throw r.error;
    status.textContent='Done. '+info.name+' can now be unlocked on '+r.data.seats+' profiles.';
    ok.hidden=true;cancel.textContent='Close';
    await load(true); // read the seats again without closing this message
    const market=window.LightningMarket;if(market&&market.reload)market.reload();
   }catch(e){
    status.textContent=/price changed/i.test(String(e&&e.message))?'The price changed. Close this and try again.':FG.say?FG.say(e):'Could not add a profile. Try again.';
    ok.disabled=false;
   }
  };
  open('Add another profile to '+info.name,
   withPrice('p','Each purchase of '+info.name+' unlocks it for one Lightning profile, on all of that profile’s devices. For another profile you pay 25% of the price: ',info.next_price,', 75% off. It is spent now.'),
   ok,cancel,status);
 }
 function seatNote(info){
  const p=make('p',info.used+' of '+info.seats+(info.seats===1?' profile':' profiles')+' unlocked');
  p.dataset.seatNote='';p.className='mkt-note';return p;
 }
 function attach(){
  if(!FG.session())return;
  for(const cell of document.querySelectorAll('.mkt-cell[data-state="owned"],.mkt-cell[data-state="equipped"]')){
   const bundle=enabled.find(e=>e.item_id===cell.dataset.item);if(!bundle||cell.querySelector('[data-activation-code]'))continue;
   // one block under the card's own rows (a grid cell of its own on the textured cards), so none of it lands on the description
   const extra=make('div');extra.className='mkt-extra';extra.dataset.activationExtra='';
   const button=make('button','Get app code');button.type='button';button.className='btn';button.dataset.activationCode='';button.onclick=()=>show(bundle.item_id,bundle.asset_version,button);extra.append(button);
   const info=seats[bundle.item_id];
   if(info){
    extra.append(seatNote(info));
    if(info.can_buy){const add=withPrice('button','Add another profile · ',info.next_price);add.type='button';add.className='btn ghost';add.dataset.seatAdd='';add.onclick=()=>addSeat(bundle.item_id,info,add);extra.append(add);}
   }
   cell.append(extra);
  }
 }
 async function load(keepDialog){const current=++run;clear(keepDialog===true);enabled=[];seats={};if(!FG.session())return;
  try{
   const [bundles,mine]=await Promise.all([FG.sb.from('bundled_item_versions').select('item_id,asset_version').eq('enabled',true),FG.sb.rpc('my_theme_seats')]);
   if(current!==run)return;
   if(!bundles.error)enabled=bundles.data||[];
   if(mine&&!mine.error&&Array.isArray(mine.data))mine.data.forEach(s=>{seats[s.item_id]=s;});
   attach();
  }catch{/* Unconfigured migration: no code buttons. */}
 }
 FG.ready.then(load);FG.onAuth(load);
 new MutationObserver(attach).observe(document.getElementById('mkt-body')||document.body,{childList:true,subtree:true});
})();
