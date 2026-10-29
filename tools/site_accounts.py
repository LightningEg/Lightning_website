"""Generate main-site account/market surfaces from the shared, tested community forms.
Run after changing forgeeks-account.html or forgeeks-market.html. No separate identity/catalog.
"""
from pathlib import Path
import re
ROOT=Path(__file__).resolve().parents[1]

def build():
    home=(ROOT/'index.html').read_text()
    nav=re.search(r'<div class="d-bar">.*?</div>\s*</div>\s*</div>',home,re.S).group().replace(' aria-current="page"','')
    for name,src,title in [('account','forgeeks-account','Your Lightning account'),('marketplace','forgeeks-market','Lightning marketplace'),('collection','forgeeks-market','Your Lightning collection'),('leaderboard','forgeeks-leaderboard','Lightning leaderboard'),('profile','forgeeks-profile','Lightning member')]:
        text=(ROOT/(src+'.html')).read_text()
        main=re.search(r'<main\b.*?</main>',text,re.S).group()
        if name=='leaderboard':
            main=main.replace('The people who <span class="hi">build Lightning.</span>','The people who build Lightning.')
            main=main.replace('Meet the <span class="hi">members.</span>','Meet the members.').replace('Want your name <span class="hi">here.</span>','Want your name here.')
            main=main.replace('<span class="k">$</span> ','').replace('forgeeks-account.html','account.html').replace('forgeeks-guide.html','contribute.html')
            main=main.replace('</main>\n\n</main>','</main>')
        if name=='profile':
            main=re.sub(r'<span class="hi">(.*?)</span>',r'\1',main).replace('<span class="hi" id="pf-name">','<span id="pf-name">')
            main=main.replace('<div id="closing" aria-hidden="true"></div>','<section class="wrap pf-stories" data-story-strip data-by-profile data-limit="6" hidden><h2 class="com-h">Stories</h2><div class="story-grid" data-story-list></div></section><div id="closing" aria-hidden="true"></div>')
        main=main.replace('forgeeks-leaderboard.html','leaderboard.html')
        # The banner a member equipped, drawn above the page heading (js/site-banner.js).
        if name=='account':
            main=main.replace('<div class="wrap">','<div class="wrap"><div class="fg-banner site-banner" data-banner-strip aria-hidden="true" hidden></div>',1)
        # Market purchase dialog lives after the For Geeks footer.
        dialog=''
        if name in('marketplace','collection'):
            start=text.index('<div class="mkt-dlg" id="buy"')
            dialog=text[start:text.index('<script src=',start)]
            main=main.replace('Cosmetics you <span class="hi">earned.</span>','Make it your own.')
            main=re.sub(r'<p class="lede">.*?</p>','''<p class="lede">Themes and looks for your profile, this site and the app. Try anything on before you buy.</p>
      <ol class="mk-steps" aria-label="How buying works"><li><b>1</b><span><a href="topup.html">Top up with InstaPay</a>, or earn Cotton with <a href="community.html">your work</a>.</span></li><li><b>2</b><span>Try it on. Nothing is charged.</span></li><li><b>3</b><span>Buy it once. It dresses the site and <a href="#app-guide">the app</a>.</span></li></ol>
      <nav class="mk-jump" aria-label="Categories"><a href="#h-themes">Themes</a><a href="#h-sets">Sets</a><a href="#h-banners">Banners</a><a href="#h-frames">Frames</a><a href="#h-names">Names</a><a href="#h-badges">Badges</a></nav>''',main,count=1,flags=re.S)
            main=main.replace('>themes</h2>','>Themes</h2>').replace('>banners</h2>','>Banners</h2>').replace('>free palette</h3>','>Free palette</h3>').replace('>frames</h2>','>Frames</h2>').replace('>badges</h2>','>Badges</h2>')
            main=main.replace('A strip across the top of your profile when it is visible. No text, no links.','A strip across the top of your profile and your account page. No text, no links.')
            main=main.replace('Try any theme on this page, or open details to see it on the website, the computer and the phone.','Try any theme on this page, or open Details to see it on the website, the computer and the phone.')
        elif name=='account':
            main=re.sub(r'<p class="lede">.*?</p>','<p class="lede">Your profile, Cotton history and collection in one place. The same account works here and in For Geeks. Your financial data stays on your devices.</p>',main,count=1,flags=re.S)
        if name=='marketplace':
            main=main.replace('</main>','<section class="wrap mkt-terms" aria-label="Payments"><details><summary>Payments and refunds</summary><p>Top-ups and cosmetic purchases are final. No discretionary refunds are offered at this time. Required legal rights and manual review of duplicate transfers, incorrect payments or failed delivery remain available.</p><p>Copy your account email into the transfer note, then confirm the date, amount and InstaPay address you paid from. Cotton is added after the owner confirms the money arrived.</p></details></section></main>')
        main=main.replace('forgeeks-account.html','account.html')
        signin='<a class="btn ghost" id="mkt-signin" href="account.html" hidden>sign in to buy</a>'
        if name=='marketplace':
            main=main.replace(signin,signin+'<a class="btn ghost" id="mkt-collection" href="collection.html" hidden>your collection</a>')
        if name=='collection':
            main=re.sub(r'<section class="s mkt-guide".*?</section>','',main,flags=re.S)
            main=re.sub(r'<h1 id="h1">.*?</h1>','<h1 id="h1">Your collection.</h1>',main,count=1,flags=re.S)
            main=re.sub(r'<p class="lede">.*?</p>','<p class="lede">Everything you own, in one place. Equip a look on this website, or press <b>Get app code</b> on a theme to unlock it in the Lightning app: one code per profile, and the profile’s other devices unlock by themselves. Looks you do not own yet are in <a href="marketplace.html">the marketplace</a>.</p>',main,count=1,flags=re.S)
            main=main.replace(signin,'<a class="btn ghost" id="mkt-signin" href="account.html" hidden>sign in to see your collection</a><a class="btn ghost" href="marketplace.html">browse the marketplace</a>')
            main=re.sub(r'<p class="fine">.*?</p>','<p class="fine" id="col-empty" hidden>You do not own a paid look yet. Free themes are always yours; paid ones appear here the moment you buy them.</p>',main,count=1,flags=re.S)
        scripts=['js/vendor/supabase-2.118.0.js','js/forgeeks-config.js','js/forgeeks-auth.js']
        if name=='account':scripts+=['js/forgeeks-account.js','js/forgeeks-account-rewards.js','js/forgeeks-account-data.js']
        elif name=='leaderboard':scripts+=['js/forgeeks-showcase.js','js/forgeeks-leaderboard.js']
        elif name=='profile':scripts+=['js/forgeeks-showcase.js','js/forgeeks-profile.js','js/story-card.js','js/story-strip.js']
        else:scripts+=['js/site-theme-previews.js?v=20261029-garnet-copy-1','js/forgeeks-showcase.js','js/theme-preview.js','js/cosmetic-parts.js','js/market-ui.js','js/forgeeks-market.js','js/activation-codes.js']
        if name in('marketplace','collection'):scripts.insert(scripts.index('js/forgeeks-market.js')+1,'js/market-cart.js')
        css=['css/landing.css','css/theme.css','css/forgeeks-account.css','css/forgeeks-rewards.css']
        if name in('marketplace','collection','leaderboard','account','profile'):css+=['css/forgeeks-cosmetics.css']
        if name in('marketplace','collection'):css+=['css/forgeeks-market.css','css/theme-preview.css','css/market-ui.css']
        if name=='leaderboard':css+=['css/forgeeks-leaderboard.css']
        if name=='profile':css+=['css/forgeeks-profile.css']
        css+=['css/site-account.css','css/site-community.css','css/footer.css']
        # the market's own files change often: a version so browsers fetch the new copy
        SHOP='?v=20261027-bundles-1'
        css=[c+SHOP if c in ('css/theme-preview.css','css/market-ui.css') else c for c in css]
        scripts=[j+SHOP if j in ('js/theme-preview.js','js/market-ui.js','js/forgeeks-market.js','js/market-cart.js','js/activation-codes.js') else j for j in scripts]
        head='\n'.join(f'<link rel="stylesheet" href="{p}">' for p in css)
        if name=='account':scripts+=['js/site-banner.js']
        scripts+=['js/site-words.js']
        tail='\n'.join(f'<script src="{p}"></script>' for p in scripts)
        page=f'''<!doctype html>
<!-- Generated by tools/site_accounts.py; shared forms, auth and catalog. -->
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>{title}</title><meta name="description" content="Your Lightning profile, collection and marketplace.">
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&amp;family=Manrope:wght@500;600;700;800&amp;display=swap">{head}
<script src="js/theme.js"></script></head>
<body data-account-page="account.html" data-main-store="true"{' data-collection="true"' if name=='collection' else ''}>{nav}{main}<div class="wrap"><footer></footer></div>{dialog}{tail}<script src="js/nav-menu.js"></script></body></html>'''
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
        text=re.sub(r'(js/forgeeks-auth[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261029-cotton-1\2', text)
        text=re.sub(r'(js/(?:forgeeks-account|forgeeks-account-data|admin-operations|story-card|story-moderation|community-stories)[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261025-reaudit-1\2', text)
        # changed with the community tabs pass (owner, 2026-10-25)
        text=re.sub(r'(js/topup[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261026-instapay-2\2', text)
        text=re.sub(r'(css/site-community[.]css|css/forgeeks-leaderboard[.]css|css/forgeeks-cosmetics[.]css|js/forgeeks-leaderboard[.]js|js/forgeeks-showcase[.]js|js/forgeeks-profile[.]js|js/forgeeks-market[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261025-supporter-1\2', text)
        text=re.sub(r'(css/forgeeks-leaderboard[.]css|js/forgeeks-leaderboard[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-coders-1\2', text)
        text=re.sub(r'(js/(?:story-moderation|community-stories)[.]js|css/site-community[.]css)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-console-1\2', text)
        text=re.sub(r'(js/forgeeks-market[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-cart-1\2', text)
        # the profile picture field (owner, 2026-10-27)
        text=re.sub(r'(js/forgeeks-account[.]js|css/forgeeks-account[.]css)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-avatar-1\2', text)
        text=re.sub(r'(css/(?:site-account)[.]css)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-looks-1\2', text)
        text=re.sub(r'(js/site-membership[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261027-looks-1\2', text)
        text=re.sub(r'(js/admin-operations[.]js)(?:[?]v=[^\"]*)?(\")', r'\1?v=20261025-mfa-1\2', text)
        text=re.sub(r'(?m)^[ \t]+$', '', text)
        p.write_text(text)

