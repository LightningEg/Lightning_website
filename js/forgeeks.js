/* For Geeks: shared by forgeeks.html, forgeeks-guide.html and forgeeks-roadmap.html. Themes, top bar, rail, reveal, and the field with its weather (lightning, or the theme's own). */
(function(){
  'use strict';
  // Keep links to the former home-page contribution section working: the steps now live on the contribute page.
  if(/\/forgeeks(\.html)?$/.test(location.pathname) && location.hash==='#build'){
    location.replace('forgeeks-guide.html#path');
    return;
  }
  var doc=document,root=doc.documentElement;
  doc.body.classList.remove('no-js');
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $=function(s){return doc.querySelector(s)},$$=function(s){return [].slice.call(doc.querySelectorAll(s))};
  var fmt=function(n){return Math.round(n).toLocaleString('en-US')};
  var toastEl=$('#toast'),toastT;
  function toast(msg,link){
    toastEl.textContent=msg;toastEl.classList.toggle('link',!!link);
    if(link){var a=doc.createElement('a');a.href=link.href;a.textContent=link.text;toastEl.appendChild(doc.createTextNode(' '));toastEl.appendChild(a)}
    toastEl.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){toastEl.classList.remove('on')},link?7000:1800)
  }
  function copy(text){
    var done=function(){toast('copied to clipboard')};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,fallback)}else fallback();
    function fallback(){var t=doc.createElement('textarea');t.value=text;doc.body.appendChild(t);t.select();try{doc.execCommand('copy');done()}catch(_){toast('copy failed')}t.remove()}
  }
  $$('[data-copy]').forEach(function(b){b.addEventListener('click',function(){copy(b.dataset.copy)})});

  /* ===================== themes: a window in the middle of the screen ===================== */
  var THEMES=[
    {id:'mono',name:'Mono',note:'white on black, the default',c:['#0a0a0a','#f2f2f2','#b8b8b8','#ffffff']},
    {id:'paper',name:'Paper',note:'light, for daylight reading',c:['#f4f1ea','#161616','#45413a','#a8401c'],light:true,paid:true,price:300},
    {id:'meadow',name:'Meadow',note:'Lightning\'s own: night blue and green',c:['#08192A','#EAF4F1','#B8CAD2','#3FCB93'],paid:true,price:300},
    {id:'nile',name:'Nile',note:'night blue and gold',c:['#070b16','#e9edf7','#b7c0d8','#e6b450'],paid:true,price:300},
    {id:'ocean',name:'Ocean',note:'deep sea, cyan and mint',c:['#04121a','#dff6ff','#9fc9d9','#38c9f0'],paid:true,price:100,archived:true},
    {id:'tokyo',name:'Tokyo',note:'cool blue and violet',c:['#13141c','#c0caf5','#aab2d8','#7aa2f7'],paid:true,price:100,archived:true},
    {id:'dracula',name:'Dracula',note:'purple and pink',c:['#191a21','#f8f8f2','#c6cae4','#bd93f9'],paid:true,price:100,archived:true},
    {id:'rose',name:'Rose',note:'dusk pink and peach',c:['#140a10','#ffe4ee','#dcaabe','#ff6fa0'],paid:true,price:100,archived:true},
    {id:'synthwave',name:'Synthwave',note:'neon magenta and cyan',c:['#12061f','#f6e9ff','#c6a9df','#ff3ea5'],paid:true,price:100,archived:true},
    {id:'phosphor',name:'Phosphor',note:'green CRT glow',c:['#040a06','#d8ffe4','#a8d6b6','#39ff88'],paid:true,price:100,archived:true},
    {id:'amber',name:'Amber',note:'old terminal, warm',c:['#0c0803','#ffe7c2','#dcb98a','#ffb000'],paid:true,price:100,archived:true},
    {id:'solarized',name:'Solarized',note:'the classic, gold and teal',c:['#002b36','#eee8d5','#aab9b8','#d4a017'],paid:true,price:100,archived:true},
    /* paid themes: cosmetic only, bought with coins in the market (forgeeks-market.html). Prices here are what shows before the
       catalog loads; the server decides the real price (supabase/tests/market.test.mjs checks the two agree). */
    {id:'moss',name:'Moss',note:'dark olive and lime',c:['#0b0e08','#eef3dc','#bcc7a0','#b9d94a'],paid:true,price:150,archived:true},
    {id:'garnet',name:'Garnet',note:'wine red and cream',c:['#1a0608','#fbeee4','#e0b9ab','#ff6b57'],paid:true,price:300},
    {id:'frost',name:'Frost',note:'cool light, slate and indigo',c:['#eef2f7','#0f1722','#3b475a','#3340c4'],light:true,paid:true,price:300},
    /* textured tier (guideline/themes.md section 7): a palette plus a woven texture behind the page, 600 coins */
    {id:'papyrus',name:'Papyrus',note:'Nile night and gold over papyrus fibres, with a travelling gold thread',c:['#070b16','#e9edf7','#b7c0d8','#e6b450'],tex:'papyrus',paid:true,price:1000},
    {id:'cotton',name:'Cotton',note:'warm paper light over a cotton weave',c:['#f4f1ea','#161616','#45413a','#a8401c'],light:true,tex:'cotton',paid:true,price:600},
    {id:'dendera',name:'Dendera',note:'temple pigments on aged papyrus: lapis, gold, turquoise and red ochre, with a slow pigment thread',c:['#f1e6cc','#1e1a14','#54483a','#1f3f8c'],light:true,tex:'dendera',paid:true,price:1000}
  ];
  var btn=$('#theme-btn'),tm=$('#themes'),grid=$('#theme-list'),nameEl=$('#theme-name'),meta=doc.querySelector('meta[name="theme-color"]');
  var saved=root.dataset.theme||'mono',cursor=0,listeners=[],lastFocus=null;
  if(!THEMES.some(function(t){return t.id===saved}))saved='mono';
  var requestedTheme=saved;
  var own={},LOCK='<svg viewBox="0 0 12 12" width="11" height="11" fill="none" stroke="currentColor" stroke-width="1.4" aria-hidden="true"><rect x="2.2" y="5.4" width="7.6" height="5" rx="1"/><path d="M4 5.4V3.9a2 2 0 0 1 4 0v1.5"/></svg>';
  function onTheme(fn){listeners.push(fn)}
  function find(id){return THEMES.filter(function(x){return x.id===id})[0]}
  function apply(id){
    if(id==='mono')delete root.dataset.theme;else root.dataset.theme=id;
    var t=find(id);
    if(t&&t.tex)root.dataset.texture=t.tex;else delete root.dataset.texture; // the textured tier (css/textures.css)
    if(nameEl)nameEl.textContent=id;if(meta)meta.setAttribute('content',t.c[0]);
    listeners.forEach(function(fn){fn(id)});
  }
  function store(id){try{localStorage.setItem('lightning-geeks-theme',id)}catch(_){}}
  /* use: apply and remember a theme the caller knows is allowed (free, owned, or chosen by the server). keep: the picker's rule. */
  function use(id){saved=id;apply(id);store(id)}
  function locked(t){return !!t.paid&&!own[t.id]}
  function equipOnServer(id){
    var F=window.FG;if(!F||!F.sb||!F.session||!F.session())return;
    try{F.sb.rpc('equip_item',{p_item_id:id}).then(function(){},function(){})}catch(_){}
  }
  /* Preview is free for everyone (cosmetics are not DRM); keeping a paid theme you do not own is not: the saved theme stays and the toast points to the market. */
  function keep(id){
    var t=find(id);if(!t)return false;
    if(locked(t)){apply(saved);toast(t.name.toLowerCase()+' is a paid theme, '+t.price+' coins.',{href:'forgeeks-market.html',text:'open the market'});return false}
    use(id);equipOnServer(id);return true;
  }
  /* Archived themes (owner, 2026-10-25) leave the picker unless you own one or wear it; the market no longer sells them. */
  function shown(t){return !t.archived||!!own[t.id]||t.id===saved}
  function vis(){return THEMES.filter(shown)}
  function mark(t){
    var o=t.paid&&doc.getElementById('th-'+t.id);if(!o)return;
    o.hidden=!shown(t);
    var lk=locked(t),p=o.querySelector('.tm-price');
    o.classList.toggle('lk',lk);
    if(lk)p.innerHTML=LOCK+'<span class="sr">locked, </span>'+(Math.round(+t.price)||0)+' coins';else p.textContent='owned';
  }
  THEMES.forEach(function(t,i){
    var o=doc.createElement('div');o.className='tm-card';o.setAttribute('role','option');o.id='th-'+t.id;o.dataset.id=t.id;
    o.innerHTML='<div class="tm-pv" style="background:'+t.c[0]+';color:'+t.c[1]+'" aria-hidden="true"><i style="width:72%;background:'+t.c[1]+'"></i><i style="width:52%;background:'+t.c[2]+';opacity:.85"></i><i style="width:34%;background:'+t.c[3]+'"></i><b style="background:'+t.c[3]+'"></b></div>'
      +'<div class="tm-name">'+t.name+'<span aria-hidden="true">✓ in use</span>'+(t.paid?'<span class="tm-price"></span>':'')+'</div><p class="tm-note">'+t.note+'</p>';
    o.addEventListener('mouseenter',function(){move(vis().indexOf(t),true)});
    o.addEventListener('click',function(){keep(t.id);close()});
    grid.appendChild(o);
  });
  THEMES.forEach(mark);
  function cols(){return innerWidth<=640?2:3}
  function move(i,noScroll){
    var list=vis();
    cursor=Math.max(0,Math.min(list.length-1,i));
    var id=list[cursor].id,card=doc.getElementById('th-'+id);
    [].forEach.call(grid.children,function(c){c.classList.toggle('cur',c===card)});
    grid.setAttribute('aria-activedescendant','th-'+id);
    if(!noScroll)card.scrollIntoView({block:'nearest'});
    apply(id);
  }
  function open(){
    lastFocus=doc.activeElement;
    [].forEach.call(grid.children,function(c){c.setAttribute('aria-selected',String(c.dataset.id===saved))});
    tm.hidden=false;btn.setAttribute('aria-expanded','true');root.style.overflow='hidden';
    THEMES.forEach(mark);
    move(vis().map(function(t){return t.id}).indexOf(saved));grid.focus();
  }
  function close(){
    if(tm.hidden)return;
    tm.hidden=true;btn.setAttribute('aria-expanded','false');root.style.overflow='';apply(saved);
    (lastFocus&&lastFocus.focus?lastFocus:btn).focus();
  }
  btn.addEventListener('click',function(e){e.stopPropagation();tm.hidden?open():close()});
  $$('#themes [data-close]').forEach(function(el){el.addEventListener('click',close)});
  tm.addEventListener('keydown',function(e){
    var k=e.key;
    if(k==='Escape'){e.preventDefault();close();return}
    if(k==='Tab'){e.preventDefault();var x=$('#themes .tm-x');(doc.activeElement===grid?x:grid).focus();return}
    if(doc.activeElement!==grid)return;
    if(k==='ArrowRight'){e.preventDefault();move(cursor+1)}
    else if(k==='ArrowLeft'){e.preventDefault();move(cursor-1)}
    else if(k==='ArrowDown'){e.preventDefault();move(cursor+cols())}
    else if(k==='ArrowUp'){e.preventDefault();move(cursor-cols())}
    else if(k==='Home'){e.preventDefault();move(0)}
    else if(k==='End'){e.preventDefault();move(vis().length-1)}
    else if(k==='Enter'||k===' '){e.preventDefault();keep(vis()[cursor].id);close()}
  });
  grid.addEventListener('mouseleave',function(){if(!tm.hidden)apply(saved)});
  doc.addEventListener('keydown',function(e){
    var tag=(e.target.tagName||'').toLowerCase();
    if((e.key==='t'||e.key==='T')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&tag!=='input'&&tag!=='textarea'&&tm.hidden){e.preventDefault();open()}
  });
  if(find(saved)&&find(saved).paid){saved='mono';store(saved);}
  apply(saved);

  /* Signed in: the catalog says which paid themes you own and which theme follows you. window.FG loads after this file, so it is read once the page is ready. */
  var catalogFor=null;
  function loadOwned(){
    var F=window.FG,s=F&&F.sb&&F.session&&F.session();
    if(!s||catalogFor===s.user.id)return;
    var uid=s.user.id;catalogFor=uid;
    function same(){var n=F.session();return !!n&&n.user.id===uid}
    try{F.sb.rpc('market_catalog').then(function(r){
      if(r.error||!r.data||!same()){catalogFor=null;return}
      var eq=null;own={};
      r.data.forEach(function(it){
        var t=it.type==='theme'&&find(it.id);if(!t)return;
        if(t.paid){if(it.owned)own[t.id]=true;if(it.price>0)t.price=it.price}
        if(it.equipped)eq=t.id;
      });
      THEMES.forEach(mark);
      var selected=eq||((own[requestedTheme]||requestedTheme==='mono')?requestedTheme:'mono');
      if(selected!==saved){saved=selected;store(selected);if(tm.hidden)apply(selected)}
    },function(){catalogFor=null})}catch(_){catalogFor=null}
  }
  function startAccount(){
    var F=window.FG;if(!F||!F.ready)return;
    F.ready.then(loadOwned,function(){});
    if(F.onAuth)F.onAuth(function(s){if(s)loadOwned();else{catalogFor=null;own={};use('mono');THEMES.forEach(mark)}});
  }
  if(doc.readyState==='loading')doc.addEventListener('DOMContentLoaded',startAccount);else startAccount();

  /* ===================== top bar: solid on scroll, progress; the rail: sections of this page ===================== */
  var bar=$('#bar'),prog=$('#progress'),rail=$('#rail'),railLinks=$$('#rail a');
  function onScroll(){
    var y=scrollY,max=doc.documentElement.scrollHeight-innerHeight;
    bar.classList.toggle('solid',y>40);
    prog.style.transform='scaleX('+(max>0?y/max:0)+')';
    if(rail)rail.classList.toggle('show',y>innerHeight*.55);
  }
  addEventListener('scroll',onScroll,{passive:true});onScroll();
  if(rail&&'IntersectionObserver' in window){
    var secObs=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;railLinks.forEach(function(a){var on=a.getAttribute('href')==='#'+e.target.id;a.classList.toggle('on',on);if(on)centre(a)})})},{rootMargin:'-45% 0px -50% 0px'});
    /* under 1300px the rail is a strip under the top bar: scroll it sideways so the current section shows */
    var centre=function(a){if(rail.scrollWidth<=rail.clientWidth)return;var x=a.offsetLeft-(rail.clientWidth-a.offsetWidth)/2;rail.scrollTo({left:Math.max(0,x),behavior:reduce?'auto':'smooth'})};
    $$('section.s,#closing,#top').forEach(function(s){secObs.observe(s)});
  }

  /* ===================== reveal + count-up ===================== */
  function countUp(el){
    var to=+el.dataset.count;if(reduce||!to){return}
    var t0=null,dur=to>1000?1600:1100;
    function step(ts){if(!t0)t0=ts;var p=Math.min(1,(ts-t0)/dur),e=1-Math.pow(1-p,4);el.textContent=fmt(to*e);if(p<1)requestAnimationFrame(step);else el.textContent=fmt(to)}
    el.textContent='0';requestAnimationFrame(step);
  }
  if('IntersectionObserver' in window){
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;e.target.classList.add('in');$$('[data-count]').forEach(function(c){if(e.target.contains(c)&&!c.dataset.done){c.dataset.done=1;countUp(c)}});io.unobserve(e.target)})},{threshold:0,rootMargin:'0px 0px -8% 0px'});
    $$('.reveal').forEach(function(el){io.observe(el)});
  }else $$('.reveal').forEach(function(el){el.classList.add('in')});

  /* card spotlight */
  $$('.card').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px')})});

  window.LG={THEMES:THEMES,keep:keep,use:use,own:function(id,yes){var t=find(id);if(t&&t.paid){own[id]=!!yes;mark(t)}},current:function(){return saved},open:open,onTheme:onTheme,copy:copy,toast:toast,reduce:reduce};

  /* ===================== the field: a terrain of light, current in the grid, and its weather =====================
     The terrain stays behind the page, faint between the hero and the closing; a faint current runs through
     the pixel grid now and then. Every few seconds, or where you click the sky, the weather comes: lightning on
     Mono; every other on-sale theme draws its own scene instead (below, and guideline D08). */
  var cv=$('#field'),ctx=cv.getContext('2d');
  if(!ctx)return;
  var W=0,H=0,DPR=1,N=0,small=false,U,Z,SEED,px,py,pa,ps,BI,ORD,BK=7,CNT=new Int32Array(8);
  var STARS=[],PULSES=[],BOLTS=[],GLOWS=[],RINGS=[],TRAILS=[],SPARKS=[],CURTAINS=[],GRID=24;
  var PART='242,242,242',GLOWC='255,255,255',CORE='255,255,255',LIGHT=false;
  function readColors(){var cs=getComputedStyle(root);PART=cs.getPropertyValue('--particle').trim()||PART;GLOWC=cs.getPropertyValue('--glow').trim()||GLOWC;LIGHT=!!(find(root.dataset.theme)||{}).light;CORE=LIGHT?GLOWC:'255,255,255'}
  /* trying a theme on shows its scene and plays its event once, over the field behind the picker */
  onTheme(function(){readColors();if(W)buildScene();if(reduce){frame(performance.now());return}
    if(performance.now()-t0<1500||!W)return;BOLTS.length=RINGS.length=TRAILS.length=SPARKS.length=CURTAINS.length=0;
    var a=anchor();weather(W*(.3+rnd()*.4),a.hz+(a.fa-a.hz)*.4,false);nextStrike=(performance.now()-t0)/1000+6});
  var hero=$('#top'),closing=$('#closing'),heroH1=$('#top h1');
  function rnd(){return Math.random()}

  function build(){
    small=innerWidth<760;
    W=innerWidth;H=Math.max(innerHeight,cv.getBoundingClientRect().height||0);BW=W;
    /* on a 1x PC screen, sub-pixel dots crawl and flicker as they move: draw at 1.5x at least, within about 4.5 million pixels */
    DPR=Math.max(1,Math.min(small?1.5:1.75,Math.max(devicePixelRatio||1,1.5),Math.sqrt(4.5e6/(W*H))));
    cv.width=Math.round(W*DPR);cv.height=Math.round(H*DPR);ctx.setTransform(DPR,0,0,DPR,0,0);
    var C=small?80:140,R=small?36:50;N=C*R;
    U=new Float32Array(N);Z=new Float32Array(N);SEED=new Float32Array(N);
    px=new Float32Array(N);py=new Float32Array(N);pa=new Float32Array(N);ps=new Float32Array(N);BI=new Uint8Array(N);ORD=new Int32Array(N);
    var k=0;
    for(var r=0;r<R;r++)for(var c=0;c<C;c++){U[k]=(c+rnd()*.9)/C;Z[k]=1.6+Math.pow((r+rnd()*.9)/R,1.35)*34;SEED[k]=rnd()*6.283;k++}
    STARS=[];for(var s=0;s<(small?60:140);s++)STARS.push([rnd(),rnd(),rnd()*6.283,.4+rnd()*.9]);
  }

  /* the terrain stays put behind the page as you scroll: full in the hero and the closing, faint in between */
  function anchor(){return {top:0,hz:H*(small?.1:.17),fa:H*(small?.2:.33),fb:H*(small?.3:.5)}}
  var TA=1;
  function targetTA(){
    // Pages without a full-screen hero or a closing section (account, market, tasks) keep the field quiet.
    if(!hero||!closing)return .16;
    var hr=hero.getBoundingClientRect(),cr=closing.getBoundingClientRect();
    return Math.max(.16,Math.min(1,Math.max(0,hr.bottom/H-.25)/.5),cr.top<H*.9?1:0);
  }

  /* ---- current in the grid: short pulses that run along the dots and turn at right angles ---- */
  function node(v){return Math.round((v-12)/GRID)*GRID+12}
  function pulse(x,y,strong){
    var pts=[[node(x),node(y)]],dir=rnd()*4|0,legs=strong?3+(rnd()*3|0):5+(rnd()*6|0),len=0;
    for(var i=0;i<legs;i++){
      dir=(dir+(rnd()<.5?1:3))%4;
      var cells=2+(rnd()*5|0),p=pts[pts.length-1],dx=[1,0,-1,0][dir],dy=[0,1,0,-1][dir];
      pts.push([p[0]+dx*cells*GRID,p[1]+dy*cells*GRID]);len+=cells*GRID;
    }
    PULSES.push({pts:pts,len:len,d:0,v:strong?420:150+rnd()*90,trail:strong?150:110,a:strong?.85:.42});
  }
  function at(p,d){
    for(var i=1;i<p.pts.length;i++){var a=p.pts[i-1],b=p.pts[i],l=Math.abs(b[0]-a[0])+Math.abs(b[1]-a[1]);if(d<=l){var t=d/l;return [a[0]+(b[0]-a[0])*t,a[1]+(b[1]-a[1])*t,i]}d-=l}
    var e=p.pts[p.pts.length-1];return [e[0],e[1],p.pts.length];
  }
  /* the current never crosses a heading or its lead line (D06: a dot never cuts a letter): it is drawn clipped around them */
  var TEXT=$$('.hello,h1,h2,.lede,.s-sub');
  function drawPulses(dt){
    ctx.lineWidth=1;
    ctx.save();ctx.beginPath();ctx.rect(0,0,W,H);
    for(var r=0;r<TEXT.length;r++){var b=TEXT[r].getBoundingClientRect();if(b.bottom>-8&&b.top<H+8&&b.width)ctx.rect(b.left-8,b.top-8,b.width+16,b.height+16)}
    ctx.clip('evenodd');
    for(var k=PULSES.length-1;k>=0;k--){
      var p=PULSES[k];p.d+=p.v*dt;
      if(p.d-p.trail>p.len){PULSES.splice(k,1);continue}
      var head=Math.min(p.d,p.len),tail=Math.max(0,p.d-p.trail),steps=6;
      for(var s=0;s<steps;s++){
        var d0=tail+(head-tail)*s/steps,d1=tail+(head-tail)*(s+1)/steps,A=at(p,d0),B=at(p,d1);
        ctx.strokeStyle='rgba('+GLOWC+','+(p.a*(s+1)/steps).toFixed(3)+')';
        ctx.beginPath();ctx.moveTo(A[0],A[1]);
        for(var i=A[2];i<B[2];i++)ctx.lineTo(p.pts[i][0],p.pts[i][1]);
        ctx.lineTo(B[0],B[1]);ctx.stroke();
      }
      if(p.d<p.len){var h=at(p,head);ctx.fillStyle='rgba('+CORE+','+p.a+')';ctx.fillRect(h[0]-1.5,h[1]-1.5,3,3)}
    }
    ctx.restore();
  }

  /* ---- lightning: midpoint displacement with a few branches ---- */
  function strike(x1,y1,clicked){
    var y0=-20,sy=0,x0=x1+(rnd()-.5)*W*.12,segs=[];
    (function sub(ax,ay,bx,by,dis,w,depth){
      if(dis<2.5){segs.push([ax,ay+sy,bx,by+sy,w]);return}
      var mx=(ax+bx)/2+(rnd()-.5)*dis,my=(ay+by)/2+(rnd()-.5)*dis*.3;
      sub(ax,ay,mx,my,dis/2,w,depth);sub(mx,my,bx,by,dis/2,w,depth);
      if(depth<2&&dis>14&&rnd()<.22){var ang=Math.atan2(by-ay,bx-ax)+(rnd()<.5?-1:1)*(.35+rnd()*.5),l=dis*(1.4+rnd());sub(mx,my,mx+Math.cos(ang)*l,my+Math.sin(ang)*l,dis/2,w*.45,depth+1)}
    })(x0,y0,x1,y1,Math.hypot(x1-x0,y1-y0)*.3,1,0);
    var k=clicked?1:.45+.55*TA;
    var paths=[1,.45,.2025].map(function(w){var p=new Path2D();segs.forEach(function(s){if(Math.abs(s[4]-w)<=.01){p.moveTo(s[0],s[1]);p.lineTo(s[2],s[3])}});return p});
    BOLTS.push({paths:paths,age:0,k:k});
    GLOWS.push({x:x1,y:y1+sy,life:k});
    for(var i=0;i<(k>.9?4:2);i++)pulse(x1,y1,true);
    if(!small&&heroH1&&hero.getBoundingClientRect().bottom>H*.3){heroH1.classList.add('flash');setTimeout(function(){heroH1.classList.remove('flash')},200)}
  }
  function intensity(a){return a<.05?1:a<.1?.25:a<.17?.9:Math.max(0,1-(a-.17)/.45)}
  function drawBolts(dt){
    if(!LIGHT)ctx.globalCompositeOperation='lighter';
    for(var g=GLOWS.length-1;g>=0;g--){
      var G=GLOWS[g];G.life-=dt/1.1;if(G.life<=0){GLOWS.splice(g,1);continue}
      var gy=G.y,rad=small?150:240,grd=ctx.createRadialGradient(G.x,gy,0,G.x,gy,rad);
      grd.addColorStop(0,'rgba('+GLOWC+','+(.22*G.life*G.life).toFixed(3)+')');grd.addColorStop(1,'rgba('+GLOWC+',0)');
      ctx.fillStyle=grd;ctx.fillRect(G.x-rad,gy-rad,rad*2,rad*2);
    }
    ctx.lineCap='round';
    for(var b=BOLTS.length-1;b>=0;b--){
      var B=BOLTS[b];B.age+=dt;var I=intensity(B.age)*B.k;if(B.age>.65){BOLTS.splice(b,1);continue}
      if(b===BOLTS.length-1&&!LIGHT&&!small&&B.k>.9){ctx.fillStyle='rgba('+GLOWC+','+(.035*I).toFixed(3)+')';ctx.fillRect(0,0,W,H)}
      /* phones draw two passes (glow, core) instead of three: the same bolt at half the strokes */
      var passes=small?[[6,'rgba('+GLOWC+','+(.3*I).toFixed(3)+')'],[1.6,'rgba('+CORE+','+(.95*I).toFixed(3)+')']]
        :[[10,'rgba('+GLOWC+','+(.12*I).toFixed(3)+')'],[3.4,'rgba('+GLOWC+','+(.5*I).toFixed(3)+')'],[1.5,'rgba('+CORE+','+(.95*I).toFixed(3)+')']];
      for(var q=0;q<passes.length;q++){
        ctx.strokeStyle=passes[q][1];
        for(var w=0;w<3;w++){ctx.lineWidth=passes[q][0]*[1,.45,.2025][w];ctx.stroke(B.paths[w])}
      }
    }
    ctx.globalCompositeOperation='source-over';
  }

  /* ---- each theme's own scene (owner, 2026-10-26: "instead of the lightning it can be something else"; "we don't have
     to keep the particles, it can be a completely different animation") ----
     Mono keeps the particle terrain and its lightning. Every other on-sale theme draws its own scene on the same canvas,
     in its own --particle and --glow, by the same rules (guideline D08): full under the hero and the closing, faint
     between, one event every 6-12 seconds or where you click, a still frame under reduced motion, fewer pieces on a
     phone, nothing blurred. A theme not named here (the archived ones) keeps the terrain. */
  var SCENE_OF={paper:'ink',cotton:'ink',nile:'river',papyrus:'river',garnet:'embers',frost:'snow',dendera:'stars',meadow:'meadow'};
  function scene(){return SCENE_OF[root.dataset.theme]||'terrain'}
  var SC=null,SCN='';
  function rgba(c,a){return 'rgba('+c+','+(a<0?0:a>1?1:a).toFixed(3)+')'}
  function band(a,y){return y<a.fa?1:Math.max(0,1-(y-a.fa)/(a.fb-a.fa))} // fades out toward the reading area
  function buildScene(){
    SCN=scene();var n,i,j;SC={};
    if(SCN==='ink'){SC.lines=small?14:22;SC.step=small?16:12}
    else if(SCN==='river'){SC.rows=[];n=small?16:26;for(j=0;j<n;j++){var d=[],m=8+j*(small?1.4:2.2)|0;for(i=0;i<m;i++)d.push([rnd(),rnd()*6.283,.5+rnd()]);SC.rows.push(d)}SC.mx=.68}
    else if(SCN==='embers'){SC.e=[];for(i=0,n=small?70:170;i<n;i++)SC.e.push(ember(true))}
    else if(SCN==='snow'){SC.f=[];for(i=0,n=small?70:170;i<n;i++)SC.f.push([rnd(),rnd(),i%3,rnd()*6.283,.6+rnd()*.8])}
    else if(SCN==='stars'){SC.gap=small?44:56;SC.tw=[];for(i=0;i<400;i++)SC.tw.push([rnd()*6.283,4+rnd()*5]);
      var st=new Path2D(),r1=small?3.2:3.8,r0=r1*.42;for(i=0;i<10;i++){var ang=-Math.PI/2+i*Math.PI/5,rr=i%2?r0:r1;i?st.lineTo(Math.cos(ang)*rr,Math.sin(ang)*rr):st.moveTo(Math.cos(ang)*rr,Math.sin(ang)*rr)}st.closePath();SC.star=st;SC.sweep=[]}
    else if(SCN==='meadow'){SC.g=[];for(i=0,n=small?110:260;i<n;i++)SC.g.push([rnd(),.45+rnd()*.55,rnd()*6.283,i%2]);SC.ff=[];for(i=0,n=small?22:54;i<n;i++)SC.ff.push([rnd(),rnd(),rnd()*6.283,.5+rnd()*.8,rnd()*6.283]);SC.gust=-1}
  }
  function ember(fresh){return {x:rnd(),y:fresh?rnd():1,v:.05+rnd()*.1,s:1.6+rnd()*2.2,ph:rnd()*6.283,w:.4+rnd()*.8}}

  /* ink (Paper, Cotton): contour lines of a slow hand-drawn landscape; a drop of ink lands and its rings push the lines */
  function drawInk(a,t){
    var L=SC.lines,st=SC.step;ctx.lineWidth=1;
    for(var i=0;i<L;i++){
      var q=i/(L-1),y0=a.hz+(a.fb-a.hz)*Math.pow(q,1.25),amp=8+q*22,al=(.16+.5*(1-q))*band(a,y0)*TA;
      if(al<.01)continue;ctx.strokeStyle=rgba(PART,al);ctx.beginPath();
      for(var x=-st;x<=W+st;x+=st){
        var y=y0+Math.sin(x*.005+i*.7+t*.13)*amp*.6+Math.sin(x*.013-t*.09+i*1.9)*amp*.25-Math.exp(-Math.pow((x-W*(.55+.2*Math.sin(t*.03)))/(W*.16),2))*amp*1.2;
        for(var r=0;r<RINGS.length;r++){var R=RINGS[r];if(R.age<=0)continue;var dx=x-R.x,dy=(y-R.y)*2.6,d=Math.sqrt(dx*dx+dy*dy)-R.age*(small?150:240);if(d>-50&&d<50)y-=9*R.k*(1-R.age/2.4)*Math.exp(-d*d/(2*16*16))}
        x<=-st?ctx.moveTo(x,y):ctx.lineTo(x,y);
      }
      ctx.stroke();
    }
  }
  /* river (Nile, Papyrus): stars over the water, the current drifting in dashes, and a gold road of light under the moon */
  function drawRiver(a,t,dt){
    var mx=W*SC.mx,my=Math.max(a.top+70,a.hz*.55),rows=SC.rows;
    ctx.fillStyle='rgb('+PART+')';
    for(var s=0;s<STARS.length;s++){var S=STARS[s],sy=S[1]*a.hz;ctx.globalAlpha=(reduce?.45:.25+.35*Math.sin(t*S[3]+S[2]))*TA;ctx.fillRect(S[0]*W,sy,1.3,1.3)}
    ctx.globalAlpha=1;ctx.fillStyle=rgba(GLOWC,.85*TA);ctx.beginPath();ctx.arc(mx,my,small?9:13,0,6.283);ctx.fill();
    ctx.fillStyle=rgba(GLOWC,.12*TA);ctx.beginPath();ctx.arc(mx,my,small?18:26,0,6.283);ctx.fill();
    for(var j=0;j<rows.length;j++){
      var q=j/(rows.length-1),y=a.hz+4+(a.fb-a.hz)*Math.pow(q,1.6),f=band(a,y)*TA,len=4+q*30,road=W*(.03+q*.11),speed=8+q*40;if(f<.01)continue;
      for(var k=0;k<rows[j].length;k++){var D=rows[j][k],x=((D[0]*W+t*speed*D[2])%(W+60))-30,on=Math.abs(x-mx)<road,
        sh=reduce?.6:.5+.5*Math.sin(t*1.6*D[2]+D[1]);
        ctx.fillStyle=on?rgba(GLOWC,(.35+.6*sh)*f):rgba(PART,(.08+.3*sh)*(1-q*.3)*f);ctx.fillRect(x,y,len*(on?1.3:1),q>.5?2:1.2)}
    }
  }
  /* embers (Garnet): sparks rise from a low glow and drift out; now and then a log settles and throws a burst */
  function drawEmbers(a,t,dt){
    var g=ctx.createLinearGradient(0,a.fb,0,a.hz);g.addColorStop(0,rgba(GLOWC,0));g.addColorStop(.35,rgba(GLOWC,.13*TA));g.addColorStop(1,rgba(GLOWC,0));ctx.fillStyle=g;ctx.fillRect(0,a.hz,W,a.fb-a.hz);
    var top=a.top+30,span=a.fb-top;
    for(var i=0;i<SC.e.length;i++){var E=SC.e[i];
      if(!reduce){E.y-=E.v*dt*E.w;if(E.y<0)SC.e[i]=E=ember(false)}
      var x=(E.x+Math.sin(t*E.w+E.ph)*.012)*W,y=top+E.y*span,life=E.y,al=Math.min(1,1.2*Math.pow(life,.7)*(.6+.4*Math.sin(t*6*E.w+E.ph)))*TA;
      ctx.fillStyle=rgba(life>.85?CORE:GLOWC,al);ctx.fillRect(x,y,E.s,E.s)}
  }
  /* snow (Frost): three depths of flakes falling slowly, swaying; an aurora opens over the horizon now and then */
  function drawSnow(a,t,dt){
    var top=a.top+20,span=a.fb-top;
    for(var i=0;i<SC.f.length;i++){var F=SC.f[i],layer=F[2],sp=[.018,.03,.05][layer],sz=[1.2,1.8,2.6][layer];
      if(!reduce){F[1]+=sp*dt*F[4];if(F[1]>1){F[1]=0;F[0]=rnd()}}
      var x=(F[0]+Math.sin(t*.5*F[4]+F[3])*.01*(layer+1))*W,y=top+F[1]*span;
      ctx.fillStyle=rgba(PART,(.18+layer*.16)*band(a,y)*TA);ctx.fillRect(x,y,sz,sz)}
  }
  /* stars (Dendera): the temple ceiling's rows of five-pointed stars, each breathing on its own; a pigment light walks a row */
  function drawStars(a,t,dt){
    var gap=SC.gap,top=a.top+gap*.9,rows=Math.max(1,Math.floor((a.fb-top)/gap)),cols=Math.ceil(W/gap)+1,n=0;
    for(var r=0;r<=rows;r++){var y=top+r*gap,f=band(a,y)*TA;if(f<.01)continue;
      for(var c=0;c<cols;c++){var x=c*gap+(r%2?gap/2:0)-gap/4,T=SC.tw[n++%SC.tw.length],tw=reduce?.7:.55+.45*Math.sin(t*6.283/T[1]+T[0]),lit=0;
        for(var w=0;w<SC.sweep.length;w++){var P=SC.sweep[w];if(P.row===r){var dx=x-P.x;lit=Math.max(lit,P.k*Math.exp(-dx*dx/(2*70*70)))}}
        ctx.save();ctx.translate(x,y);if(lit>.05)ctx.scale(1+lit*.5,1+lit*.5);ctx.fillStyle=lit>.05?rgba(GLOWC,(.35+.65*lit)*f):rgba(PART,(.12+.3*tw)*f);ctx.fill(SC.star);ctx.restore()}}
    for(var k=SC.sweep.length-1;k>=0;k--){var S=SC.sweep[k];S.x+=dt*W/2.6;if(S.x>W+120)SC.sweep.splice(k,1)}
  }
  /* meadow (Meadow): tall grass bending in the wind, fireflies blinking over it; far off, Lightning's own lightning */
  function drawMeadow(a,t,dt){
    var base=a.fb-(a.fb-a.fa)*.35,G=SC.g;ctx.lineWidth=1;
    if(SC.gust>=0){SC.gust+=dt;if(SC.gust>3)SC.gust=-1}
    for(var i=0;i<G.length;i++){var B=G[i],x=B[0]*W,h=(small?34:58)*B[1]*(B[3]?.7:1),gx=SC.gust<0?0:Math.exp(-Math.pow(x-SC.gust*W/2.2,2)/(2*90*90)),
      lean=(Math.sin(t*.7+x*.004+B[2])*.22+.12+gx*.9)*h,y=base-(B[3]?10:0);
      ctx.strokeStyle=rgba(PART,(B[3]?.22:.42)*TA);ctx.beginPath();ctx.moveTo(x,y);ctx.quadraticCurveTo(x+lean*.3,y-h*.6,x+lean,y-h);ctx.stroke()}
    if(!LIGHT)ctx.globalCompositeOperation='lighter';
    var top=a.hz,span=base-a.hz-10;
    for(var j=0;j<SC.ff.length;j++){var F=SC.ff[j],x2=(F[0]+Math.sin(t*.13*F[3]+F[2])*.04)*W,y2=top+(F[1]+Math.sin(t*.21*F[3]+F[4])*.08)*span,
      blink=reduce?.6:Math.pow(Math.max(0,Math.sin(t*F[3]*1.3+F[4])),3),al=(.25+.75*blink)*band(a,y2)*TA;
      ctx.fillStyle=rgba(GLOWC,al*.22);ctx.fillRect(x2-4,y2-4,10.5,10.5);ctx.fillStyle=rgba(GLOWC,al);ctx.fillRect(x2,y2,2.6,2.6)}
    ctx.globalCompositeOperation='source-over';
  }
  var DRAW={ink:drawInk,river:drawRiver,embers:drawEmbers,snow:drawSnow,stars:drawStars,meadow:drawMeadow};

  /* the event: a strike on Mono and Meadow (and any theme without a scene), and each scene's own on the others */
  function weather(x,y,clicked){
    var f=scene(),k=clicked?1:.45+.55*TA;
    if(f==='terrain'||f==='meadow'){strike(x,y,clicked);if(f==='meadow'&&SC)SC.gust=0;return}
    if(f==='ink'){RINGS.push({x:x,y:y,age:0,k:k},{x:x,y:y,age:-.35,k:k*.6})}
    else if(f==='river'){var dir=rnd()<.5?-1:1;TRAILS.push({x0:x-dir*W*(small?.45:.3),y0:-10,x1:x,y1:y,age:0,dur:small?.75:.95,k:k,landed:false})}
    else if(f==='embers'){for(var i=0,n=small?18:40;i<n;i++)SPARKS.push({x:x+(rnd()-.5)*60,y:y,vx:(rnd()-.5)*70,vy:-(45+rnd()*120),age:-rnd()*.4,life:1.8+rnd()*1.8,s:1.6+rnd()*2.2,ph:rnd()*6.283,k:k});GLOWS.push({x:x,y:y,life:k*.7})}
    else if(f==='snow')CURTAINS.push({x:x,age:0,dur:5,k:k,ph:rnd()*6.283});
    else if(f==='stars'&&SC){var gap=SC.gap,top=anchor().top+gap*.9;SC.sweep.push({row:Math.max(0,Math.round((y-top)/gap)),x:-120,k:k})}
    pulse(x,y,true);
  }
  /* the pieces an event leaves behind: ink rings, the shooting star, ember bursts and the aurora */
  function drawWeather(dt,a){
    for(var r=RINGS.length-1;r>=0;r--){var R=RINGS[r];R.age+=dt;if(R.age>2.4){RINGS.splice(r,1);continue}
      if(R.age>0){var life=1-R.age/2.4,rad=R.age*(small?150:240);ctx.strokeStyle=rgba(GLOWC,.5*R.k*life*life);ctx.lineWidth=1.2;
        ctx.beginPath();ctx.ellipse(R.x,R.y,rad,rad/2.6,0,0,6.283);ctx.stroke()}}
    if(!TRAILS.length&&!SPARKS.length&&!CURTAINS.length)return;
    if(!LIGHT)ctx.globalCompositeOperation='lighter';
    for(var t=TRAILS.length-1;t>=0;t--){
      var T=TRAILS[t];T.age+=dt;var p=Math.min(1,T.age/T.dur),e=1-Math.pow(1-p,2.2),fade=T.age>T.dur?Math.max(0,1-(T.age-T.dur)/.45):1;
      if(fade<=0){TRAILS.splice(t,1);continue}
      if(p>=1&&!T.landed){T.landed=true;RINGS.push({x:T.x1,y:T.y1,age:0,k:T.k*.7})}
      var hx=T.x0+(T.x1-T.x0)*e,hy=T.y0+(T.y1-T.y0)*e,q=Math.max(0,e-.28),tx=T.x0+(T.x1-T.x0)*q,ty=T.y0+(T.y1-T.y0)*q;
      var g=ctx.createLinearGradient(tx,ty,hx,hy);g.addColorStop(0,rgba(GLOWC,0));g.addColorStop(1,rgba(GLOWC,.85*T.k*fade));
      ctx.strokeStyle=g;ctx.lineCap='round';ctx.lineWidth=small?1.6:2.2;ctx.beginPath();ctx.moveTo(tx,ty);ctx.lineTo(hx,hy);ctx.stroke();
      if(p<1){ctx.fillStyle=rgba(CORE,.95*T.k);ctx.fillRect(hx-1.5,hy-1.5,3,3)}
    }
    for(var i=SPARKS.length-1;i>=0;i--){
      var S=SPARKS[i];S.age+=dt;if(S.age<0)continue;if(S.age>S.life){SPARKS.splice(i,1);continue}
      S.vy*=1-dt*.35;S.x+=(S.vx+Math.sin(S.age*3+S.ph)*14)*dt;S.y+=S.vy*dt;
      ctx.fillStyle=rgba(S.age<.3?CORE:GLOWC,1.25*S.k*Math.pow(1-S.age/S.life,1.1)*(.7+.3*Math.sin(S.age*18+S.ph)));ctx.fillRect(S.x,S.y,S.s,S.s);
    }
    for(var c=CURTAINS.length-1;c>=0;c--){
      var C=CURTAINS[c];C.age+=dt;if(C.age>C.dur){CURTAINS.splice(c,1);continue}
      var env=Math.sin(Math.PI*C.age/C.dur),span=W*(small?.95:.65),n=small?60:140,top=Math.max(0,a.hz-H*.17),gr=ctx.createLinearGradient(0,a.hz+6,0,top);
      gr.addColorStop(0,rgba(GLOWC,.5));gr.addColorStop(.35,rgba(GLOWC,.22));gr.addColorStop(1,rgba(GLOWC,0));ctx.fillStyle=gr;
      var sw=span/n*2.2;
      for(var j=0;j<n;j++){var u=j/(n-1),edge=Math.pow(Math.max(0,1-Math.abs(u-.5)*2),.9),
        sx=C.x-span/2+u*span+Math.sin(u*4+C.age*.6+C.ph)*18,base=a.hz+Math.sin(u*5+C.age*.8+C.ph)*10,
        h=(a.hz-top)*(.3+.7*(.5+.5*Math.sin(u*4.5+C.age*.7+C.ph))*(.65+.35*Math.sin(u*19+C.age*1.6)));
        ctx.globalAlpha=Math.min(1,env*edge*C.k*(LIGHT?.32:.5)*TA);ctx.fillRect(sx,base-h,sw,h)}
      ctx.globalAlpha=1;
    }
    ctx.globalCompositeOperation='source-over';
  }

  /* ---- the terrain ---- */
  function drawTerrain(a,t){
    var ease=1-Math.pow(1-intro,3),f=Math.max(W,H*1.2)*.62,camY=1.55,spread=W/f*1.25;
    if(a.hz>-H*.5&&a.top<H){
      ctx.fillStyle='rgb('+PART+')';
      for(var s=0;s<STARS.length;s++){var st=STARS[s],sy=a.top+st[1]*(a.hz-a.top);if(sy<0||sy>H)continue;ctx.globalAlpha=(reduce?.4:(.2+.3*Math.sin(t*st[3]+st[2])))*ease*TA;ctx.fillRect(st[0]*W,sy,1.2,1.2)}
    }
    var g0=GLOWS[0],g1=GLOWS[1];
    for(var i=0;i<N;i++){
      var z=Z[i],X=(U[i]-.5)*z*spread;
      var hgt=(.55*Math.sin(X*.26+t*.16+SEED[i]*.05)*Math.cos(z*.17-t*.1)
            +.32*Math.sin((X*.55+z*.8)*.36+t*.27)
            +.75*Math.exp(-Math.pow(X-2.4-Math.sin(z*.19+t*.06)*4.2,2)/5)
            +.45*Math.exp(-Math.pow(X+6-Math.cos(z*.15)*3,2)/9))*ease;
      var x=W/2+X*f/z,y=a.hz+(camY-hgt)*f/z;
      if(y>a.fb||y<-4||y>H+4||x<-4||x>W+4){pa[i]=0;continue}
      var fade=y<a.fa?1:1-(y-a.fa)/(a.fb-a.fa),depth=1-z/35.6,bright=Math.min(1,Math.max(0,(hgt+.5)/1.7));
      var al=Math.pow(depth,.7)*(.1+.9*Math.pow(bright,1.4))*fade*(.35+.65*ease)*TA;
      if(g0){var gy=g0.y,dx=x-g0.x,dy=y-gy;al+=g0.life*Math.exp(-(dx*dx+dy*dy*2)/(2*170*170))*fade}
      if(g1){var gy1=g1.y,dx1=x-g1.x,dy1=y-gy1;al+=g1.life*Math.exp(-(dx1*dx1+dy1*dy1*2)/(2*170*170))*fade}
      px[i]=x;py[i]=y;pa[i]=Math.min(1,al);ps[i]=1.05+depth*1.3;
    }
    /* one pass: sort the visible dots into seven brightness buckets, then draw each bucket with one alpha */
    CNT.fill(0);var M=0;
    for(var j=0;j<N;j++){var aj=pa[j];if(aj<.015){BI[j]=255;continue}var bk=Math.min(BK-1,aj*BK|0);BI[j]=bk;CNT[bk+1]++;M++}
    for(var q=1;q<=BK;q++)CNT[q]+=CNT[q-1];
    var start=CNT.slice(0,BK);
    for(j=0;j<N;j++){var bb=BI[j];if(bb!==255)ORD[start[bb]++]=j}
    ctx.fillStyle='rgb('+PART+')';
    for(var b2=0;b2<BK;b2++){
      if(CNT[b2+1]===CNT[b2])continue;ctx.globalAlpha=(b2+.6)/BK;
      for(var o=CNT[b2];o<CNT[b2+1];o++){var n=ORD[o];ctx.fillRect(px[n],py[n],ps[n],ps[n])}
    }
    ctx.globalAlpha=1;
  }

  var intro=reduce?1:0,t0=performance.now(),last=t0,nextStrike=2.6,nextPulse=1;
  function frame(now){
    var t=(now-t0)/1000,dt=Math.min(.05,Math.max(0,(now-last)/1000));last=now;
    ctx.clearRect(0,0,W,H);
    var a=anchor(),tt=targetTA();
    TA=reduce?tt:TA+(tt-TA)*(1-Math.exp(-dt*1.6));
    if(!reduce){
      intro=Math.min(1,intro+dt*.7);
      if(t>nextPulse){if(PULSES.length<5)pulse(rnd()*W,rnd()*H,false);nextPulse=t+.9+rnd()*1.1}
      if(t>nextStrike){weather(W*(.08+rnd()*.84),a.hz+(a.fa-a.hz)*(.15+rnd()*.5));nextStrike=t+6+rnd()*6}
      drawPulses(dt);
    }
    if(SCN!==scene())buildScene();
    if(DRAW[SCN])DRAW[SCN](a,reduce?4:t,reduce?0:dt);else drawTerrain(a,reduce?4:t);
    if(!reduce){drawBolts(dt);drawWeather(dt,a)}
  }

  /* click any empty space for the weather */
  if(!reduce)[$('#main')].forEach(function(sec){
    sec.addEventListener('click',function(e){
      if(e.target.closest('a,button,input,label,h1,h2,h3,p,li,pre,code,.meta,.term,.card,.stats,.steps,.clone,.tags,.track,.lane')||String(getSelection()))return;
      var a=anchor();weather(e.clientX,Math.min(Math.max(e.clientY,a.hz+(a.fa-a.hz)*.3),a.fa),true);nextStrike=Math.max(nextStrike,(performance.now()-t0)/1000+4);
    });
  });

  window.LG.scene=scene;
  var raf=0;
  function loop(now){frame(now);raf=requestAnimationFrame(loop)}
  function start(){readColors();build();buildScene();if(reduce){frame(performance.now())}else{cancelAnimationFrame(raf);raf=requestAnimationFrame(loop)}}
  /* rebuild only when the width changes: on phones the address bar showing or hiding changes the height while you scroll,
     and rebuilding then threw new dots on screen mid-scroll */
  var rt,BW=0;addEventListener('resize',function(){if(innerWidth===BW)return;clearTimeout(rt);rt=setTimeout(start,150)});
  if(reduce)addEventListener('scroll',function(){requestAnimationFrame(frame)},{passive:true});
  start();
})();
