import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {deleteAccountHandler} from './handler.mjs';
// Explicit getUser validation also supports projects using modern asymmetric JWT signing keys.
Deno.serve(deleteAccountHandler({createClient,url:Deno.env.get('SUPABASE_URL'),anonKey:Deno.env.get('SUPABASE_ANON_KEY')}));
