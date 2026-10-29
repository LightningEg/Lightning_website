"""Generate the main-site owner console (admin.html) using the shared account/MFA controls.

    python tools/store_admin.py   # then python tools/footer.py to write the footer

The console is one page with a menu and one view at a time (js/owner-dashboard.js): Overview, Top-ups, Catalogue,
Sales, Members, Community, Money journal and Settings. Element ids are the contract with js/store-admin.js,
js/admin-operations.js, js/owner-catalog.js and the tests in supabase/tests/*pages*.test.mjs; keep them.
"""
from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]
VERSION = "20261028-funnel-1"  # css/store-admin.css and every js/ file below

ICON = {  # Lucide (A15), stroked by css/store-admin.css
    'today': '<path d="M3 3v18h18"/><path d="m7 15 4-4 3 3 5-6"/>',
    'sales': '<path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/>',
    'activity': '<path d="M22 12h-4l-3 9L9 3l-3 9H2"/>',
    'requests': '<rect x="2" y="5" width="20" height="14" rx="2"/><path d="M2 10h20"/><path d="M6 15h4"/>',
    'catalogue': '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8z"/><circle cx="7.5" cy="7.5" r="1.5"/>',
    'members': '<path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9"/><path d="M16 3.1a4 4 0 0 1 0 7.8"/>',
    'social': '<path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>',
    'bank': '<path d="M3 21h18"/><path d="M5 21V10"/><path d="M19 21V10"/><path d="M9 21V10"/><path d="M15 21V10"/><path d="m2 10 10-6 10 6"/>',
    'settings': '<circle cx="12" cy="12" r="3"/><path d="M12 2v3"/><path d="M12 19v3"/><path d="m4.9 4.9 2.1 2.1"/><path d="m17 17 2.1 2.1"/><path d="M2 12h3"/><path d="M19 12h3"/><path d="m4.9 19.1 2.1-2.1"/><path d="m17 7 2.1-2.1"/>',
}
MENU = [('today', 'Overview', ''), ('requests', 'Top-ups', 'receipts'), ('sales', 'Sales', ''), ('activity', 'Activity', ''), ('catalogue', 'Catalogue', ''),
        ('members', 'Members', ''), ('social', 'Community', 'stories'), ('bank', 'Money journal', 'unmatched'),
        ('settings', 'Settings', '')]


def icon(name):
    return f'<svg viewBox="0 0 24 24" aria-hidden="true">{ICON[name]}</svg>'


def view(key, title, lead, body):
    head = f'<header class="oc-view-head"><h2 id="{key}-h">{title}</h2><p class="oc-lead">{lead}</p></header>'
    return f'<section class="ops-view" id="{key}" aria-labelledby="{key}-h" hidden>{head}{body}</section>'


def seg(label, target, options):
    buttons = ''.join(f'<button type="button" data-value="{v}" aria-pressed="{"true" if i == 0 else "false"}">{t}</button>' for i, (v, t) in enumerate(options))
    select = ''.join(f'<option value="{v}">{t}</option>' for v, t in options)
    return (f'<div class="oc-seg" role="group" aria-label="{label}" data-for="{target}">{buttons}</div>'
            f'<select id="{target}" class="oc-hidden-select" aria-label="{label}" tabindex="-1">{select}</select>')


