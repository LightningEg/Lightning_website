// Shared owner moderation for the community page and operations console.
(function(){
 'use strict';
 const FG=window.FG,el=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
 function card(s,onReview){
  const a=el('article');a.className='panel';a.append(el('h3',s.title),el('p',(s.author||'Member post')+' · '+s.body),el('p','Verification code: '+s.verify_code));
  for(const [name,url]of[['LinkedIn',s.linkedin_url],['Reddit',s.reddit_url]])if(url&&/^https:\/\/www\.(linkedin|reddit)\.com\//.test(url)){const link=el('a','Open '+name+' post');link.href=url;link.target='_blank';link.rel='noopener noreferrer';a.append(link);}
  const check=text=>{const input=el('input');input.type='checkbox';const label=el('label');label.className='chk';label.append(input,el('span',text));a.append(label);return input;};
  const owner=check('I opened the post and verified this member’s code in it.'),backlink=check('I confirmed the post links back to lightningeg.com.'),rules=check('I confirmed this is general money-management content, with no solicitation, financial-service offers or personalized advice.');
  const coins=el('input');coins.type='number';coins.min=0;coins.max=500;coins.value='0';coins.setAttribute('aria-label','Spendable coins');
  const points=el('input');points.type='number';points.min=0;points.max=500;points.value='0';points.setAttribute('aria-label','Leaderboard points');
  const note=el('textarea');note.maxLength=500;note.placeholder='Review note';note.setAttribute('aria-label','Review note');
  const label=(text,input)=>{const l=el('label',text);l.append(input);return l;};a.append(label('Coins for the marketplace',coins),label('Leaderboard points',points),label('Review note',note));
  const status=el('p');status.setAttribute('role','status');
  for(const [text,publish]of[['Approve and award',true],['Reject',false]]){const b=el('button',text);b.type='button';b.className='btn';b.onclick=async()=>{if(!note.value.trim()){status.textContent='Add a clear review note.';return;}if(publish&&(!owner.checked||!backlink.checked||!rules.checked)){status.textContent='Verify ownership, the link back and compliance with the community rules first.';return;}b.disabled=true;try{const r=await FG.sb.rpc('admin_moderate_story',{p_id:s.id,p_publish:publish,p_points:publish?Number(points.value):0,p_coins:publish?Number(coins.value):0,p_note:note.value,p_ownership_verified:owner.checked,p_backlink_verified:backlink.checked,p_expected_revision:s.submission_revision,p_rules_verified:rules.checked});if(r.error)throw r.error;await onReview();}catch(e){status.textContent=FG.say(e);}finally{b.disabled=false;}};a.append(b);}
  const ban=el('button',s.member_suspended?'Restore community access':'Ban from community');ban.type='button';ban.className='btn ghost';ban.onclick=async()=>{if(note.value.trim().length<5){status.textContent='Enter the rule violation and reason for the ban.';return;}if(!window.confirm(s.member_suspended?'Restore community access? Removed posts stay hidden until reviewed again.':'Ban this member from the community? Their public posts will be hidden and new submissions blocked.'))return;ban.disabled=true;try{const r=await FG.sb.rpc(s.member_suspended?'admin_restore_community_member':'admin_ban_community_member',{p_user:s.user_id,p_reason:note.value});if(r.error)throw r.error;await onReview();}catch(e){status.textContent=FG.say(e);}finally{ban.disabled=false;}};a.append(ban,status);return a;
 }
 window.FGStoryModeration={card};
})();
