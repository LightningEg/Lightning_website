/* For Geeks: the two true motion moments (guideline D07 .balance, .cipher; D08).
   Each plays once, the first time it is seen, in under 4 seconds, and never loops. Without this script or with
   reduced motion the page shows both ends as written: the balanced and the refused posting, the row above its bytes.
   The lines, figures and error text are lightning/core/ledger.py's validate_posting; the hex is illustrative. */
(function(){
  'use strict';
  var reduce=matchMedia('(prefers-reduced-motion: reduce)').matches;
  if(reduce||!('IntersectionObserver' in window))return;
  function once(el,play){
    if(!el)return;
    var io=new IntersectionObserver(function(es){if(!es[0].isIntersecting)return;io.disconnect();setTimeout(play,250)},{threshold:.6});
    io.observe(el);
  }

  /* a posting that must balance: line one, the net goes off zero, line two, the net comes back to 0.00 and it posts;
     then a one-sided line, the net stays at -450.00 and validate_posting's own error refuses it */
  var bal=document.getElementById('balance');
  if(bal){
    var net=bal.querySelector('[data-post=ok] .b-net b'),end=net.textContent;
    bal.classList.add('armed');net.textContent='-450.00';
    once(bal,function(){
      var steps=[[0,function(){bal.classList.add('s1')}],
                 [650,function(){bal.classList.add('s2');net.textContent=end}],
                 [1100,function(){bal.classList.add('s3')}],
                 [1900,function(){bal.classList.add('s4')}],
                 [2600,function(){bal.classList.add('s5')}]];
      steps.forEach(function(s){setTimeout(s[1],s[0])});
    });
  }

  /* a row becomes ciphertext: the line under the row turns into hex a few characters at a time; the row stays put */
  var disk=document.getElementById('cipher-disk'),row=document.querySelector('#cipher .c-row');
  if(disk&&row){
    var plain=row.textContent,NOISE='01<>/\\{}[]#$%&*+=_';
    var bytes=new Uint8Array(26);(window.crypto||{getRandomValues:function(a){for(var i=0;i<a.length;i++)a[i]=Math.random()*256|0;return a}}).getRandomValues(bytes);
    var hex='';for(var i=0;i<bytes.length;i++){hex+=(bytes[i]<16?'0':'')+bytes[i].toString(16)+(i%2&&i<bytes.length-1?' ':'')}
    disk.textContent=plain;
    once(row,function(){
      var len=Math.max(plain.length,hex.length),frame=0,total=40;
      (function tick(){
        var out='';
        for(var i=0;i<len;i++){
          var settle=total*(i+1)/len,start=settle-8;
          if(frame>=settle)out+=hex[i]||'';
          else if(frame>=start)out+=NOISE[Math.random()*NOISE.length|0];
          else out+=plain[i]||'';
        }
        disk.textContent=out;frame++;
        if(frame<=total)setTimeout(tick,40);else disk.textContent=hex;
      })();
    });
  }
})();