def build():
    home = (ROOT / 'index.html').read_text()
    legacy = (ROOT / 'forgeeks-admin.html').read_text()
    nav = re.search(r'<div class="d-bar">.*?</div>\s*</div>\s*</div>', home, re.S).group().replace(' aria-current="page"', '')
    mfa = re.search(r'<section class="panel"><h2>Verify administrator access.*?</section>', legacy, re.S).group()
    mfa = mfa.replace('<section class="panel">', '<section class="panel oc-gate-card">', 1)
    credit = re.search(r'<form class="panel" id="admin-credit-form">.*?</form>', legacy, re.S).group()
    credit = credit.replace('<h2>', '<h3>').replace('</h2>', '</h3>')

    avatar = ('<form class="panel" id="admin-avatar-form"><h3>Remove a profile picture</h3>'
              '<p>For a picture that breaks the community rules. It disappears from every page at once, your reason is kept in the audit log, and the member can upload another.</p>'
              '<div class="fields"><label>Account email<input name="email" type="email" required></label>'
              '<label>Reason<input name="reason" minlength="5" maxlength="300" required></label></div>'
              '<button class="btn" type="submit">Remove picture</button><p id="admin-avatar-status" class="oc-status" role="status"></p></form>')

    # Free a profile lives in Catalogue > App themes (js/owner-catalog.js moves this form into that panel): one home for seats.
    claims = ('<form class="oc-lookup" id="admin-claims-form" hidden><h4>Free a profile</h4>'
              '<p class="ops-fine">Each purchase of an app theme unlocks it for one Lightning profile. Look a member up by email to see which profiles hold a theme, and free a seat for someone who lost a device or profile.</p>'
              '<div class="fields two"><label>Account email<input name="email" type="email" required></label>'
              '<label>Reason to free a seat<input name="reason" minlength="5" maxlength="300"></label></div>'
              '<button class="btn ghost" type="submit">Show profiles</button><div id="admin-claims-list"></div><p id="admin-claims-status" class="oc-status" role="status"></p></form>')

    menu = ''.join(f'<a href="#{k}" data-view="{k}">{icon(k)}<span class="oc-nav-l">{label}</span>'
                   + (f'<span class="ops-badge" data-badge="{b}" hidden></span>' if b else '') + '</a>' for k, label, b in MENU)

    today = view('today', 'Overview', 'What needs you, how the month is going, and whether the store is ready to sell.',
                 '<div id="ops-dash"><p class="ops-empty">Verify your session to load the dashboard.</p></div>')

    requests = view('requests', 'Top-ups', 'Oldest first. Find each one in your InstaPay or bank app, then confirm what arrived. The server credits only when it matches the quote.',
        '<div class="oc-toolbar">' + seg('Request status', 'store-request-filter', [('pending', 'Open'), ('approved', 'Credited'), ('rejected', 'Rejected'), ('cancelled', 'Cancelled')])
        + '<input id="store-request-search" class="oc-search" type="search" autocomplete="off" placeholder="Email, sender or amount" aria-label="Search by email, sender or amount">'
        '<button class="btn ghost" type="button" id="store-request-refresh">Refresh</button></div>'
        '<p id="store-request-status" class="oc-status" role="status"></p><div id="store-request-list"></div>'
        '<button class="btn ghost oc-more" id="store-request-more" type="button" hidden>Load more</button>')

    sales = view('sales', 'Sales', 'What sold, how it was bought, and the carts that were filled but never checked out. Coins, not EGP: the Overview counts revenue from top-ups.',
        '<div id="ops-sales"><p class="ops-empty">Verify your session to load sales.</p></div>')

    activity = view('activity', 'Activity', 'The audit trail: every coin that moved, every score change, every sale and everything you did by hand, newest first. It reads the permanent records, so it cannot disagree with them.',
        '<div id="ops-activity"><p class="ops-empty">Verify your session to load activity.</p></div>')

    catalogue = view('catalogue', 'Catalogue', 'Every look on sale. A theme takes its tier’s price everywhere it is worn: both sites, the PC and the phone. Sets follow their parts at 80%.',
        '<div id="ops-catalogue"><p class="ops-empty">Verify your session to load the catalogue.</p></div>' + claims)

    members = view('members', 'Members', 'Credit coins or recognition points by hand: a goodwill gift, a refund in coins, a contest prize. Paid top-ups are confirmed under Top-ups, never here.',
        f'<div class="oc-grid">{credit}{avatar}</div>')

    social = view('social', 'Community', 'Stories to review, merges held for people who have not linked GitHub yet, and what each reward pays. Open the post, check the member’s code and the link back to Lightning, then reward it once. Up to three rewarded posts per member in 30 days.',
        '<div class="oc-toolbar">' + seg('Post status', 'store-social-filter', [('pending', 'Pending'), ('published', 'Published'), ('rejected', 'Rejected')])
        + '<button class="btn ghost" type="button" id="store-social-refresh">Refresh</button></div>'
        '<div id="store-social-list" class="oc-cards"></div><button class="btn ghost oc-more" id="store-social-more" type="button" hidden>Load more</button>'
        '<div class="oc-grid">'
        '<section class="panel" id="ops-held"><h3>Held for linking</h3><p class="ops-fine">Merged pull requests and coins waiting for a GitHub account that is not linked to a Lightning account yet. Nothing is lost: when the author links GitHub in their account, what waits here is paid to them once.</p><div id="ops-held-list"><p class="ops-empty">Verify your session to load what is held.</p></div></section>'
        '<form class="panel" id="ops-rewards"><h3>Story rewards</h3><p class="ops-fine">What one press of Approve pays for a story, and the extra coins when the blog or a guide links to a published story. Coins are spendable; points raise the leaderboard.</p>'
        '<div class="fields three"><label>Coins for an approved story<input name="coins" type="number" min="0" max="500" required></label><label>Points for an approved story<input name="points" type="number" min="0" max="500" required></label>'
        '<label>Blog bonus in coins<input name="blog_coins" type="number" min="0" max="500" required></label></div>'
        '<button class="btn" type="submit">Save rewards</button><p id="ops-rewards-status" class="oc-status" role="status"></p></form></div>')

    bank = view('bank', 'Money journal', 'Every transfer recorded, with or without a ticket. Rarely needed: money that arrived with no top-up to match, or an entry to correct.',
        '<div class="oc-toolbar">' + seg('Bank journal filter', 'store-bank-filter', [('unmatched', 'Unmatched'), ('all', 'All transfers')])
        + '<button class="btn ghost" type="button" id="store-bank-refresh">Refresh</button></div>'
        '<div id="store-bank-list" class="oc-cards"></div><button class="btn ghost oc-more" id="store-bank-more" type="button" hidden>Load more</button>'
        '<details class="panel oc-fold" id="store-bank-panel"><summary><h3>Record money that arrived with no ticket</h3></summary>'
        '<form id="store-bank-record"><div class="fields two"><label>Receiving bank reference<input name="reference" minlength="6" maxlength="100" required></label><label>Actual EGP received<input name="amount" type="number" step="0.01" min="0.01" required></label><label>Received at (your local time)<input name="received" type="datetime-local" required></label><label>Checkout request ID (leave empty if unmatched)<input name="request" autocomplete="off"></label><label>Sender InstaPay address (if known)<input name="sender" maxlength="200"></label><label>Lightning email in the transfer note (if present)<input name="email" type="email" maxlength="254"></label></div><label>Reconciliation note<textarea name="note" minlength="5" maxlength="500" required></textarea></label><label class="chk"><input name="confirmed" type="checkbox" required><span>I independently confirmed these funds reached the receiving account.</span></label><button class="btn" type="submit">Record bank transfer</button></form><p id="store-bank-status" class="oc-status" role="status"></p></details>')

    settings = view('settings', 'Settings', 'How members pay, what a coin costs, and who runs the store.',
        '<div class="oc-grid">'
        '<section class="panel" id="setup"><h3>Checkout</h3><p>The QR is private and appears only in a signed-in member’s accepted checkout. Support: <a href="mailto:hello@lightningeg.com">hello@lightningeg.com</a>.</p>'
        '<form id="store-settings"><div class="fields two"><label>Receiving InstaPay address<input name="address" maxlength="200" required></label><label>Exact recipient name shown by InstaPay<input name="recipient" maxlength="200" required></label></div><label>Private QR image<input type="file" name="qr" accept="image/png,image/jpeg,image/webp"></label><p id="store-qr-status" class="oc-hint">Upload only when changing the QR.</p><label>Processing instructions<textarea name="processing" minlength="20" maxlength="400" required></textarea></label><label class="chk"><input name="enabled" type="checkbox"><span>Open checkout after checking the receiving details and QR</span></label><button class="btn" type="submit">Save checkout</button></form><p id="store-settings-status" class="oc-status" role="status"></p></section>'
        '<section class="panel" id="pricing"><h3>Coin price</h3><p>Members type an EGP amount; the quote freezes the rate and bonus before they pay, so a change here only affects new top-ups.</p><form id="store-pricing"><div class="fields three"><label>Coins per 1 EGP<input name="rate" type="number" min="1" max="1000" required></label><label>Minimum EGP<input name="minimum" type="number" min="1" required></label><label>Maximum EGP<input name="maximum" type="number" min="1" max="100000" required></label></div><label>Bonus steps (EGP:percent, one per line)<textarea name="tiers" rows="3" placeholder="100:5&#10;500:10&#10;1000:15"></textarea></label><p class="oc-hint" id="store-pricing-example" aria-live="polite"></p><label class="chk"><input name="enabled" type="checkbox"><span>Allow new top-up quotes</span></label><button class="btn" type="submit">Save coin price</button></form><p id="store-pricing-status" class="oc-status" role="status"></p></section>'
        '<form class="panel" id="ops-fixed-cost"><h3>Monthly fixed cost</h3><p>The break-even line on the Overview: hosting, tools and your own time, in EGP a month.</p><label>Fixed cost in EGP<input name="egp" type="number" min="0" max="10000000" step="1" required></label><button class="btn" type="submit">Save fixed cost</button><p id="ops-fixed-status" class="oc-status" role="status"></p></form>'
        '<section class="panel" id="owner-accounts"><h3>Owner account</h3><p>Only one account opens this console and sees its link in the menu.</p><p id="owner-accounts-status" class="oc-status" role="status"></p><button class="btn ghost" id="owner-keep-me" type="button" hidden>Make this the only owner account</button></section>'
        '<section class="panel" id="retention"><h3>Receipt retention</h3><p>Delete eligible receipt images older than 90 days. Pending payment evidence is protected; ledger records stay.</p><button class="btn ghost" id="store-retention" type="button">Remove expired receipt files</button><p id="store-retention-status" class="oc-status" role="status"></p></section>'
        '<section class="panel"><h3>Contributor tools</h3><p>Reward pull requests, review reports and manage the For Geeks community.</p><a class="btn ghost" href="forgeeks-admin.html?advanced=1">Open contributor tools</a></section>'
        '</div>')

    scripts = ''.join(f'<script src="js/{name}.js?v={VERSION}"></script>' for name in
                      ('admin-operations', 'story-moderation', 'owner-dashboard', 'owner-catalog', 'owner-sales', 'owner-activity', 'owner-avatars', 'owner-claims', 'owner-community', 'store-admin'))
    page = (f'<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="color-scheme" content="light dark"><meta name="robots" content="noindex,nofollow"><title>Owner console · Lightning</title>'
            '<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Bricolage+Grotesque:wght@700;800&amp;family=Manrope:wght@500;600;700;800&amp;display=swap"><link rel="stylesheet" href="css/landing.css"><link rel="stylesheet" href="css/theme.css"><link rel="stylesheet" href="css/forgeeks-account.css"><link rel="stylesheet" href="css/site-account.css?v=20261025-reaudit-1">'
            f'<link rel="stylesheet" href="css/store-admin.css?v={VERSION}"><link rel="stylesheet" href="css/footer.css"><script src="js/theme.js"></script></head>'
            f'<body class="oc-body" data-account-page="account.html" data-main-store="true" data-owner-console="amount">{nav}<main class="oc ops">\n'
            '<header class="oc-head"><div class="oc-title"><h1>Owner console</h1><div id="store-overview" class="oc-chips" aria-label="Store status"></div><p id="store-overview-status" class="oc-status oc-quiet" role="status"></p></div><button class="btn ghost" id="store-unlock" type="button">Refresh</button></header>\n'
            '<div class="oc-gate"><p id="store-access" class="oc-status" role="status">Checking account access…</p><a class="btn" id="store-signin" href="account.html?next=admin.html" hidden>Sign in with the owner account</a></div>\n'
            f'<div id="store-owner" hidden><div class="oc-gate" id="ops-mfa">{mfa}</div><p class="ops-alert" id="owner-extra" hidden></p>\n'
            f'<div class="ops-shell"><nav class="ops-nav" aria-label="Owner tools">{menu}</nav>\n'
            f'<fieldset id="store-tools" class="ops-main" disabled><legend class="oc-sr">Owner tools</legend>{today}{requests}{sales}{activity}{catalogue}{members}{social}{bank}{settings}</fieldset></div></div></main>'
            '<div class="wrap"><footer></footer></div><script src="js/vendor/supabase-2.118.0.js"></script><script src="js/forgeeks-config.js"></script><script src="js/forgeeks-auth.js?v=20261028-errors-1"></script>'
            f'{scripts}<script src="js/nav-menu.js"></script><script src="js/site-membership.js?v=20261027-looks-1" defer></script></body></html>')
    (ROOT / 'admin.html').write_text(page)


if __name__ == '__main__':
    build()
