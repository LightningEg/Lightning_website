// Bearer-ticket exchange for native apps, no app account login required. One code claims one profile's seat. Configure verify_jwt=false
// for this endpoint ONLY; the UUID-strength one-time ticket is the authority. Add edge rate limits.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {signInventory} from '../restore-purchases/license.mjs';
Deno.serve(async(req:Request)=>{
 const headers={'Content-Type':'application/json','Cache-Control':'no-store'};
 const reply=(status:number,data:unknown)=>new Response(JSON.stringify(data),{status,headers});
 if(req.method!=='POST')return reply(405,{error:'Use POST'});
 // Native clients only. Do not expose this bearer-ticket exchange to arbitrary browser origins.
 if(req.headers.get('origin'))return reply(403,{error:'Use the Lightning app'});
 if(Number(req.headers.get('content-length')||0)>2048)return reply(413,{error:'Request too large'});
 const url=Deno.env.get('SUPABASE_URL'),key=Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
 const secret=Deno.env.get('STORE_SIGNING_PRIVATE_JWK'),keyId=Deno.env.get('STORE_SIGNING_KEY_ID');
 if(!url||!key||!secret||!keyId)return reply(503,{error:'Activation is not configured'});
 try {
  // A bounded stream, rather than Content-Length alone, limits chunked bodies too.
  const reader=req.body?.getReader();if(!reader)return reply(400,{error:'Invalid code'});
  let bytes=0;const chunks:Uint8Array[]=[];
  for(;;){const {done,value}=await reader.read();if(done)break;bytes+=value.length;if(bytes>2048){await reader.cancel();return reply(413,{error:'Request too large'});}chunks.push(value);}
  const raw=new Uint8Array(bytes);let at=0;for(const c of chunks){raw.set(c,at);at+=c.length;}
  const body=JSON.parse(new TextDecoder().decode(raw));
  // Current apps send every paid theme they carry ("items") and the code names its own theme; older apps send one item.
  const items=Array.isArray(body.items)&&body.items.length>=1&&body.items.length<=50&&body.items.every((i:any)=>i&&typeof i.item_id==='string'&&i.item_id.length<=60&&Number.isInteger(i.asset_version))
   ?body.items.map((i:any)=>({item_id:i.item_id,asset_version:i.asset_version})):null;
  if(typeof body.code!=='string'||body.code.length>64||(!items&&(typeof body.item_id!=='string'||body.item_id.length>60||!Number.isInteger(body.asset_version))))return reply(400,{error:'Invalid code'});
  // The app names its profile: a code claims one profile's seat, and further devices of that profile reuse it.
  if(typeof body.profile_id!=='string'||!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(body.profile_id))return reply(400,{error:'Update Lightning: the app did not say which profile this is.'});
  // Validate signing configuration before spending a ticket. Ownership survives failed delivery;
  // the customer can always issue a fresh code from the same purchase.
  const jwk=JSON.parse(secret);await crypto.subtle.importKey('jwk',jwk,'Ed25519',false,['sign']);
  if(!/^[a-zA-Z0-9._-]{1,80}$/.test(keyId))return reply(503,{error:'Activation is not configured'});
  const db=createClient(url,key,{auth:{persistSession:false,autoRefreshToken:false}});
  const {data,error}=await db.rpc('redeem_activation_code',items
   ?{p_code:body.code,p_items:items,p_profile_id:body.profile_id}
   :{p_code:body.code,p_item_id:body.item_id,p_asset_version:body.asset_version,p_profile_id:body.profile_id});
  if(error&&/unsupported bundled item/.test(String(error.message)))return reply(422,{code:'update_app',error:'Update Lightning to wear this theme.'});
  if(error&&/every profile seat/.test(String(error.message)))return reply(409,{code:'no_seat',error:'Every profile seat for this theme is used. Add another profile on your account page: it costs a quarter of the price.'});
  if(error)return reply(400,{error:'That code is used or expired. Get a fresh one from your account page.'});
  return reply(200,await signInventory(data,jwk,keyId));
 }catch{return reply(400,{error:'Could not activate. Get a fresh code from your account if needed.'});}
});
