(function(){
 'use strict';const FG=window.FG,$=id=>document.getElementById(id);let generation=0;
 const el=(t,s)=>{const e=document.createElement(t);if(s)e.textContent=s;return e;};
 const msg=s=>{$('story-status').textContent=s;};
 const action=(title,fn)=>{const b=el('button',title);b.type='button';b.className='btn ghost';b.onclick=async()=>{b.disabled=true;try{await fn();}catch(e){msg(FG.say(e));}finally{b.disabled=false;}};return b;};
 const rpc=async(n,p)=>{const r=await FG.sb.rpc(n,p);if(r.error)throw r.error;return r.data;};
 function draw(s,privateView=false,review=false){
  if(!privateView&&!review)return window.FGStory.card(s);
  const a=el('article');a.className='panel';a.append(el('h2',s.title||'Untitled draft'),el('p',s.author||s.status+((s.awarded_coins||s.awarded_points)?' · rewarded '+s.awarded_coins+' coins, '+s.awarded_points+' points':'')));
  const body=el('p',s.body);body.style.whiteSpace='pre-wrap';a.append(body);if((privateView||review)&&s.verify_code)a.append(el('p','Verification code to put in your post: '+s.verify_code));
  if(s.linkedin_url&&/^https:\/\/(www\.)?linkedin\.com\/(posts\/|feed\/update\/)/.test(s.linkedin_url)){const l=el('a','Author-provided LinkedIn post');l.href=s.linkedin_url;l.target='_blank';l.rel='noopener noreferrer';a.append(l);}
  if(s.reddit_url&&/^https:\/\/www\.reddit\.com\/r\/[A-Za-z0-9_]+\/comments\//.test(s.reddit_url)){const l=el('a','Author-provided Reddit post');l.href=s.reddit_url;l.target='_blank';l.rel='noopener noreferrer';a.append(l);}
  if(privateView){
   if(s.review_note)a.append(el('p','Review: '+s.review_note));
   a.append(action('Edit draft',()=>{const f=$('story-form');f.elements.id.value=s.id;f.elements.title.value=s.title;f.elements.body.value=s.body;f.elements.linkedin.value=s.linkedin_url||'';f.elements.reddit.value=s.reddit_url||'';window.__storyCode=s.verify_code;f.scrollIntoView();}));
   const consent=el('label');const check=el('input');check.type='checkbox';consent.append(check,document.createTextNode(' I agree to publish this text under my public display name.'));a.append(consent);
   a.append(action('Submit for review',async()=>{if(!check.checked){msg('Check the sharing consent first.');return;}await rpc('submit_story',{p_id:s.id,p_consent:true});await load();}));
   a.append(action('Withdraw',async()=>{await rpc('withdraw_story',{p_id:s.id});await load();}));
  }
  if(review){const points=el('input');points.type='number';points.min=0;points.max=500;points.value='0';points.setAttribute('aria-label','Rank points (never spendable)');const coins=el('input');coins.type='number';coins.min=0;coins.max=500;coins.value='0';coins.setAttribute('aria-label','Coins (spendable)');const note=el('input');note.placeholder='Review note';note.setAttribute('aria-label','Review note');a.append(points,coins,note);
   for(const [label,publish]of[['Publish',true],['Reject',false]])a.append(action(label,async()=>{await rpc('admin_review_story',{p_id:s.id,p_publish:publish,p_points:publish?Number(points.value):0,p_coins:publish?Number(coins.value):0,p_note:note.value});await load();}));}
  return a;
 }
 async function load(){const run=++generation;$('story-mine').replaceChildren();$('story-queue').replaceChildren();$('story-member').hidden=true;$('story-review').hidden=true;try{
  const feed=await rpc('stories_feed',{});if(run!==generation)return;$('story-feed').replaceChildren(...feed.map(s=>draw(s)));if(!feed.length)$('story-feed').append(el('p','No published stories yet.'));
  const session=FG.session();$('story-member').hidden=!session;$('story-review').hidden=true;if(!session){$('story-mine').replaceChildren();return;}
  const me=await FG.sb.from('community_stories').select('*').eq('user_id',session.user.id).order('updated_at',{ascending:false});if(me.error)throw me.error;if(run!==generation)return;$('story-mine').replaceChildren(...me.data.map(s=>draw(s,true)));
  const admin=await rpc('is_admin',{});if(admin){const q=await FG.sb.from('community_stories').select('*').eq('status','pending').order('submitted_at');if(q.error)throw q.error;if(run!==generation)return;$('story-review').hidden=false;$('story-queue').replaceChildren(...q.data.map(s=>draw(s,false,true)));}
  msg('');
 }catch(e){msg('Stories are not available yet, or this action needs setup. '+FG.say(e));}}
 $('story-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget,b=f.querySelector('[type=submit]'),uid=FG.session()?.user.id;b.disabled=true;try{const s=await rpc('save_story',{p_id:f.elements.id.value||null,p_title:f.elements.title.value,p_body:f.elements.body.value,p_linkedin_url:f.elements.linkedin.value||null,p_reddit_url:f.elements.reddit.value||null});if(FG.session()?.user.id!==uid)return;f.elements.id.value=s.id;window.__storyCode=s.verify_code;await load();msg('Draft saved. It is not public yet.');}catch(e){msg(FG.say(e));}finally{b.disabled=false;}};
 $('story-new').onclick=()=>{$('story-form').reset();$('story-form').elements.id.value='';};
 $('story-copy').onclick=async()=>{const f=$('story-form');try{await navigator.clipboard.writeText('Disclosure: Lightning may reward accepted community posts with Lightning Coins, a credit for app cosmetics. I wrote this myself.'+(f.elements.id.value?'\nVerification: '+(window.__storyCode||''):''));msg('Copied. Paste the disclosure line (and your verification code) at the end of your LinkedIn or Reddit post, then add its link here.');}catch{msg('Select your text and copy it manually.');}};
 FG.ready.then(()=>{if(FG.sb)load();else msg('Sign-in is not configured.');});FG.onAuth(()=>{$('story-form').reset();$('story-form').elements.id.value='';load();});
})();
