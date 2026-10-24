// Owned, shipped app items can issue fresh delivery codes. No activation/device quota.
(function(){
 const FG=window.FG;if(!FG)return;
 let enabled=[],run=0,dialog;
 const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 function clear(){if(dialog){dialog.close();dialog.remove();dialog=null;}document.querySelectorAll('[data-activation-code]').forEach(b=>b.remove());}
 async function show(item,version,button){
  const generation=run;button.disabled=true;
  try{
   const r=await FG.sb.rpc('issue_activation_code',{p_item_id:item,p_asset_version:version});
   if(generation!==run)return;
   if(r.error)throw Error('Cannot create an activation code. Please try again.');
   const data=r.data;
   if(!data || typeof data.code!=='string' || !/^[A-F0-9]{8}(-[A-F0-9]{8}){3}$/.test(data.code))throw Error('Invalid activation response');
   if(dialog){dialog.close();dialog.remove();}
   dialog=make('dialog');dialog.className='site-invite';dialog.setAttribute('aria-label','Unlock your app item');
   dialog.append(make('h2','Unlock in Lightning'),make('p','Enter this code in the PC or phone app while connected to the internet. It expires in ten minutes and works once. Your purchase stays on your account; another device can get a fresh code for free.'));
   const input=make('input');input.value=data.code;input.readOnly=true;input.setAttribute('aria-label','One-time activation code');input.style.width='100%';dialog.append(input);
   const status=make('p');status.setAttribute('role','status');
   const copy=make('button','Copy code');copy.type='button';copy.className='btn';copy.onclick=async()=>{try{await navigator.clipboard.writeText(input.value);status.textContent='Copied.';}catch{input.focus();input.select();status.textContent='Select and copy the code above.';}};
   const close=make('button','Close');close.type='button';close.className='btn';close.onclick=()=>{dialog.close();dialog.remove();dialog=null;};
   dialog.append(copy,close,status);dialog.addEventListener('close',()=>{input.value='';});document.body.append(dialog);dialog.showModal();
  }catch{button.textContent='Try getting a code again';}finally{button.disabled=false;}
 }
 function attach(){
  if(!FG.session())return;
  for(const cell of document.querySelectorAll('.mkt-cell[data-state="owned"],.mkt-cell[data-state="equipped"]')){
   const bundle=enabled.find(e=>e.item_id===cell.dataset.item);if(!bundle||cell.querySelector('[data-activation-code]'))continue;
   const button=make('button','Get app unlock code');button.type='button';button.className='btn';button.dataset.activationCode='';button.onclick=()=>show(bundle.item_id,bundle.asset_version,button);cell.append(button);
  }
 }
 async function load(){const current=++run;clear();enabled=[];if(!FG.session())return;
  try{const r=await FG.sb.from('bundled_item_versions').select('item_id,asset_version').eq('enabled',true);if(current!==run)return;if(!r.error)enabled=r.data||[];attach();}catch{/* Unconfigured migration: no code buttons. */}
 }
 FG.ready.then(load);FG.onAuth(load);
 new MutationObserver(attach).observe(document.getElementById('mkt-body')||document.body,{childList:true,subtree:true});
})();
