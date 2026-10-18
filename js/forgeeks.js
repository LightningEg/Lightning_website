/* For Geeks: shared by forgeeks.html and forgeeks-roadmap.html. Themes, top bar, rail, reveal, and the field with its lightning. */
(function(){
  'use strict';
  // Keep links to the former home-page contribution section working.
  if(location.pathname.endsWith('/forgeeks.html') && location.hash==='#build'){
    location.replace('forgeeks-roadmap.html#build');
    return;
  }
  var doc=document,root=doc.documentElement;
  doc.body.classList.remove('no-js');
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  var $=function(s){return doc.querySelector(s)},$$=function(s){return [].slice.call(doc.querySelectorAll(s))};
  var fmt=function(n){return Math.round(n).toLocaleString('en-US')};
  var toastEl=$('#toast'),toastT;
  function toast(msg){toastEl.textContent=msg;toastEl.classList.add('on');clearTimeout(toastT);toastT=setTimeout(function(){toastEl.classList.remove('on')},1800)}
  function copy(text){
    var done=function(){toast('copied to clipboard')};
    if(navigator.clipboard&&navigator.clipboard.writeText){navigator.clipboard.writeText(text).then(done,fallback)}else fallback();
    function fallback(){var t=doc.createElement('textarea');t.value=text;doc.body.appendChild(t);t.select();try{doc.execCommand('copy');done()}catch(_){toast('copy failed')}t.remove()}
  }
  $$('[data-copy]').forEach(function(b){b.addEventListener('click',function(){copy(b.dataset.copy)})});

  /* ===================== themes: a window in the middle of the screen ===================== */
  var THEMES=[
    {id:'mono',name:'Mono',note:'white on black, the default',c:['#0a0a0a','#f2f2f2','#b8b8b8','#ffffff']},
    {id:'paper',name:'Paper',note:'light, for daylight reading',c:['#f4f1ea','#161616','#45413a','#a8401c']},
    {id:'meadow',name:'Meadow',note:'Lightning\'s own: night blue and green',c:['#08192A','#EAF4F1','#B8CAD2','#3FCB93']},
    {id:'nile',name:'Nile',note:'night blue and gold',c:['#070b16','#e9edf7','#b7c0d8','#e6b450']},
    {id:'ocean',name:'Ocean',note:'deep sea, cyan and mint',c:['#04121a','#dff6ff','#9fc9d9','#38c9f0']},
    {id:'tokyo',name:'Tokyo',note:'cool blue and violet',c:['#13141c','#c0caf5','#aab2d8','#7aa2f7']},
    {id:'dracula',name:'Dracula',note:'purple and pink',c:['#191a21','#f8f8f2','#c6cae4','#bd93f9']},
    {id:'rose',name:'Rose',note:'dusk pink and peach',c:['#140a10','#ffe4ee','#dcaabe','#ff6fa0']},
    {id:'synthwave',name:'Synthwave',note:'neon magenta and cyan',c:['#12061f','#f6e9ff','#c6a9df','#ff3ea5']},
    {id:'phosphor',name:'Phosphor',note:'green CRT glow',c:['#040a06','#d8ffe4','#a8d6b6','#39ff88']},
    {id:'amber',name:'Amber',note:'old terminal, warm',c:['#0c0803','#ffe7c2','#dcb98a','#ffb000']},
    {id:'solarized',name:'Solarized',note:'the classic, gold and teal',c:['#002b36','#eee8d5','#aab9b8','#d4a017']}
  ];
  var btn=$('#theme-btn'),tm=$('#themes'),grid=$('#theme-list'),nameEl=$('#theme-name'),meta=doc.querySelector('meta[name="theme-color"]');
  var saved=root.dataset.theme||'mono',cursor=0,listeners=[],lastFocus=null;
  if(!THEMES.some(function(t){return t.id===saved}))saved='mono';
  function onTheme(fn){listeners.push(fn)}
  function apply(id){
    if(id==='mono')delete root.dataset.theme;else root.dataset.theme=id;
    var t=THEMES.filter(function(x){return x.id===id})[0];
    if(nameEl)nameEl.textContent=id;if(meta)meta.setAttribute('content',t.c[0]);
    listeners.forEach(function(fn){fn(id)});
  }
  function keep(id){saved=id;apply(id);try{localStorage.setItem('lightning-geeks-theme',id)}catch(_){}}
  THEMES.forEach(function(t,i){
    var o=doc.createElement('div');o.className='tm-card';o.setAttribute('role','option');o.id='th-'+t.id;o.dataset.id=t.id;
    o.innerHTML='<div class="tm-pv" style="background:'+t.c[0]+';color:'+t.c[1]+'" aria-hidden="true"><i style="width:72%;background:'+t.c[1]+'"></i><i style="width:52%;background:'+t.c[2]+';opacity:.85"></i><i style="width:34%;background:'+t.c[3]+'"></i><b style="background:'+t.c[3]+'"></b></div>'
      +'<div class="tm-name">'+t.name+'<span aria-hidden="true">✓ in use</span></div><p class="tm-note">'+t.note+'</p>';
    o.addEventListener('mouseenter',function(){move(i,true)});
    o.addEventListener('click',function(){keep(t.id);close()});
    grid.appendChild(o);
  });
  function cols(){return innerWidth<=640?2:3}
  function move(i,noScroll){
    cursor=Math.max(0,Math.min(THEMES.length-1,i));
    [].forEach.call(grid.children,function(c,k){c.classList.toggle('cur',k===cursor)});
    grid.setAttribute('aria-activedescendant','th-'+THEMES[cursor].id);
    if(!noScroll)grid.children[cursor].scrollIntoView({block:'nearest'});
    apply(THEMES[cursor].id);
  }
  function open(){
    lastFocus=doc.activeElement;
    [].forEach.call(grid.children,function(c){c.setAttribute('aria-selected',String(c.dataset.id===saved))});
    tm.hidden=false;btn.setAttribute('aria-expanded','true');root.style.overflow='hidden';
    move(THEMES.map(function(t){return t.id}).indexOf(saved));grid.focus();
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
    else if(k==='End'){e.preventDefault();move(THEMES.length-1)}
    else if(k==='Enter'||k===' '){e.preventDefault();keep(THEMES[cursor].id);close()}
  });
  grid.addEventListener('mouseleave',function(){if(!tm.hidden)apply(saved)});
  doc.addEventListener('keydown',function(e){
    var tag=(e.target.tagName||'').toLowerCase();
    if((e.key==='t'||e.key==='T')&&!e.metaKey&&!e.ctrlKey&&!e.altKey&&tag!=='input'&&tag!=='textarea'&&tm.hidden){e.preventDefault();open()}
  });
  apply(saved);

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
    var secObs=new IntersectionObserver(function(es){es.forEach(function(e){if(e.isIntersecting){railLinks.forEach(function(a){a.classList.toggle('on',a.getAttribute('href')==='#'+e.target.id)})}})},{rootMargin:'-45% 0px -50% 0px'});
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
    var io=new IntersectionObserver(function(es){es.forEach(function(e){if(!e.isIntersecting)return;e.target.classList.add('in');$$('[data-count]').forEach(function(c){if(e.target.contains(c)&&!c.dataset.done){c.dataset.done=1;countUp(c)}});io.unobserve(e.target)})},{threshold:.18});
    $$('.reveal').forEach(function(el){io.observe(el)});
  }else $$('.reveal').forEach(function(el){el.classList.add('in')});

  /* card spotlight */
  $$('.card').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px')})});
  /* card spotlight */
  $$('.card').forEach(function(c){c.addEventListener('pointermove',function(e){var r=c.getBoundingClientRect();c.style.setProperty('--mx',(e.clientX-r.left)+'px');c.style.setProperty('--my',(e.clientY-r.top)+'px')})});

  window.LG={THEMES:THEMES,keep:keep,current:function(){return saved},open:open,onTheme:onTheme,copy:copy,toast:toast,reduce:reduce};

  /* ===================== the field: a terrain of light, current in the grid, and lightning =====================
     The terrain stays behind the page, faint between the hero and the closing; a faint current runs through
     the pixel grid now and then. Lightning strikes the terrain every few seconds, or where you click the sky. */
  var cv=$('#field'),ctx=cv.getContext('2d');
  if(!ctx)return;
  var W=0,H=0,DPR=1,N=0,small=false,U,Z,SEED,px,py,pa,ps,BI,ORD,BK=7,CNT=new Int32Array(8);
  var STARS=[],PULSES=[],BOLTS=[],GLOWS=[],GRID=24;
  var PART='242,242,242',GLOWC='255,255,255',CORE='255,255,255',LIGHT=false;
  function readColors(){var cs=getComputedStyle(root);PART=cs.getPropertyValue('--particle').trim()||PART;GLOWC=cs.getPropertyValue('--glow').trim()||GLOWC;LIGHT=root.dataset.theme==='paper';CORE=LIGHT?GLOWC:'255,255,255'}
  onTheme(function(){readColors();if(reduce)frame(performance.now())});
  var hero=$('#top'),closing=$('#closing');
  function rnd(){return Math.random()}

  function build(){
    small=innerWidth<760;
    W=innerWidth;H=Math.max(innerHeight,cv.getBoundingClientRect().height||0);BW=W;
    /* on a 1x PC screen, sub-pixel dots crawl and flicker as they move: draw at 1.5x at least, within about 4.5 million pixels */
    DPR=Math.max(1,Math.min(small?2:1.75,Math.max(devicePixelRatio||1,1.5),Math.sqrt(4.5e6/(W*H))));
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
  function drawPulses(dt){
    ctx.lineWidth=1;
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
  }

  /* ---- lightning: midpoint displacement with a few branches ---- */
  function strike(x1,y1){
    var y0=-20,sy=0,x0=x1+(rnd()-.5)*W*.12,segs=[];
    (function sub(ax,ay,bx,by,dis,w,depth){
      if(dis<2.5){segs.push([ax,ay+sy,bx,by+sy,w]);return}
      var mx=(ax+bx)/2+(rnd()-.5)*dis,my=(ay+by)/2+(rnd()-.5)*dis*.3;
      sub(ax,ay,mx,my,dis/2,w,depth);sub(mx,my,bx,by,dis/2,w,depth);
      if(depth<2&&dis>14&&rnd()<.22){var ang=Math.atan2(by-ay,bx-ax)+(rnd()<.5?-1:1)*(.35+rnd()*.5),l=dis*(1.4+rnd());sub(mx,my,mx+Math.cos(ang)*l,my+Math.sin(ang)*l,dis/2,w*.45,depth+1)}
    })(x0,y0,x1,y1,Math.hypot(x1-x0,y1-y0)*.3,1,0);
    BOLTS.push({segs:segs,age:0});
    GLOWS.push({x:x1,y:y1+sy,life:1});
    for(var i=0;i<4;i++)pulse(x1,y1,true);
    if(hero.getBoundingClientRect().bottom>H*.3){root.classList.add('flash');setTimeout(function(){root.classList.remove('flash')},200)}
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
      var B=BOLTS[b];B.age+=dt;var I=intensity(B.age);if(B.age>.65){BOLTS.splice(b,1);continue}
      if(b===BOLTS.length-1&&!LIGHT){ctx.fillStyle='rgba('+GLOWC+','+(.035*I).toFixed(3)+')';ctx.fillRect(0,0,W,H)}
      var passes=[[10,'rgba('+GLOWC+','+(.12*I).toFixed(3)+')'],[3.4,'rgba('+GLOWC+','+(.5*I).toFixed(3)+')'],[1.5,'rgba('+CORE+','+(.95*I).toFixed(3)+')']];
      for(var q=0;q<3;q++){
        ctx.strokeStyle=passes[q][1];
        [1,.45,.2025].forEach(function(w){
          ctx.lineWidth=passes[q][0]*w;ctx.beginPath();
          for(var i=0;i<B.segs.length;i++){var s=B.segs[i];if(Math.abs(s[4]-w)>.01)continue;ctx.moveTo(s[0],s[1]);ctx.lineTo(s[2],s[3])}
          ctx.stroke();
        });
      }
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
      if(t>nextStrike){strike(W*(.08+rnd()*.84),a.hz+(a.fa-a.hz)*(.15+rnd()*.5));nextStrike=t+6+rnd()*6}
      drawPulses(dt);
    }
    drawTerrain(a,reduce?4:t);
    if(!reduce)drawBolts(dt);
  }

  /* click any empty space for a strike */
  if(!reduce)[$('#main')].forEach(function(sec){
    sec.addEventListener('click',function(e){
      if(e.target.closest('a,button,input,label,h1,h2,h3,p,li,pre,code,.meta,.term,.card,.stats,.steps,.clone,.tags,.track,.lane')||String(getSelection()))return;
      var a=anchor();strike(e.clientX,Math.min(Math.max(e.clientY,a.hz+(a.fa-a.hz)*.3),a.fa));nextStrike=Math.max(nextStrike,(performance.now()-t0)/1000+4);
    });
  });

  var raf=0;
  function loop(now){frame(now);raf=requestAnimationFrame(loop)}
  function start(){readColors();build();if(reduce){frame(performance.now())}else{cancelAnimationFrame(raf);raf=requestAnimationFrame(loop)}}
  /* rebuild only when the width changes: on phones the address bar showing or hiding changes the height while you scroll,
     and rebuilding then threw new dots on screen mid-scroll */
  var rt,BW=0;addEventListener('resize',function(){if(innerWidth===BW)return;clearTimeout(rt);rt=setTimeout(start,150)});
  if(reduce)addEventListener('scroll',function(){requestAnimationFrame(frame)},{passive:true});
  start();
})();