NAV_ITEMS=[('community','Overview','community.html'),('stories','Stories','stories.html'),('leaderboard','Leaderboard','leaderboard.html'),('marketplace','Marketplace','marketplace.html'),('collection','Collection','collection.html'),('wallet','Wallet','topup.html'),('account','Account','account.html')]
def community_nav(active):
    links=''.join(f'<a href="{h}"'+(' aria-current="page"' if k==active else '')+f'>{t}</a>' for k,t,h in NAV_ITEMS)
    return f'<div class="com-bar"><div class="wrap"><nav class="com-nav" aria-label="Community">{links}</nav></div></div>'

def add_community_nav(path,active):
    text=path.read_text()
    text=re.sub(r'<div class="com-bar">.*?</nav></div></div>','',text,flags=re.S)
    text=re.sub(r'(</div>)(<main\b)',lambda m:m[1]+community_nav(active)+m[2],text,count=1)
    path.write_text(text)

STORIES_MAIN='''<main id="main"><section class="s acct-top"><div class="wrap">
<h1>Stories.</h1>
<p class="lede">Real ways people run their money with Lightning, told on LinkedIn and Reddit. Read what they shared, or share your own and earn Cotton for the marketplace.</p>
<ol class="com-steps" aria-label="How it works"><li><b>Write your post</b><span>Tell, on LinkedIn or Reddit, how you use Lightning. Put your code and a link to Lightning in it.</span></li><li><b>Paste the link</b><span>Add the link to your post and one line about how you use Lightning. Agree to share it under your display name.</span></li><li><b>We review it</b><span>We open your post, check your code and the link back, and read it.</span></li><li><b>Earn Cotton and points</b><span>An approved story earns Cotton for the marketplace and points for the leaderboard.</span></li></ol>
<p id="story-status" role="status"></p>
<div class="stories-layout"><div class="stories-content"><h2 class="com-h">Latest posts</h2>
<div id="story-feed" class="story-grid"></div>
<section class="acct" id="story-member" hidden><h2 class="com-h">Share your post</h2>
<form id="story-form" class="panel"><input name="id" type="hidden"><h3>Share your post</h3><div class="fields">
<label>Post title<input name="title" minlength="5" maxlength="140" required></label>
<label>Name on the post<input name="author" minlength="2" maxlength="80" required autocomplete="name"></label>
<label>Link to your post (LinkedIn or Reddit)<input name="url" type="text" inputmode="url" autocomplete="off" autocapitalize="off" spellcheck="false" required placeholder="Paste the link from the post’s Share button"></label>
<label>Short excerpt (20 to 400 characters)<textarea name="line" rows="3" minlength="20" maxlength="400" required></textarea></label>
<label class="chk"><input name="consent" type="checkbox" required><span>I agree to share my post under my public display name, and to the community rules.</span></label></div>
<p class="com-lead">A public <a href="account.html">profile</a> is needed. Editing a listed post takes it down until it is reviewed again.</p>
<div class="row"><button class="btn" type="submit">Share for review</button><button class="btn ghost" id="story-new" type="button" hidden>Cancel the edit</button></div></form>
<ul class="com-rules"><li>Cotton rewards the post, never likes, votes, comments or the link alone, and each post can be rewarded once.</li>
<li>Up to 3 rewarded posts in any 30 days.</li>
<li>Never include account numbers, balances you want private or anything identifying. Posts are personal experiences, not financial advice.</li></ul>
<h3 class="com-h" id="story-mine-h" hidden>Your posts</h3><div id="story-mine"></div></section>
<p class="com-lead"><a href="account.html">Sign in or manage your account</a></p>
<section class="acct" id="story-review" hidden><h2 class="com-h">Moderation queue</h2><p class="com-lead">Read the title, excerpt, author name and linked post, then approve, ask for a change or decline. Approve pays the reward set in the owner console once per post: Cotton are spendable, points raise the leaderboard.</p>
<div id="story-queue"></div></section>
</div><aside class="community-rules" aria-labelledby="community-rules-title"><h2 id="community-rules-title">Community rules</h2><p>Only general money-management experiences and educational tips are accepted.</p><p>Solicitation, advertising or offering financial services, and personalized financial or investment advice are prohibited. Violations will result in removal of the content and a ban from the community.</p><h3>External platforms</h3><p>Posts may link to third-party platforms. Lightning does not control those platforms and is not responsible for communications, transactions, services or other interactions conducted outside this website, subject to applicable law. Official checkout purchases remain governed by our payment terms.</p><p><a href="mailto:hello@lightningeg.com">Report a concern</a></p></aside></div></div></section></main>'''

