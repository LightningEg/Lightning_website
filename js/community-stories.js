// The stories page: what people shared, one form to share your own, your posts and, for the owner, the review queue.
// All member text is set with textContent. The server checks every rule (js/story-moderation.js has the owner's side).
(function(){
 'use strict';const FG=window.FG,$=id=>document.getElementById(id);let generation=0;
 const el=(t,s)=>{const e=document.createElement(t);if(s)e.textContent=s;return e;};
 const msg=s=>{$('story-status').textContent=s;};
 const action=(title,fn)=>{const b=el('button',title);b.type='button';b.className='btn ghost';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){msg(FG.say(e));}finally{b.disabled=false;}};return b;};
 const rpc=async(n,p)=>{const r=await FG.sb.rpc(n,p);if(r.error)throw r.error;return r.data;};
 const SAFE=/^https:\/\/www\.(linkedin\.com\/(posts\/|feed\/update\/)|reddit\.com\/r\/[A-Za-z0-9_]+\/comments\/)/;
 const STATE={pending:'Waiting for review',published:'Published',rejected:'Declined',withdrawn:'Withdrawn',draft:'Needs a change'};
 function mine(s){
  const a=el('article');a.className='panel';a.append(el('h3',STATE[s.status]||s.status),el('p',s.body));
  const url=s.linkedin_url||s.reddit_url;if(url&&SAFE.test(url)){const l=el('a','Your post');l.href=url;l.target='_blank';l.rel='noopener noreferrer';a.append(l);}
  if(s.review_note)a.append(el('p','Note from the reviewer: '+s.review_note));
  if(s.awarded_coins||s.awarded_points)a.append(el('p','Earned '+s.awarded_coins+' coins and '+s.awarded_points+' points.'));
  const row=el('div');row.className='row';
  if(['draft','rejected','withdrawn'].includes(s.status)){
   const f=$('story-form');
   row.append(action('Edit and share again',async()=>{f.elements.id.value=s.id;f.elements.url.value=url||'';f.elements.line.value=s.body;f.elements.title.value=s.title;f.elements.author.value=s.submitted_author_name||'';f.elements.consent.checked=false;$('story-new').hidden=false;f.scrollIntoView();}));
  }
  if(['pending','published'].includes(s.status))row.append(action('Withdraw',async()=>{await rpc('withdraw_story',{p_id:s.id});await load();}));
  a.append(row);return a;
 }
 
 async function load(){const run=++generation;$('story-mine').replaceChildren();$('story-queue').replaceChildren();$('story-member').hidden=true;$('story-review').hidden=true;try{
  const feed=await rpc('stories_feed',{});if(run!==generation)return;$('story-feed').replaceChildren(...feed.map(s=>window.FGStory.card(s)));if(!feed.length)$('story-feed').append(el('p','No published stories yet.'));
  const session=FG.session();$('story-member').hidden=!session;if(!session)return;

  const me=await FG.sb.from('community_stories').select('*').eq('user_id',session.user.id).order('updated_at',{ascending:false});if(me.error)throw me.error;if(run!==generation)return;
  // A draft the member never sees a reason for is internal (made by the older two-step form): not listed.
  const shown=me.data.filter(s=>s.status!=='draft'||s.review_note);$('story-mine-h').hidden=!shown.length;$('story-mine').replaceChildren(...shown.map(mine));
  const admin=await rpc('is_admin',{});if(admin){
   const [ladder,q]=await Promise.all([rpc('admin_story_ladder',{}).catch(()=>null),FG.sb.from('community_stories').select('*').eq('status','pending').order('submitted_at')]);
   if(q.error)throw q.error;if(run!==generation)return;
   $('story-review').hidden=false;$('story-queue').replaceChildren(...q.data.map(s=>window.FGStoryModeration.card(s,load,ladder)));}
  msg('');
 }catch(e){msg('Stories are not available yet, or this action needs setup. '+FG.say(e));}}
 function reset(){const f=$('story-form');f.reset();f.elements.id.value='';$('story-new').hidden=true;}
 $('story-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]'),uid=FG.session()?.user.id;b.disabled=true;try{
  if(f.elements.title.value.trim().length<5 || f.elements.title.value.trim().length>140 || f.elements.author.value.trim().length<2 || f.elements.author.value.trim().length>80)throw new Error('Enter a title and the author name shown on the post.');
  await rpc('share_story',{p_url:f.elements.url.value,p_line:f.elements.line.value,p_consent:f.elements.consent.checked,p_id:f.elements.id.value||null,p_title:f.elements.title.value,p_author:f.elements.author.value});
  if(FG.session()?.user.id!==uid)return;reset();await load();msg('Shared. We will look at your post and tell you here.');}catch(e){msg(FG.say(e));}finally{b.disabled=false;}};
 $('story-new').onclick=reset;
 FG.ready.then(()=>{if(FG.sb)load();else msg('Sign-in is not configured.');});FG.onAuth(()=>{reset();load();});
})();
