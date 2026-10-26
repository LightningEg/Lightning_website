// Data-only part validation shared by the market previews and tests. Does not grant paid ownership.
// The same rules as the app's lightning/security/cosmetic_parts.py (schema 2): every element states paint (palette
// keys), material and motion (values from cosmetics/slots.json); a delivered theme states every layer and runs one
// continuous motion at most. cosmetics/*.json are copies of the app's bundled manifests (a test keeps them equal).
(function(root){
 'use strict';
 const hex=/^#[0-9a-f]{6}$/i;
 function keys(spec){const k={};for(const p of spec.paint||[])k[p]=null;for(const layer of ['material','motion'])Object.assign(k,spec[layer]||{});return k;}
 function validate(manifest,contract){
  if(!manifest || typeof manifest!=='object' || manifest.schemaVersion!==contract.schemaVersion || typeof manifest.id!=='string' || !/^[a-z0-9-]{2,60}$/.test(manifest.id||'') || !Number.isInteger(manifest.version) || manifest.version<1)throw Error('Unsupported theme manifest');
  if(!manifest.parts || Array.isArray(manifest.parts) || typeof manifest.parts!=='object')throw Error('Parts required');
  const tokens=new Set(contract.slots.palette.paint);
  for(const [slot,values] of Object.entries(manifest.parts)){
   const spec=contract.slots[slot];if(!spec || !values || Array.isArray(values) || typeof values!=='object')throw Error('Unknown or malformed part');
   const allowed=keys(spec);
   for(const [key,value] of Object.entries(values)){
    if(!(key in allowed)||typeof value!=='string')throw Error('Unsupported part property');
    if(slot==='palette'){if(!hex.test(value))throw Error('Invalid colour');}
    else if(allowed[key]===null){if(!tokens.has(value))throw Error('Unknown palette reference');}
    else if(!allowed[key].includes(value))throw Error('Unsupported part value');
   }
  }
  return manifest;
 }
 function checkMotion(parts,contract){
  const running=contract.limits.continuous.filter(n=>{const [slot,key]=n.split('.');return ((parts[slot]||{})[key]||'none')!=='none';});
  if(running.length>1)throw Error('One continuous motion at most, not '+running.join(', '));
 }
 function requireComplete(manifest,contract){
  validate(manifest,contract);
  for(const [slot,spec] of Object.entries(contract.slots)){const missing=Object.keys(keys(spec)).filter(k=>!(k in (manifest.parts[slot]||{})));if(missing.length)throw Error(slot+' needs '+missing.sort().join(', '));}
  checkMotion(manifest.parts,contract);
  return manifest;
 }
 function resolve(manifest,baseline,contract){
  try{requireComplete(baseline,contract);}catch{throw Error('Incomplete built-in fallback');}
  const parts=JSON.parse(JSON.stringify(baseline.parts));
  try{validate(manifest,contract);}catch{return {parts,fallback:true};}
  for(const [slot,values] of Object.entries(manifest.parts))Object.assign(parts[slot],values);
  return {parts,fallback:false};
 }
 const api={validate,requireComplete,resolve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CosmeticParts=api;
})(typeof window!=='undefined'?window:globalThis);
