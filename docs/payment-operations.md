# Checkout and community operations

## Customer workflow

1. Sign in on the main website and open **Wallet** from the account menu. The same account owns the wallet and purchases across website devices.
2. Copy (owner, 2026-10-26): the wallet shows our InstaPay address, the receiver name and the member's own Lightning email for the transfer note, each with Copy, and the coin rate (`topup_payment_details`).
3. Pay in InstaPay, any whole EGP amount within the minimum and maximum, with the email in the note.
4. *I've sent it* opens the confirmation: the date paid, the amount sent (the exact coins and any bonus show as you type), and the InstaPay address or wallet phone they paid from. Accept the terms and *Send details* (`submit_instapay_topup`). That opens the ticket; no receipt image. A request opened earlier without details shows *I've paid* in the history and confirms the same way.
5. The history shows *Being checked* until the owner confirms. Allow one working day after the money arrives.
6. After manual reconciliation, the account wallet receives its coins once. Buy a compatible website cosmetic in Marketplace; quoted-price confirmation debits the wallet and creates permanent account inventory atomically. Equip it on supported website surfaces. Native PC/phone rendering and claiming remain a separate release gate; do not sell a native asset until that version and delivery are ready.

## Owner workflow

Open `/admin.html`, sign in with the owner account and verify an authenticator code. The server requires an active AAL2 session for financial and moderation operations. Routine operations use this console; no SQL or Google Sheet editing is needed.

The console (rebuilt 2026-10-26) has one menu and seven views: **Overview** (what needs you, the month, thirty days of revenue, what sells, and *Ready to sell*: receiving details, checkout open, quotes on, fixed cost, a first real payment, app themes released), **Top-ups**, **Catalogue** (tier prices, app releases, every item with its sales, owners and status; retire or offer again; price a banner, frame, badge or name), **Members** (manual credits), **Stories**, **Money journal** and **Settings** (checkout, coin price with a live example, fixed cost, owner account, receipt retention). The header shows whether checkout is open and the ledger balanced.

- **Checkout setup:** upload the real QR privately, verify the receiving address and exact displayed name, and save the processing message. Real receiving information is not a public asset or repository file. Turn checkout off to pause new payments; existing requests still resolve.
- **Pricing:** change the rate, allowed range or bonuses here. Existing quotes retain their value. The default is 5 coins per EGP, minimum 10 EGP and maximum 10,000 EGP, with no bundles.
- **Top-ups on one screen** (owner, 2026-10-26: "I want to do it on one screen"): Top-ups lists every open ticket as one row: the member, amount and coins, and what they said (amount, date, where they paid from). Find the money in your own InstaPay or bank app, type what arrived and its reference in the row, and press *Arrived · credit N coins*. A line compares it with the quote as you type (and counts money already on the ticket); a different amount turns the button into *Record what arrived* and credits nothing. *More* on the row holds when it arrived, the sender, a note, Reject, a revised offer and a return. `admin_confirm_topup` records the transfer and credits only when the money on the ticket equals the quote; a reference can pay one ticket only. Older tickets with a receipt show *Show receipt*, and it must be shown before they credit.
- **One owner account** (owner, 2026-10-26): only one account is in `admin_roles`, and a second can never be added. If an older database lists more, Settings › Owner account names them; *Make this the only owner account* (MFA, from the account you keep) removes the rest.
- **Money already recorded** (owner, 2026-10-25: reconcile on the same page): an open ticket also lists the money on it and any unmatched transfer that looks like it (same sender, email in the note, their reference, or the same amount within two days). *Use for this ticket* moves that transfer onto the ticket (`admin_attach_transfer`) and credits at once when the ticket's money equals the quote and the receipt was shown; *Not for this ticket* takes one off. Nothing is recorded twice.
- **Money journal:** every recorded transfer, unmatched first, and a folded form for money that arrived with no request. Rarely needed.
- **Catalogue** (2026-10-26): a tier keeps one price, so a theme is priced by its tier (`admin_set_tier_price`), never alone; a set follows its parts at 80%; banners, frames, badges and names are priced one at a time (`admin_set_item_price`). *Retire* takes an item off sale and owners keep it (`admin_set_item_active`). Every change is audited.
- **App releases** (Catalogue › App themes): an app theme is one purchase with its website version. Its unlock stays off until the Windows and Android release that carries it has shipped; then *Turn on unlock* (`admin_set_app_release`) lets owners get a one-time code. *Pause new unlocks* stops new codes; unlocked copies keep working.
- **Ledger discrepancies:** must remain zero. The immutable Supabase ledger is the balance source; spreadsheets can be exports only. Do not manually edit wallet balances or ledger entries.
- **Manual credits:** use a clear reason for promotional/support credits. Coins are spendable; recognition points affect the leaderboard. This control is not bank reconciliation and must not substitute for approving a real payment.

