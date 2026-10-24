// Supabase Edge Function. Neither the signing secret nor a service-role key reaches clients.
import { createClient } from 'npm:@supabase/supabase-js@2.118.0';
import { signInventory } from './license.mjs';

Deno.serve(async (req: Request) => {
  const origin = req.headers.get('origin');
  const allowed = (Deno.env.get('STORE_ALLOWED_ORIGINS') || '').split(',').map(s => s.trim()).filter(Boolean);
  const headers = new Headers({ 'Content-Type': 'application/json', 'Cache-Control': 'no-store', 'Vary': 'Origin' });
  if (origin && !allowed.includes(origin)) return new Response('{"error":"Origin not allowed"}', {status:403,headers});
  if (origin) headers.set('Access-Control-Allow-Origin', origin);
  headers.set('Access-Control-Allow-Headers', 'authorization, apikey, content-type, x-client-info');
  headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS');
  const reply = (status: number, body: unknown) => new Response(JSON.stringify(body),{status,headers});
  if (req.method === 'OPTIONS') return new Response(null,{status:204,headers});
  if (req.method !== 'POST') return reply(405,{error:'Use POST'});
  const authorization = req.headers.get('authorization') || '';
  if (!authorization.startsWith('Bearer ')) return reply(401,{error:'Sign in required'});
  const url = Deno.env.get('SUPABASE_URL');
  const anon = Deno.env.get('SUPABASE_ANON_KEY');
  const secret = Deno.env.get('STORE_SIGNING_PRIVATE_JWK');
  const keyId = Deno.env.get('STORE_SIGNING_KEY_ID');
  if (!url || !anon || !secret || !keyId) return reply(503,{error:'Purchase restoration is not configured'});
  try {
    const db = createClient(url,anon,{global:{headers:{Authorization:authorization}},auth:{persistSession:false,autoRefreshToken:false}});
    const {data:user,error:authError} = await db.auth.getUser(authorization.slice(7));
    if (authError || !user.user) return reply(401,{error:'Sign in required'});
    const {data,error} = await db.rpc('restore_store_inventory');
    if (error || data?.account_id !== user.user.id) return reply(503,{error:'Could not restore purchases'});
    return reply(200,await signInventory(data,JSON.parse(secret),keyId));
  } catch {
    // Do not log tokens, purchase data or signing material.
    return reply(503,{error:'Could not restore purchases'});
  }
});
