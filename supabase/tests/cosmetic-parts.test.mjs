import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{validate}=require('../../js/cosmetic-parts.js');
const read=n=>JSON.parse(readFileSync(new URL('../../cosmetics/'+n+'.json',import.meta.url),'utf8'));
const contract=read('slots');
const lum=hex=>{const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
for(const id of ['nile-nocturne','royal-obsidian-gold','nile-papyrus-guilloche']){
 const m=read(id);validate(m,contract);assert.equal(m.priceCoins,null);assert.equal(m.minimumAppVersion,null);
 for(const surface of ['background','surface','raised'])for(const text of ['text','muted'])assert.ok(contrast(m.parts.palette[surface],m.parts.palette[text])>=4.5,id+' '+text+'/'+surface);
 assert.ok(contrast(m.parts.palette.accent,m.parts.palette.onAccent)>=4.5);
 assert.ok(contrast(m.parts.palette.focus,m.parts.palette.raised)>=3);
 const partial=structuredClone(m);partial.parts={cards:{surface:'surface'}};validate(partial,contract);
 for(const [slot,values] of [['layout',{width:'100px'}],['controls',{fill:'url(https://bad.test)'}],['decoration',{motion:'script'}]]){
  const bad=structuredClone(m);bad.parts[slot]=values;assert.throws(()=>validate(bad,contract));
 }
 for(const values of [{pattern:'remote-svg',motion:'none'},{pattern:'none',motion:'papyrus-guilloche'}]){const bad=structuredClone(m);bad.parts.decoration=values;assert.throws(()=>validate(bad,contract),'only the approved lists');}
}
{const ok=read('nile-papyrus-guilloche');assert.deepEqual(ok.parts.decoration,{pattern:'papyrus-guilloche',motion:'security-thread'});validate(ok,contract);}
console.log('Theme parts: the three test palettes meet text/control contrast; unsupported layout, URLs and motion rejected');
const {resolve}=require('../../js/cosmetic-parts.js');
const baseline=read('lightning-default');const partial=read('nile-nocturne');partial.parts={palette:{accent:'#3FD0E0'}};
const result=resolve(partial,baseline,contract);assert.equal(result.fallback,false);assert.equal(result.parts.palette.surface,baseline.parts.palette.surface);
assert.equal(baseline.parts.palette.accent,'#0B6DD6');
partial.parts.layout={width:'900px'};assert.deepEqual(resolve(partial,baseline,contract),{parts:baseline.parts,fallback:true});