def build_stories():
    path=ROOT/'stories.html'
    text=path.read_text()
    text=re.sub(r'<main\b.*?</main>',lambda _:STORIES_MAIN,text,count=1,flags=re.S)
    text=text.replace('Your Lightning profile, collection and marketplace.','Read and write real stories about running your money with Lightning.')
    for css in ['css/forgeeks-cosmetics.css','css/site-community.css']:
        if css not in text:text=text.replace('<link rel="stylesheet" href="css/footer.css',f'<link rel="stylesheet" href="{css}">\n<link rel="stylesheet" href="css/footer.css',1)
    for js in ['js/forgeeks-showcase.js','js/story-card.js']:
        if js not in text:text=text.replace('<script src="js/community-stories.js',f'<script src="{js}"></script><script src="js/community-stories.js',1)
    path.write_text(text)

STRIP='''<section class="d-section story-strip" data-story-strip data-limit="3" hidden aria-labelledby="strip-title"><div class="wrap">
<p class="d-label">From the community</p><h2 id="strip-title">How people manage their money with Lightning, in their own words.</h2><p class="com-lead">Posts on LinkedIn and Reddit by Lightning users. They open on those sites.</p>
<div class="story-grid" data-story-list></div><p data-story-empty hidden>No stories yet. Yours could be the first.</p>
<p class="story-more"><a class="btn btn-secondary" href="stories.html">See all posts</a> <a class="btn btn-primary" href="stories.html#story-member">Share yours and earn Cotton</a></p></div></section>
'''