## Exceptions and privacy

Unpaid requests can be cancelled. A paid request must stay available until resolved; matching uncredited funds prevent rejection/deletion from hiding an unresolved payment. Never tell a customer to send the full amount again while an existing transfer is being checked.

For an underpayment or overpayment, either wait for missing funds or propose an explicit revised amount/coin offer. The member must accept it on their wallet page. Acceptance invalidates the prior receipt review; reload and review again before crediting. Declining does not silently change the quote or consume money.

The no-discretionary-refunds policy is accepted before payment and does not remove mandatory legal rights or correction of payment/delivery errors. **Record completed bank return** only after actually returning the full uncredited funds outside the website. It records evidence and closes the request; it never transfers money and cannot refund a credited request. For credited corrections, escalate for a reviewed, linked financial correction; do not edit history or use another credit to conceal the error.

An incorrect uncredited journal entry can be corrected, matched, unmatched or voided with an audit reason. A void retains its reference reservation. A mistyped reference can receive a verified alias; original and corrected references both remain protected from reuse, including after credit. Incoming/outgoing references share a unique registry. Do not void a genuine transfer merely to bypass a duplicate-reference warning.

Customers can read only their own request/history/receipts and funding totals. The QR endpoint requires an active signed-in session and that customer's accepted pending checkout. General checkout availability reveals no receiving details. Administrators access private bank records and short-lived receipt links; operational audit data excludes receipt images. Real account details and image bytes are provisioned privately after schema deployment. Private checkout limits access, but cannot prevent a legitimate customer saving a QR or taking a screenshot.

Run receipt retention regularly in the console: expired images older than 90 days may be deleted through Storage; pending evidence is protected and the financial ledger remains. Account deletion blocks unresolved payments, removes files through Storage first and scrubs retained sender identity. Contact: hello@lightningeg.com.

## Social coins and community safety

Members save a private title/summary draft, copy its verification code and Lightning backlink into their own LinkedIn or Reddit post, save the URL and submit with community-rule consent. There is no forced disclosure line in the composer or public post cards.

The moderator opens the external source and verifies ownership code, Lightning backlink and content compliance. Only general money-management experience and educational tips are accepted. Solicitation, advertising/offering financial services and personalized financial or investment advice are prohibited. The visible sidebar states removal and community bans, and explains responsibility for interactions on outside platforms, subject to law.

The owner may award up to 500 coins and/or 500 recognition points per post. Source URLs and ledger keys prevent repeated rewards; at most three posts per member earn coins in a rolling 30 days. Withdrawal or editing cannot reset the quota. Suggested starting moderation policy: 50 coins for a useful original post, 100 for a detailed example, no reward for copied, promotional or unverifiable content. Points remain an independent editorial decision. These are operator recommendations, not a guaranteed payout.

Content changes invalidate verification. An outdated moderation screen cannot approve a newer revision. A community ban hides pending/published listings and prevents new submissions; restoration is audited and does not automatically republish removed content. The site never posts to social accounts automatically and never rewards likes, votes or comments.

