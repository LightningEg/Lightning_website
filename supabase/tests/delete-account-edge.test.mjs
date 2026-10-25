import assert from 'node:assert/strict';
import {deleteAccountHandler} from '../functions/delete-account/handler.mjs';
const uid='00000000-0000-4000-8000-000000000001';
function setup({objects=[uid+'/request/one.png'],prepareError=null,removeError=false,invalidUser=false}={}){
 const calls=[];let remaining=[...objects];
 const handler=deleteAccountHandler({url:'https://example.test',anonKey:'public',createClient:()=>({auth:{getUser:async token=>{calls.push(['getUser',token]);return {data:{user:invalidUser?null:{id:uid}},error:null};}},rpc:async(name,args)=>{calls.push([name,args]);if(name==='prepare_account_deletion')return {data:remaining.map(object_key=>({object_key})),error:prepareError};return {data:null,error:null};},storage:{from:bucket=>({remove:async paths=>{calls.push(['remove',bucket,paths]);if(removeError)return {error:{message:'Unavailable'}};remaining=[];return {error:null};}})}})});
 return {handler,calls};
}
const request=(body={p_confirm:'delete my account'},headers={})=>new Request('https://example.test/delete-account',{method:'POST',headers:{authorization:'Bearer signed-token','content-type':'application/json',...headers},body:JSON.stringify(body)});
let p=setup();assert.equal((await p.handler(request({}, {authorization:''}))).status,401);assert.equal(p.calls.length,0);
p=setup();assert.equal((await p.handler(request({p_confirm:'yes'}))).status,400);assert.equal(p.calls.length,0);
p=setup();assert.equal((await p.handler(request(undefined,{origin:'https://evil.test'}))).status,403);
p=setup({invalidUser:true});assert.equal((await p.handler(request())).status,401);assert.equal(p.calls.some(c=>c[0]==='prepare_account_deletion'),false);
p=setup();let r=await p.handler(request());assert.equal(r.status,200);assert.deepEqual(await r.json(),{deleted:true});assert.deepEqual(p.calls.map(c=>c[0]),['getUser','prepare_account_deletion','remove','prepare_account_deletion','delete_my_account']);
p=setup({objects:[]});assert.equal((await p.handler(request())).status,200);assert.equal(p.calls.some(c=>c[0]==='remove'),false);
p=setup({removeError:true});assert.equal((await p.handler(request())).status,503);assert.equal(p.calls.some(c=>c[0]==='delete_my_account'),false);
p=setup({objects:['another-user/request/receipt.png']});assert.equal((await p.handler(request())).status,503);assert.equal(p.calls.some(c=>c[0]==='remove'),false);
p=setup({prepareError:{message:'resolve pending payments'}});r=await p.handler(request());assert.equal(r.status,409);assert.match((await r.json()).error,/pending payments/);assert.equal(p.calls.some(c=>c[0]==='remove'),false);
p=setup();assert.equal((await p.handler(request({p_confirm:'x'.repeat(513)}))).status,413);
console.log('Account deletion edge: auth, confirmation, origin, bounded body, scoped Storage cleanup, interrupted retries and pending payment protection passed');
