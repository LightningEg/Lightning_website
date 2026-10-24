// Data-only part validation shared by test preview tooling. Does not grant paid ownership.
(function(root){
 'use strict';
 const hex=/^#[0-9a-f]{6}$/i;
 function validate(manifest,contract){
  if(!manifest || typeof manifest!=='object' || manifest.schemaVersion!==1 || typeof manifest.id!=='string' || !/^[a-z0-9-]{2,60}$/.test(manifest.id||'') || !Number.isInteger(manifest.version) || manifest.version<1)throw Error('Unsupported theme manifest');
  if(!manifest.parts || Array.isArray(manifest.parts) || typeof manifest.parts!=='object')throw Error('Parts required');
  const tokens=new Set(contract.slots.palette.allowed);
  for(const [slot,values] of Object.entries(manifest.parts)){
   const spec=contract.slots[slot];if(!spec || !values || Array.isArray(values) || typeof values!=='object')throw Error('Unknown or malformed part');
   for(const [key,value] of Object.entries(values)){
    if(!spec.allowed.includes(key)||typeof value!=='string')throw Error('Unsupported part property');
    if(slot==='palette'){if(!hex.test(value))throw Error('Invalid colour');}
    else if(key==='logoVariant'){if(!['on-dark','on-light'].includes(value))throw Error('Unsupported logo');}
    else if(['pattern','motion','decoration'].includes(key)){if(value!=='none')throw Error('Unsupported decoration');}
    else if(!tokens.has(value))throw Error('Unknown palette reference');
   }
  }
  return manifest;
 }
 function resolve(manifest,baseline,contract){
  validate(baseline,contract);
  for(const [slot,spec] of Object.entries(contract.slots))if(spec.allowed.some(k=>!(k in (baseline.parts[slot]||{}))))throw Error('Incomplete built-in fallback');
  const parts=JSON.parse(JSON.stringify(baseline.parts));
  try{validate(manifest,contract);}catch{return {parts,fallback:true};}
  for(const [slot,values] of Object.entries(manifest.parts))Object.assign(parts[slot],values);
  return {parts,fallback:false};
 }
 const api={validate,resolve};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.CosmeticParts=api;
})(typeof window!=='undefined'?window:globalThis);