## Pricing and operational economics

Owner revision (2026-10-25): about 3,000 EGP of fixed cost a month, 5 coins per EGP, and buyers who pay once rather than monthly. Coins are fixed prices; the market also shows each price in EGP (`coin_rate()`).

**Ready to sell (2026-10-26, owner: "figure out the pricing").** One theme is one purchase on every surface: both sites, the PC and the phone (guideline/themes.md). The app's themes therefore take the website's ids and tiers: Nile (palette), Cotton (textured) and Papyrus (animated: the app's travelling gold-foil edge, the site's gold thread). Tier prices stay where they were, for three reasons:

- **Each tier is one round top-up.** 60 EGP buys 300 coins: a palette. 120 EGP buys 630 coins with the 5% bonus: a textured theme and change. 200 EGP buys 1,050 coins: an animated theme and change. The buyer never has to top up twice, and never sees a price that strands most of a top-up.
- **The ladder doubles, then rises by two thirds**, so the step from colour to material reads as earned, and the animated tier is the premium choice, not a different product.
- **The app makes each theme worth more, not cost more.** Holding prices while adding the PC and phone versions is the launch offer; it needs no discount, and a tier keeps one price.

Break-even at 3,000 EGP a month is about 15 animated themes, 25 textured or 50 palettes, less review time. Revisit after 60 days of real sales: if more than 40% of theme buyers choose animated, raise the next animated drop rather than discount anything; if palettes outsell everything, add a textured drop before touching price.

| Tier | What it is | Coins | EGP |
| --- | --- | --- | --- |
| Palette | New colours on both sites, the PC and the phone | 300 | 60 |
| Textured | The palette plus a material: a woven ground, grain, edge light | 600 | 120 |
| Animated | The material plus one slow signature motion, still under reduced motion | 1,000 | 200 |
| Banner | Strip on your profile, leaderboard row and account | 100–200 | 20–40 |
| Frame · badge | Ring round your picture · mark beside your name | 60–100 | 12–20 |
| Name style | Your display name in a colour (150), a gradient (300), or with one slow shimmer (500) | 150–500 | 30–100 |
| Animated banner | One slow motion, still under reduced motion | 300–350 | 60–70 |
| Seasonal | Banners and badges sold only in their window (harvest, New Year, Ramadan, Sham el-Nessim); owners keep them | 100–250 | 20–50 |
| Set | A theme, banner, frame and a fourth piece at 80% of the parts not owned yet | 680–712 new | 136–142 |
| Supporter badges | Earned at 500, 2,500 and 10,000 coins topped up; Founding for the first 100 payers. Never sold | — | — |

Top-up bonuses stay as configured (5% from 100 EGP, 10% from 500, 15% from 1,000; not cumulative), so a buyer's effective price per coin falls from 0.20 to about 0.17 EGP at the top step.

**Why these numbers.** At the old 100-coin palette (20 EGP), covering 3,000 EGP needed about 150 palette sales a month, which a young community cannot produce. Selling once means every month's revenue must come from new buyers or from something new for earlier buyers, so the price of a single item has to carry real weight:

- A typical first top-up buys a palette and a banner, or one textured theme: about 120–150 EGP. Less about 4 EGP of manual review per top-up, that is roughly 115–145 EGP net.
- Break-even is therefore about 21–26 paid top-ups a month (3,000 ÷ 115–145), before tax and payment charges.
- One buyer is worth more than one top-up when there is something new to buy: if a buyer returns for one drop in three months, a year is worth about 250 EGP. Covering 36,000 EGP a year then needs about 145 paying members a year, about 12 new ones a month plus their returns.
- At 2–5% of signed-in members paying, that means roughly 250–600 new members a month. Measure the real rate before trusting any of this.

**What keeps it profitable without a subscription:**

