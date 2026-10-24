// Same account on the public site and For Geeks. Invitation is optional, dismissible, and untracked.
(function () {
  'use strict';
  const ar=document.documentElement.lang.startsWith('ar');
  const prefix=ar?'../':'';
  const accountLinks=document.querySelectorAll('[data-site-account]');
  const FG=window.FG;
  if (!FG) return;
  const KEY='lightning-account-invite-dismissed-v1';
  const dismissed=()=>{try{return Date.now()-Number(localStorage.getItem(KEY)||0)<7*86400000;}catch{return false;}};
  let dialog;
  const close=()=>{if(dialog?.open)dialog.close();try{localStorage.setItem(KEY,String(Date.now()));}catch{}};
  const make=(tag,text)=>{const e=document.createElement(tag);if(text)e.textContent=text;return e;};
  function invite() {
    if(dismissed() || !/\/(?:index\.html)?$/.test(location.pathname) || typeof HTMLDialogElement==='undefined')return;
    dialog=make('dialog');dialog.className='site-invite';dialog.setAttribute('aria-labelledby','site-invite-title');dialog.setAttribute('aria-describedby','site-invite-description');
    const x=make('button','×');x.type='button';x.className='site-invite-close';x.setAttribute('aria-label',ar?'اقفل الدعوة':'Close invitation');x.addEventListener('click',close);dialog.append(x);
    const title=make('h2',ar?'خلي ليك مكان في Lightning.':'Make Lightning a little more yours.');title.id='site-invite-title';dialog.append(title);
    const description=make('p',ar?'حساب مجاني لملفك الشخصي ومجموعتك وسجل الكوينز. التطبيق نفسه بيشتغل من غير حساب.':'A free account for your profile, collection and coin history. The finance app still works without an account.');description.id='site-invite-description';dialog.append(description);
    const benefits=make('div');benefits.className='site-benefits';
    const rows=ar?[
      ['profile','ملف على مزاجك','اختار مين يشوف ملفك، وشارك شغلك لو حبيت.'],
      ['looks','ألوان ولمسات ليك','شوف ثيمات وبانرات الموقع في المتجر.'],
      ['community','مساهمتك بتفرق','المهام والفيدباك المقبولين ممكن يكسبوك كوينز.']
    ]:[
      ['profile','Your own profile','Choose who can see it, and share your work if you want.'],
      ['looks','A look you like','Explore website themes and banners in the marketplace.'],
      ['community','Credit for contributing','Accepted tasks and useful feedback can earn you coins.']
    ];
    for(const [image,heading,copy] of rows){const f=make('figure');const img=make('img');img.src=prefix+'assets/account/'+image+'.svg';img.alt='';img.width=480;img.height=240;f.append(img,make('h3',heading),make('p',copy));benefits.append(f);}
    dialog.append(benefits);
    dialog.append(make('p',ar?'ثيمات التطبيق والبادجز والشحن بـ InstaPay لسه بنجهزهم. صفحات الحساب والمتجر بالإنجليزي حاليًا.':'App themes, badges and InstaPay top-ups are on the way. Your financial data stays on your devices.'));
    const actions=make('div');actions.className='site-invite-actions';
    const signup=make('a',ar?'اعمل حساب مجاني':'Create a free account');signup.href=prefix+'account.html?signup=1';signup.className='btn btn-primary';signup.addEventListener('click',close);
    const browse=make('a',ar?'شوف المتجر':'Explore the marketplace');browse.href=prefix+'marketplace.html';browse.addEventListener('click',close);
    const later=make('button',ar?'مش دلوقتي':'Maybe later');later.type='button';later.dataset.later='';later.addEventListener('click',close);
    actions.append(signup,browse,later);dialog.append(actions);dialog.addEventListener('cancel',e=>{e.preventDefault();close();});
    document.body.append(dialog);
    // Native dialog provides focus containment, Escape and a modal background. Never interrupt another dialog.
    if(document.querySelector('dialog[open], [aria-modal="true"]:not([hidden])'))return;
    dialog.showModal();x.focus();
  }
  FG.ready.then(({session})=>{
    accountLinks.forEach(a=>a.textContent=session?(ar?'حسابي':'My account'):(ar?'حساب':'Account'));
    if(!session && FG.available)invite();
  }).catch(()=>{});
  FG.onAuth(session=>{accountLinks.forEach(a=>a.textContent=session?(ar?'حسابي':'My account'):(ar?'حساب':'Account'));if(session)close();});
})();
