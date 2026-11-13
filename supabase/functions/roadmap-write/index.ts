// Owner console Roadmap: set an issue's list (status label) or file a new issue on the app repository's GitHub board.
// The GitHub token lives only in the function secret GITHUB_ROADMAP_TOKEN (fine-grained, Issues: read and write on
// LightningEg/Lightning). Logic and its tests: handler.mjs, supabase/tests/roadmap-write.test.mjs.
import {createClient} from 'npm:@supabase/supabase-js@2.118.0';
import {roadmapWriteHandler} from './handler.mjs';
Deno.serve(roadmapWriteHandler({createClient, url: Deno.env.get('SUPABASE_URL'), anonKey: Deno.env.get('SUPABASE_ANON_KEY'),
  token: Deno.env.get('GITHUB_ROADMAP_TOKEN'), fetch}));
