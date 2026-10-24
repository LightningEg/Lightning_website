// First-test designs live in a bounded preview. They never buy/equip or unlock app items.
(async function(){
 const host=document.getElementById('parts-lab');if(!host)return;
 function el(tag,text){const x=document.createElement(tag);if(text)x.textContent=text;return x;}
 try{
  const fetchJSON=async path=>{const r=await fetch(path);if(!r.ok)throw Error('Preview unavailable');return r.json();};
  const contract=await fetchJSON('cosmetics/slots.json');
  const ids=['nile-nocturne','royal-obsidian-gold'];
  for(const id of ids){
   const m=CosmeticParts.validate(await fetchJSON('cosmetics/'+id+'.json'),contract);
   const card=el('article');card.className='parts-test';
   card.append(el('h3',m.name),el('p','Test preview · price not set · app delivery not enabled'));
   const scene=el('div');scene.className='parts-scene';scene.setAttribute('aria-label',m.name+' sample appearance');
   scene.append(el('span','Sample overview'),el('strong','Your monthly plan'),el('p','Illustration only — your layout and calculations stay the same.'));
   const sample=el('button','Example button');sample.type='button';sample.disabled=true;scene.append(sample);card.append(scene);
   const actions=el('div');actions.className='row';const tryIt=el('button','Try these parts');tryIt.type='button';tryIt.className='btn';
   const reset=el('button','Reset preview');reset.type='button';reset.className='btn ghost';
   const status=el('p');status.setAttribute('role','status');
   tryIt.addEventListener('click',()=>{for(const [key,value] of Object.entries(m.parts.palette))scene.style.setProperty('--part-'+key,value);status.textContent='Previewing '+m.name+'. Nothing has been saved or unlocked.';});
   reset.addEventListener('click',()=>{scene.removeAttribute('style');status.textContent='Default preview restored.';});
   actions.append(tryIt,reset);card.append(actions,status);
   const detail=el('details');detail.append(el('summary','Parts this theme changes'));
   const list=el('dl');for(const [slot,values] of Object.entries(m.parts)){list.append(el('dt',slot),el('dd',Object.entries(values).map(([k,v])=>k+': '+v).join(' · ')));}detail.append(list);card.append(detail);host.append(card);
  }
 }catch{host.append(el('p','Theme previews are unavailable. Your account and owned items are unchanged.'));}
})();
