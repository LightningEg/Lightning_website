"""Generate main-site account/market surfaces from the shared, tested community forms.
Run after changing forgeeks-account.html or forgeeks-market.html. No separate identity/catalog.
"""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def build():
    home=(ROOT/'index.html').read_text()
    nav=re.search(r'<div class="d-bar">.*?</div>\s*</div>\s*</div>',home,re.S).group().replace(' aria-current="page"','')
    for name,src,title in [('account','forgeeks-account','Your Lightning account'),('marketplace','forgeeks-market','Lightning marketplace'),('leaderboard','forgeeks-leaderboard','Lightning leaderboard')]:
        text=(ROOT/(src+'.html')).read_text()
        main=re.search(r'<main\b.*?</main>',text,re.S).group()
        if name=='leaderboard':
            main=main.replace('The people who <span class="hi">build Lightning.</span>','The people who build Lightning.')
            main=main.replace('Meet the <span class="hi">members.</span>','Meet the members.').replace('Want your name <span class="hi">here.</span>','Want your name here.')
            main=main.replace('<span class="k">$</span> ','').replace('forgeeks-account.html','account.html').replace('forgeeks-guide.html','contribute.html')
            main=main.replace('</main>\n\n</main>','</main>')
        # The banner a member equipped, drawn above the page heading (js/site-banner.js).
        if name in ('account','marketplace'):
            main=main.replace('<div class="wrap">','<div class="wrap"><div class="fg-banner site-banner" data-banner-strip aria-hidden="true" hidden></div>',1)
        # Market purchase dialog lives after the For Geeks footer.
        dialog=''
        if name=='marketplace':
            start=text.index('<div class="mkt-dlg" id="buy"')
            dialog=text[start:text.index('<script src=',start)]
            main=main.replace('Cosmetics you <span class="hi">earned.</span>','Make it your own.')
            main=re.sub(r'<p class="lede">.*?</p>','<p class="lede">One account, one collection. <a href="topup.html">Top up your wallet</a> and browse website themes and banners below. App themes and badges, PC/phone claiming is still being built. Website top-ups need the owner to configure payment details first.</p>',main,count=1,flags=re.S)
            main=main.replace('>themes</h2>','>Themes</h2>').replace('>banners</h2>','>Banners</h2>').replace('>free palette</h3>','>Free palette</h3>')
            main=main.replace('A strip across the top of your profile when it is visible. No text, no links.','A strip across the top of your profile and your account page. No text, no links.')
            main=main.replace('Preview any theme from the picker (<kbd>T</kbd>) before you buy.','These designs apply to For Geeks. App assets will be listed separately when ready.')
        elif name=='account':
            main=re.sub(r'<p class="lede">.*?</p>','<p class="lede">Your profile, coin history and collection in one place. The same account works here and in For Geeks. Your financial data stays on your devices.</p>',main,count=1,flags=re.S)
        if name=='marketplace':
            main=main.replace('</main>','<section class="wrap" aria-labelledby="parts-lab-title"><h2 id="parts-lab-title">Test the first theme parts</h2><p>These designs are previews. Prices and app availability will be added after testing.</p><div id="parts-lab"></div><details><summary>Payments and refunds</summary><p>Top-ups and cosmetic purchases are final. No discretionary refunds are offered at this time. Required legal rights and manual review of duplicate transfers, incorrect payments or failed delivery remain available.</p><p>When InstaPay top-ups open, copy your Lightning account email into the transfer note, then upload your receipt, payment reference and sending InstaPay address on the website. Coins are added only after we review the receipt and separately confirm that the transfer reached our account.</p></details></section></main>')
        main=main.replace('forgeeks-account.html','account.html')
        scripts=['js/vendor/supabase-2.118.0.js','js/forgeeks-config.js','js/forgeeks-auth.js']
        if name=='account':scripts+=['js/forgeeks-account.js','js/forgeeks-account-rewards.js','js/forgeeks-account-data.js']
        elif name=='leaderboard':scripts+=['js/forgeeks-showcase.js','js/forgeeks-leaderboard.js']
        else:scripts+=['js/site-theme-previews.js','js/forgeeks-market.js','js/cosmetic-parts.js','js/cosmetic-preview.js','js/activation-codes.js']
        css=['css/landing.css','css/theme.css','css/forgeeks-account.css','css/forgeeks-rewards.css']
        if name in('marketplace','leaderboard','account'):css+=['css/forgeeks-cosmetics.css']
        if name=='marketplace':css+=['css/forgeeks-market.css']
        if name=='leaderboard':css+=['css/forgeeks-leaderboard.css']
        css+=['css/site-account.css','css/site-community.css','css/footer.css']
        head='\n'.join(f'<link rel="stylesheet" href="{p}">' for p in css)
        if name in ('account','marketplace'):scripts+=['js/site-banner.js']
        tail='\n'.join(f'<script src="{p}"></script>' for p in scripts)
        page=f'''<!doctype html>
<!-- Generated by tools/site_accounts.py; shared forms, auth and catalog. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>{title}</title><meta name="description" content="Your Lightning profile, collection and marketplace.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&amp;family=Manrope:wght@500;600;700;800&amp;display=swap">{head}
<script src="js/theme.js"></script></head>
<body data-account-page="account.html" data-main-store="true">{nav}{main}<footer></footer>{dialog}{tail}<script src="js/nav-menu.js"></script></body></html>'''
        (ROOT/(name+'.html')).write_text(page)
    js=(ROOT/'js/forgeeks.js').read_text()
    registry=re.search(r'var THEMES=(\[.*?\]);',js,re.S).group(1)
    (ROOT/'js/site-theme-previews.js').write_text('// Generated by tools/site_accounts.py from the existing website theme registry.\nwindow.LG={THEMES:'+registry+'};\n')

