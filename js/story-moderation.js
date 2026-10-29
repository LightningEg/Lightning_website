// Owner review of one story: one row. (A published story shows the blog bonus instead.) Open the post, then Approve (the reward ladder the owner sets), Ask for a change or
// Decline. Used on the community page. Every server rule stays: the post's code and link back are confirmed once, the
// post must be unchanged since it was read (revision), and only an MFA administrator can do any of it.
(function(){
 'use strict';
 const FG=window.FG,el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 const POST=/^https:\/\/(www\.(linkedin|reddit)\.com|lnkd\.in|redd\.it)\//;
 function card(s,onReview,ladder){
  const a=el('article');a.className='panel story-row';
  a.append(el('h3',s.title),el('p',(s.author||'Member')+' · '+s.body),el('p','Name on the post: '+(s.submitted_author_name||s.author||'Member')));
  for(const [name,url]of[['LinkedIn',s.linkedin_url],['Reddit',s.reddit_url]])if(typeof url==='string'&&POST.test(url)){const link=el('a','Open the '+name+' post');link.href=url;link.target='_blank';link.rel='noopener noreferrer';a.append(link);}
  const confirm=el('input');confirm.type='checkbox';const confirmLabel=el('label');confirmLabel.className='chk';confirmLabel.append(confirm,el('span','I opened the post: the title and excerpt match, and it follows the community rules.'));a.append(confirmLabel);
  const note=el('textarea');note.maxLength=500;note.placeholder='Note to the member (needed to ask for a change or decline)';note.setAttribute('aria-label','Note');a.append(note);
  const status=el('p');status.setAttribute('role','status');
  const coins=ladder?Number(ladder.coins):100,points=ladder?Number(ladder.points):50;
  const row=el('div');row.className='row';
  const run=(button,call,needNote,needConfirm)=>{button.type='button';button.onclick=async()=>{
   if(needNote&&note.value.trim().length<5){status.textContent='Write a note of at least 5 characters first.';return;}
   if(needConfirm&&!confirm.checked){status.textContent='Open the post and confirm it first.';return;}
   button.disabled=true;try{const r=await call();if(r.error)throw r.error;await onReview();}catch(e){status.textContent=FG.say(e);}finally{button.disabled=false;}};row.append(button);};
  const approve=el('button','Approve · '+coins+' Cotton + '+points+' points');approve.className='btn';
  run(approve,()=>FG.sb.rpc('admin_approve_story',{p_id:s.id,p_expected_revision:s.submission_revision,p_note:note.value||null}),false,true);
  const change=el('button','Ask for a change');change.className='btn ghost';
  run(change,()=>FG.sb.rpc('admin_request_story_change',{p_id:s.id,p_note:note.value}),true,false);
  const decline=el('button','Decline');decline.className='btn ghost';
  run(decline,()=>FG.sb.rpc('admin_moderate_story',{p_id:s.id,p_publish:false,p_points:0,p_coins:0,p_note:note.value,p_ownership_verified:false,p_backlink_verified:false,p_expected_revision:s.submission_revision,p_rules_verified:false}),true,false);
  // A published story that the blog or a guide now links earns the blog bonus, once (admin_story_blog_bonus).
  if(s.status==='published'){
   row.replaceChildren();confirmLabel.hidden=true;
   const blogCoins=ladder&&ladder.blog_coins!=null?Number(ladder.blog_coins):100;
   if(s.blog_url){a.append(el('p','Blog bonus paid: '+(s.blog_coins_paid||0)+' Cotton · '+s.blog_url));}
   else{
    const url=el('input');url.type='url';url.placeholder='https://lightningeg.com/blog-….html';url.setAttribute('aria-label','Link to the blog post or guide');
    const bonus=el('button','Linked from the blog · pay '+blogCoins+' Cotton');bonus.className='btn';
    run(bonus,()=>FG.sb.rpc('admin_story_blog_bonus',{p_id:s.id,p_blog_url:url.value}),false,false);
    a.append(url);
   }
  }
  a.append(row);
  const ban=el('button',s.member_suspended?'Restore community access':'Ban from community');ban.type='button';ban.className='btn ghost';
  ban.onclick=async()=>{if(note.value.trim().length<5){status.textContent='Enter the rule violation and reason for the ban.';return;}if(!window.confirm(s.member_suspended?'Restore community access? Removed posts stay hidden until reviewed again.':'Ban this member from the community? Their public posts will be hidden and new submissions blocked.'))return;ban.disabled=true;try{const r=await FG.sb.rpc(s.member_suspended?'admin_restore_community_member':'admin_ban_community_member',{p_user:s.user_id,p_reason:note.value});if(r.error)throw r.error;await onReview();}catch(e){status.textContent=FG.say(e);}finally{ban.disabled=false;}};
  a.append(ban,status);return a;
 }
 window.FGStoryModeration={card};
})();
