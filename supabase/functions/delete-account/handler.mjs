// Authenticated account deletion. File removal goes through Storage, never SQL metadata deletes.
export function deleteAccountHandler({createClient,url,anonKey,allowedOrigins=['https://lightningeg.com','https://www.lightningeg.com']}) {
 return async req=>{
  const origin=req.headers.get('origin');
  const headers={'Content-Type':'application/json','Cache-Control':'no-store','Vary':'Origin','Access-Control-Allow-Headers':'authorization, apikey, content-type, x-client-info','Access-Control-Allow-Methods':'POST, OPTIONS'};
  const reply=(status,body)=>new Response(JSON.stringify(body),{status,headers});
  if(origin&&!allowedOrigins.includes(origin))return reply(403,{error:'Origin not allowed'});
  if(origin)headers['Access-Control-Allow-Origin']=origin;
  if(req.method==='OPTIONS')return new Response(null,{status:204,headers});
  if(req.method!=='POST')return reply(405,{error:'Use POST'});
  const authorization=req.headers.get('authorization')||'';
  if(!authorization.startsWith('Bearer '))return reply(401,{error:'Sign in required'});
  if(!url||!anonKey)return reply(503,{error:'Account deletion is unavailable'});
  try{
   const reader=req.body?.getReader();if(!reader)return reply(400,{error:'Confirmation required'});
   let size=0,text='';const decoder=new TextDecoder();
   for(;;){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>512){await reader.cancel();return reply(413,{error:'Request too large'});}text+=decoder.decode(value,{stream:true});}
   const body=JSON.parse(text+decoder.decode());
   if(body.p_confirm!=='delete my account')return reply(400,{error:'Type delete my account to confirm'});
   const db=createClient(url,anonKey,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
   const auth=await db.auth.getUser(authorization.slice(7));if(auth.error||!auth.data?.user)return reply(401,{error:'Sign in required'});
   const uid=auth.data.user.id;
   for(let batch=0;batch<20;batch++){
    const r=await db.rpc('prepare_account_deletion',{p_confirm:body.p_confirm});
    if(r.error){const message=String(r.error.message||'');return reply(409,{error:/pending payments/.test(message)?'Resolve pending payments with support before deleting your account.':/administrator/.test(message)?'The administrator account cannot be deleted here.':'Could not prepare account deletion. Retry or contact support.'});}
    if(!Array.isArray(r.data))throw Error('Invalid cleanup response');
    if(r.data.length===0){const out=await db.rpc('delete_my_account',{p_confirm:body.p_confirm});if(out.error)throw Error('Delete failed');return reply(200,{deleted:true});}
    const paths=r.data.map(r=>r.object_key);
    if(paths.some(path=>typeof path!=='string'||!path.startsWith(uid+'/')||path.split('/').length!==3||path.includes('..')))throw Error('Invalid receipt path');
    const out=await db.storage.from('topup-receipts').remove(paths);if(out.error)throw Error('Storage removal failed');
   }
   return reply(409,{error:'More receipt cleanup is needed. Retry deletion to continue.'});
  }catch{return reply(503,{error:'Deletion did not complete. Retry, or cancel deletion preparation from your account. No financial history was erased.'});}
 };
}
