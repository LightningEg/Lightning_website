// App profile → website account (NF-10H6). Configure verify_jwt=false for this endpoint ONLY: the one-time link code is
// the authority. Add edge rate limits. Logic and its tests: handler.mjs, supabase/tests/link-profile-edge.test.mjs.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {linkProfileHandler} from './handler.mjs';
const url = Deno.env.get('SUPABASE_URL'), key = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
const db = url && key ? createClient(url, key, {auth: {persistSession: false, autoRefreshToken: false}}) : null;
Deno.serve(linkProfileHandler({rpc: db ? (name: string, args: unknown) => db.rpc(name, args) : null}));
