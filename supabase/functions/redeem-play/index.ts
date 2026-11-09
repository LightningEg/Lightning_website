// Google Play purchase → signed theme licence (NF-11B3). Configure verify_jwt=false for this endpoint ONLY: Google's answer
// about the purchase token is the authority. Logic and its tests: handler.mjs, supabase/tests/redeem-play.test.mjs.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {redeemPlayHandler} from './handler.mjs';
const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = url && key ? createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}}) : null;
Deno.serve(redeemPlayHandler({
  env: (name: string) => (name === 'GOOGLE_PLAY_SERVICE_ACCOUNT' && !db) ? undefined : Deno.env.get(name),
  rpc: (name: string, args: unknown) => db!.rpc(name, args),
}));