def connect_public_pages():
    for p in [*ROOT.glob('*.html'), *ROOT.glob('ar/*.html')]:
        text=p.read_text()
        if '<div class="d-bar">' not in text or p.name.startswith(('forgeeks','for-geeks')): continue
        up='../' if p.parent.name=='ar' else ''
        ar=bool(up)
        def nav_links(m):
            inner=re.sub(r'<a\b[^>]*href="features[.]html"[^>]*>.*?</a>', '', m[2], flags=re.S)
            inner=re.sub(r'<a\b[^>]*data-site-account[^>]*>.*?</a>', '', inner, flags=re.S)
            inner=re.sub(r'<a\b[^>]*href="(?:[.][.]/)?marketplace[.]html"[^>]*>.*?</a>', '', inner, flags=re.S)
            return m[1]+inner+m[3]
        text=re.sub(r'(<nav class="d-links"[^>]*>)(.*?)(</nav>)',nav_links,text,count=1,flags=re.S)
        if 'class="site-account-slot"' not in text:
            icon=f'<span class="site-account-slot"><a class="chip me" id="me" data-site-account href="{up}account.html" aria-label="'+('حسابك' if ar else 'Your account')+'"><svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 22v-3a8 8 0 0 1 16 0v3"/></svg></a></span>'
            text=re.sub(r'<a class="btn btn-primary nav-cta".*?</a>',lambda _:icon,text,count=1,flags=re.S)
        if 'data-account-page=' not in text:
            text=text.replace('<body','<body data-account-page="account.html"',1)
        if 'js/site-membership.js' not in text:
            tags=''
            if 'js/forgeeks-auth.js' not in text:
                tags=''.join(f'<script src="{up}{s}" defer></script>' for s in ['js/vendor/supabase-2.118.0.js','js/forgeeks-config.js','js/forgeeks-auth.js'])
            tags+=f'<script src="{up}js/site-membership.js" defer></script>'
            text=text.replace('</body>',tags+'\n</body>')
        if 'css/site-account.css' not in text:
            text=text.replace('</head>',f'<link rel="stylesheet" href="{up}css/site-account.css">\n</head>')
        text=re.sub(r'(js/forgeeks-auth[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261024-account-2\2', text)
        text=re.sub(r'(css/site-account[.]css)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261024-account-2\2', text)
        text=re.sub(r'(?m)^[ \t]+$', '', text)
        p.write_text(text)

if __name__=='__main__':
    build()
    connect_public_pages()
