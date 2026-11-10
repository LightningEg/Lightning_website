// Owned, shipped app themes. A one-time code unlocks the theme for ONE Lightning profile and is then burned; the
// app shares the unlock through the profile itself, so the profile's other devices unlock by themselves with no further
// code. One purchase covers every profile of the buyer, up to 10, at no charge: another profile just gets its own code
// (supabase/migrations/20261110120000_one_purchase_every_profile.sql; app NF-10H).
(function(){
 const FG=window.FG;if(!FG)return;
 const AR=document.documentElement.lang.startsWith('ar');
 let enabled=[],seats={},run=0,dialog;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
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
    make('p','One code unlocks the theme for one profile. Do this once: that profile’s other devices unlock by themselves, with no code. Another profile of yours gets its own code here, free, up to 10 profiles.'),
    input,copy,close,status);
   d.addEventListener('close',()=>{input.value='';});
  }catch{button.textContent='Try getting a code again';}finally{button.disabled=false;}
 }
 function seatNote(info){
  const n=Number(info.used)||0,cap=Number(info.seats)||10;
  const p=make('p',AR?('اتفعّل على '+n.toLocaleString('ar-EG')+' من '+cap.toLocaleString('ar-EG')+' ملفات، من غير فلوس زيادة'):(n+' of '+cap+' profiles unlocked, at no extra cost'));
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
   if(info)extra.append(seatNote(info));
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