def build_guides():
    path=ROOT/'guides.html'
    text=path.read_text()
    text=re.sub(r'<section class="d-section story-strip".*?</section>\n','',text,flags=re.S)
    text=text.replace('  <!-- Signup band',STRIP+'  <!-- Signup band',1)
    for css in ['css/forgeeks-cosmetics.css','css/site-community.css']:
        if css not in text:text=text.replace('<link rel="stylesheet" href="css/motion.css',f'<link rel="stylesheet" href="{css}">\n<link rel="stylesheet" href="css/motion.css',1)
    if 'js/story-strip.js' not in text:
        text=text.replace('<script src="js/site-membership.js','<script src="js/forgeeks-showcase.js" defer></script><script src="js/story-card.js" defer></script><script src="js/story-strip.js" defer></script><script src="js/site-membership.js',1)
    path.write_text(text)

ANALYTICS='js/analytics.js?v=20261028-store-1'
def add_analytics():
    """Every main-site page counts visits (README › Analytics and consent), the community and store pages included.
    Not the owner console, For Geeks, the test page, archived versions or redirects."""
    for p in [*ROOT.glob('*.html'), *ROOT.glob('ar/*.html')]:
        if p.name.startswith(('forgeeks','for-geeks','admin','test','version-')): continue
        text=p.read_text()
        if 'http-equiv="refresh"' in text: continue
        up='../' if p.parent.name=='ar' else ''
        new=re.sub(r'(js/analytics[.]js)(?:[?]v=[^"]*)?"', lambda m: ANALYTICS[len('js/analytics.js'):].join([m[1], '"']), text)
        if 'js/analytics.js' not in new:
            new=new.replace('</head>',f'<script src="{up}{ANALYTICS}" defer></script>\n</head>',1)
        if new!=text:p.write_text(new)

if __name__=='__main__':
    build()
    build_stories()
    build_guides()
    connect_public_pages()
    for f,k in [('stories','stories'),('leaderboard','leaderboard'),('marketplace','marketplace'),('collection','collection'),('topup','wallet'),('account','account'),('profile','leaderboard')]:
        add_community_nav(ROOT/(f+'.html'),k)
    add_analytics()
