// The website's copy of the app's theme contract (schema 2) and manifests: the same rules as the app's
// lightning/security/cosmetic_parts.py, and, with the app repository beside this one, byte-identical copies.
import assert from 'node:assert/strict';
import {readFileSync,readdirSync,existsSync} from 'node:fs';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url),{validate,requireComplete,resolve}=require('../../js/cosmetic-parts.js');
const dir=new URL('../../cosmetics/',import.meta.url);
const read=n=>JSON.parse(readFileSync(new URL(n+'.json',dir),'utf8'));
const contract=read('slots');
assert.equal(contract.schemaVersion,2);
const lum=hex=>{const c=hex.slice(1).match(/../g).map(v=>parseInt(v,16)/255).map(v=>v<=.04045?v/12.92:((v+.055)/1.055)**2.4);return c[0]*.2126+c[1]*.7152+c[2]*.0722;};
const contrast=(a,b)=>{const x=lum(a),y=lum(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};
const themes=['nile','cotton','papyrus','royal-obsidian-gold'];
for(const id of themes){
 const m=read(id);requireComplete(m,contract);assert.equal(m.priceCoins,null,'prices live in the catalogue');
 for(const surface of ['background','surface','raised'])for(const text of ['text','muted'])assert.ok(contrast(m.parts.palette[surface],m.parts.palette[text])>=4.5,id+' '+text+'/'+surface);
 for(const [slot,values] of [['layout',{width:'100px'}],['controls',{fill:'url(https://bad.test)'}],['ground',{texture:'remote-svg'}],['hero',{sheen:'spin'}]]){
  const bad=structuredClone(m);bad.parts[slot]={...(bad.parts[slot]||{}),...values};assert.throws(()=>validate(bad,contract),id+' '+slot);
 }
 const partial=structuredClone(m);delete partial.parts.cards.grain;validate(partial,contract);assert.throws(()=>requireComplete(partial,contract),/cards needs grain/);
}
// the sold themes are the catalogue's ids, paid, at version 1 (supabase/migrations/20261026110000_catalogue_and_app_release.sql)
for(const id of ['nile','cotton','papyrus']){const m=read(id);assert.equal(m.status,'paid');assert.equal(m.version,1);}
assert.equal(read('royal-obsidian-gold').status,'test-preview');
// one continuous motion at most
{const m=read('papyrus');assert.equal(m.parts.hero.sheen,'edge-glint');const two=structuredClone(m);two.parts.header.thread='security-thread';assert.throws(()=>requireComplete(two,contract),/One continuous motion/);}
// the default is the complete fallback; a broken theme rolls back whole
{const baseline=read('lightning-default'),t=read('nile');t.parts={palette:{accent:'#3FD0E0'}};const r=resolve(t,baseline,contract);assert.equal(r.fallback,false);assert.equal(r.parts.palette.surface,baseline.parts.palette.surface);
 t.parts.layout={width:'900px'};assert.deepEqual(resolve(t,baseline,contract),{parts:baseline.parts,fallback:true});}
// with the app repository beside this one, every copy is byte-identical (8J item 4)
const app=['../../../Lightning/','../../../lightning/'].map(p=>new URL(p+'lightning/ui/static/cosmetics/',import.meta.url)).find(u=>existsSync(u));
if(app){for(const f of readdirSync(app).filter(f=>f.endsWith('.json')))assert.equal(readFileSync(new URL(f,dir),'utf8'),readFileSync(new URL(f,app),'utf8'),'cosmetics/'+f+' differs from the app');console.log('Theme parts: copies match the app repository');}
console.log('Theme parts: schema 2, complete layers, one continuous motion, contrast, rollback');