- One new textured theme a month (the drop), so earlier buyers have a reason to return. A palette is cheap to make; a texture costs one CSS pattern and its checks (guideline/themes.md).
- Seasonal items for a limited time (Ramadan, Eid, Coptic Christmas, Sham el-Nessim) at the same tier prices.
- **Supporter release (2026-10-25, built):** supporter badges reward total spend without a subscription; Founding supporter (first 100 payers, never again) rewards paying early; name styles are the cheapest thing everyone sees; sets raise the size of one purchase; seasonal drops and the monthly theme give earlier buyers a reason to return; gifts turn one buyer into two collections; supporters vote on the next theme. The Founder pack idea is replaced by the Founding badge plus sets.
- Bonuses on larger top-ups, so one trip through InstaPay and review buys more.

Count coins only when they are spent: unspent coins are an obligation to deliver cosmetics, not profit. Review time grows with the number of top-ups, so larger, rarer top-ups are cheaper to run than many small ones.

## Deployment and acceptance

Apply every migration in `supabase/migrations/` in filename order (the newest is `20261026110000_catalogue_and_app_release.sql`). Provision receiving details and private QR through trusted runtime administration, never public source. Deploy versioned frontend assets. Retire legacy unquoted purchases and old receipt-review calls with migration 2100 only after the new frontend is live. Local tests apply migrations in filename order; the deferred retirement is compatible with the newer wrappers.

Run the SQL integration suite, browser-script tests, site checks and phone/desktop browser acceptance. Confirm zero wallet discrepancies and review Supabase security advisors. Then perform one genuine owner-supervised InstaPay transfer, details confirmation, independent bank confirmation, credit, marketplace purchase and cross-device inventory check (the Overview's *Ready to sell* ticks it once a payer exists). Automated tests simulate transfers locally; they are not proof of live bank receipt or native app delivery. No real money is moved by these tests.

Security-advisor review: private QR/reference tables deliberately have RLS enabled with no client policies (deny by default). Public profile projection views retain consent/adult/member filters and safe display-field allowlists; their definer-view notices remain intentional. Definer RPCs explicitly enforce ownership or active owner/MFA access and fixed search paths. The project also reports that leaked-password protection is disabled; this Auth setting is a remaining provider hardening item, not evidence of successful payment acceptance. See [Supabase password protection](https://supabase.com/docs/guides/auth/password-security#password-strength-and-leaked-password-protection) and [definer-view review](https://supabase.com/docs/guides/database/database-linter?lint=0010_security_definer_view).

## Recovery and session-read safeguards

Migrations 2700–2900 add recovery for payments that arrive after a checkout was cancelled or rejected. In the request's original status filter, enter a clear reason and choose **Reopen for late payment review**. The quote and terms remain unchanged; the member is told not to pay again. Match actual funds and review the receipt before approving. Credited or returned requests cannot reopen.

For an unknown sender or deleted account, use the unmatched bank-journal entry's **Record completed unmatched return** after actually returning the entire incoming amount outside the site. Record the outgoing bank reference and reason. The journal links both references and prevents returned funds from later funding a wallet; it does not create an account or credit coins. Resolved returns leave the unmatched queue and do not block account deletion.

Private payment-table and receipt reads require an active session as well as the existing ownership/admin rules. Revoked administrator sessions lose access to payment configuration and bank records. Pending requests remain visible ahead of paged history; unchanged adjustment proposals retain their consent checkbox during polling. See the [workflow re-audit](../reports/2026-10-25-marketplace-workflow/report.md) for regression evidence and remaining acceptance gates.


MFA confirmation: once the server confirms owner access, the console displays **Administrator access verified**, hides the code form and opens the tools. An older failed access check cannot relock a newer verified session. The authenticator QR is separate from the receiving InstaPay QR. A successful code must not be repeated merely because another console section failed to load; use **Refresh verified session** to retry loading tools.
